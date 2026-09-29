"use client";
import { useState } from "react";
import type { Product } from "../shared/types";
import { downloadCsv } from "../shared/downloadCsv";
import { money } from "../shared/constants";
import { normalizeBarcode, validateCatalog, type CatalogDocument } from "../config/catalogModel";

type Props = {
  catalog: CatalogDocument; ready: boolean; busy: boolean;
  onSave: (products: Product[], revision: number) => Promise<void>;
};
export default function CatalogEditor({ catalog, ready, busy, onSave }: Props) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Product | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const products = catalog.products;
  const edit = (product?: Product) => {
    const used = new Set(products.flatMap((p) => [p.barcode, ...(p.barcodeAliases ?? [])]));
    const available = Array.from({ length: 999 }, (_, i) => `LART-${String(i + 1).padStart(3, "0")}`).find((b) => !used.has(b)) ?? "";
    setDraft(product ? { ...product } : { id: Math.max(...products.map((p) => p.id)) + 1, name: "", detail: "", category: "", price: 0, onlinePrice: 0, barcode: available, code: available.slice(5) });
    setBaseRevision(catalog.revision); setError(""); setNotice("");
  };
  const submit = async () => {
    if (!draft) return;
    setError("");
    try {
      const next = products.some((p) => p.id === draft.id) ? products.map((p) => p.id === draft.id ? draft : p) : [...products, draft];
      const validated = validateCatalog(next, products);
      await onSave(validated, baseRevision);
      setNotice(`${draft.name}: guardado para todos los locales.`); setDraft(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); }
  };
  return <section className="mb-6 rounded-2xl border bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold">Productos y códigos de barras</h2><p className="mt-1 text-sm text-slate-500">{products.length} productos · Compartido por todos los locales.</p></div>
      <div className="flex flex-wrap gap-2">
        <button disabled={!ready || busy || Boolean(draft)} onClick={() => edit()} className="rounded bg-[#183a67] px-4 py-2 font-bold text-white disabled:opacity-40">Agregar producto</button>
        <button disabled={!ready} onClick={() => downloadCsv("Catalogo_codigos_LArtisan.csv", [["Producto", "Presentación", "Categoría", "Código de barras", "Códigos anteriores válidos", "Precio mostrador", "Precio online"], ...products.map((p) => [p.name, p.detail, p.category, p.barcode, (p.barcodeAliases ?? []).join(" / "), p.price, p.onlinePrice ?? p.price])])} className="rounded border px-4 py-2 font-bold disabled:opacity-40">Exportar para Excel</button>
      </div>
    </div>
    {notice && <p role="status" className="mt-3 rounded bg-[#eef5ef] p-3">{notice}</p>}
    {draft && <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="my-5 rounded-xl border bg-[#f5f8fc] p-4">
      <h3 className="font-bold">{products.some((p) => p.id === draft.id) ? "Editar producto" : "Nuevo producto"}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {([['name', 'Nombre'], ['detail', 'Presentación'], ['category', 'Categoría'], ['barcode', 'Código de barras']] as const).map(([field, label]) => <label key={field} className="text-sm font-bold">{label}<input required maxLength={field === 'barcode' ? 8 : 180} list={field === 'category' ? 'catalog-categories' : undefined} value={draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} className="mt-1 block w-full rounded border bg-white p-2 font-normal" /></label>)}
        <datalist id="catalog-categories">{[...new Set(products.map((p) => p.category))].map((c) => <option key={c} value={c} />)}</datalist>
        {([['price', 'Precio mostrador'], ['onlinePrice', 'Precio online']] as const).map(([field, label]) => <label key={field} className="text-sm font-bold">{label}<input required type="number" min="0" max="100000000" step="0.01" value={Number.isNaN(draft[field]) ? '' : draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.value === '' ? NaN : Number(e.target.value) })} className="mt-1 block w-full rounded border bg-white p-2 font-normal" /></label>)}
      </div>
      <p className="mt-3 text-sm">En Zebra usá Code 128 con el valor <b>{normalizeBarcode(draft.barcode) ?? "LART-XXX"}</b>. Los códigos anteriores seguirán funcionando y no podrán asignarse a otro producto.</p>
      <p className="mt-1 text-xs text-slate-600">Un producto nuevo comienza con stock 0. El ingreso de mercadería se realiza desde Stock o la recepción de Pedido.</p>
      {baseRevision !== catalog.revision && <p role="alert" className="mt-3 text-red-700">El catálogo cambió mientras editabas. Cancelá y volvé a abrir el producto para revisar los datos actualizados.</p>}
      {error && <p role="alert" className="mt-3 font-bold text-red-700">{error}</p>}
      <div className="mt-4 flex gap-3"><button disabled={!ready || busy || baseRevision !== catalog.revision} className="rounded bg-[#183a67] px-4 py-2 font-bold text-white disabled:opacity-40">{busy ? "Guardando…" : "Guardar producto"}</button><button type="button" disabled={busy} onClick={() => { setDraft(null); setError(""); }} className="rounded border px-4 py-2">Cancelar</button></div>
    </form>}
    {!draft && <label className="mt-5 block text-sm">Buscar producto o código<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, presentación o LART-501" className="mt-1 w-full rounded border p-3" /></label>}
    <div className="mt-4 max-h-[540px] overflow-auto rounded border"><table className="w-full min-w-[820px] text-sm"><thead className="sticky top-0 bg-[#eef2f6]"><tr>{["Producto", "Categoría", "Código de barras", "Mostrador", "Online", "Acción"].map((t) => <th key={t} className="p-3 text-left">{t}</th>)}</tr></thead><tbody>
      {products.filter((p) => `${p.name} ${p.detail} ${p.category} ${p.barcode} ${p.barcodeAliases?.join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())).map((p) => <tr key={p.id} className="border-t"><td className="p-3"><b>{p.name}</b><br /><span className="text-slate-500">{p.detail}</span></td><td className="p-3">{p.category}</td><td className="p-3"><b className="whitespace-nowrap">{p.barcode}</b>{Boolean(p.barcodeAliases?.length) && <span className="mt-1 block text-xs text-slate-500">También acepta: {p.barcodeAliases!.join(', ')}</span>}</td><td className="p-3 whitespace-nowrap">{money.format(p.price)}</td><td className="p-3 whitespace-nowrap">{money.format(p.onlinePrice ?? p.price)}</td><td className="p-3"><button disabled={!ready || busy || Boolean(draft)} onClick={() => edit(p)} aria-label={`Editar ${p.name} ${p.detail}`} className="rounded border px-3 py-2 font-bold disabled:opacity-40">Editar</button></td></tr>)}
    </tbody></table></div>
  </section>;
}
