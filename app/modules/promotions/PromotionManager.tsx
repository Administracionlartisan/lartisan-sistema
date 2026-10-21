"use client";

import { useState } from "react";

export type PromotionDraft = {
  name: string;
  percentage: number;
  startsOn: string;
  endsOn: string;
  sites: string[];
  productIds: number[] | null;
};

type ProductOption = { id: number; name: string };
type Props = {
  sites: string[];
  products: ProductOption[];
  save: (draft: PromotionDraft) => Promise<void>;
};

/** Formulario sin efectos propios: el servidor debe autorizar y validar el guardado. */
export default function PromotionManager({ sites, products, save }: Props) {
  const [name, setName] = useState("");
  const [percentage, setPercentage] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [selectedSites, setSelectedSites] = useState<string[]>([]);
  const [allProducts, setAllProducts] = useState(true);
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const percent = Number(percentage);
    if (!name.trim() || !percentage || !Number.isFinite(percent) || percent <= 0 || percent > 100 || !startsOn || !endsOn || endsOn < startsOn || !selectedSites.length || (!allProducts && !selectedProducts.length)) {
      setMessage("Completá nombre, porcentaje, fechas, locales y productos de la promoción.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await save({ name: name.trim(), percentage: percent, startsOn, endsOn, sites: selectedSites, productIds: allProducts ? null : selectedProducts });
      setName(""); setPercentage(""); setMessage("Promoción guardada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la promoción.");
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border bg-white p-5">
    <h2 className="text-xl font-bold">Habilitar promoción</h2>
    <label className="block">Nombre <input className="ml-2 rounded border p-2" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
    <label className="block">Descuento (%) <input className="ml-2 w-28 rounded border p-2" type="number" min="0.01" max="100" step="0.01" value={percentage} onChange={(event) => setPercentage(event.target.value)} required /></label>
    <label className="block">Desde <input className="ml-2 rounded border p-2" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required /></label>
    <label className="block">Hasta <input className="ml-2 rounded border p-2" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} required /></label>
    <fieldset><legend className="font-bold">Locales</legend>{sites.map((site) => <label className="mr-4 inline-flex gap-1" key={site}><input type="checkbox" checked={selectedSites.includes(site)} onChange={(event) => setSelectedSites((current) => event.target.checked ? [...current, site] : current.filter((value) => value !== site))} />{site}</label>)}</fieldset>
    <label className="flex gap-2"><input type="checkbox" checked={allProducts} onChange={(event) => setAllProducts(event.target.checked)} /> Aplicar a todos los productos</label>
    {!allProducts && <fieldset className="max-h-48 overflow-auto"><legend className="font-bold">Productos incluidos</legend>{products.map((product) => <label className="block" key={product.id}><input type="checkbox" checked={selectedProducts.includes(product.id)} onChange={(event) => setSelectedProducts((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} /> {product.name}</label>)}</fieldset>}
    <button className="rounded bg-[#183a67] px-4 py-2 font-bold text-white disabled:opacity-50" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar promoción"}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
