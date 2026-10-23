"use client";
import { useMemo, useState } from "react";
import type { CustomerGroup, CustomerRecord, ReturnTransaction, Sale } from "../shared/types";
import { customerHistory, hasDuplicateDocument, normalizeDocument, validateCustomerDraft, type CustomerDraft } from "./customerModel";
import { customerGroupOf } from "./customerGroups";

type Props = {
  site: string; customers: CustomerRecord[]; sales: Sale[]; returnsLog: ReturnTransaction[];
  canWrite: boolean; paymentMethods: string[];
  onSave: (customer: CustomerRecord) => void; onDeactivate: (id: string) => void;
  onCollect: (sale: Sale, method: string) => void;
};
const groups: CustomerGroup[] = ["Sin grupo", "Restaurante", "Franquicia", "Almacén"];
const creditGroups: CustomerGroup[] = ["Restaurante", "Franquicia"];
const groupOf = (customer?: CustomerRecord): CustomerGroup => customerGroupOf(customer);
const blank = (): CustomerDraft => ({ id: "", name: "", documentType: "DNI", documentNumber: "", customerGroup: "Sin grupo", creditTermDays: 0, email: "", phone: "", address: "", consentPromotions: false });

export default function CustomerPanel({ site, customers, sales, returnsLog, canWrite, paymentMethods, onSave, onDeactivate, onCollect }: Props) {
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<CustomerGroup | "Todos">("Todos");
  const [form, setForm] = useState(blank());
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [collectionMethod, setCollectionMethod] = useState(paymentMethods[0] || "Efectivo");
  const customerFor = (sale: Sale) => customers.find((customer) => customer.id === sale.customerId && customer.site === site);
  const saleGroup = (sale: Sale) => sale.customerGroup || groupOf(customerFor(sale));
  const visible = useMemo(() => customers.filter((customer) => customer.site === site && (showInactive || customer.active) && (groupFilter === "Todos" || groupOf(customer) === groupFilter) && `${customer.name} ${customer.documentNumber} ${customer.email || ""} ${groupOf(customer)}`.toLowerCase().includes(query.toLowerCase())), [customers, query, groupFilter, showInactive, site]);
  const pending = useMemo(() => sales.filter((sale) => sale.site === site && sale.status === "activa" && sale.paymentStatus === "Pendiente"), [sales, site]);
  const pendingTotal = (group?: CustomerGroup) => pending.filter((sale) => !group || saleGroup(sale) === group).reduce((total, sale) => total + sale.net, 0);
  const selected = customers.find((customer) => customer.id === selectedId && customer.site === site);
  const history = selected ? customerHistory(selected, sales, returnsLog) : null;
  const save = () => {
    const validation = validateCustomerDraft(form);
    if (validation) return setError(validation);
    if (hasDuplicateDocument(customers, site, form)) return setError("Ya existe un cliente activo o inactivo con ese tipo y número de documento en este local.");
    onSave({ ...form, id: form.id || crypto.randomUUID(), site, name: form.name.trim(), documentNumber: normalizeDocument(form.documentNumber), email: form.email.trim() || undefined, phone: form.phone.trim() || undefined, address: form.address.trim() || undefined, createdAt: "", updatedAt: "", createdBy: "", active: true });
    setForm(blank()); setSelectedId(null); setError("");
  };
  const select = (customer: CustomerRecord) => {
    setSelectedId(customer.id); setError("");
    setForm({ id: customer.id, name: customer.name, documentType: customer.documentType, documentNumber: customer.documentNumber, customerGroup: groupOf(customer), creditTermDays: customer.creditTermDays || 0, email: customer.email || "", phone: customer.phone || "", address: customer.address || "", consentPromotions: customer.consentPromotions });
  };
  const money = (amount: number) => amount.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
  return <section>
    <h1 className="text-3xl font-bold">Base de clientes · {site}</h1>
    <p className="mt-2 text-slate-600">Cada venta conserva el cliente y grupo que tenía al emitirse. Los grupos Restaurante y Franquicia se venden a cuenta corriente.</p>
    <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-lg font-bold">Cobranzas pendientes</h2>
      <p className="mt-1 text-sm text-slate-700">La venta a cuenta descuenta stock, pero no entra a caja hasta registrar el cobro.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded bg-white p-3"><b>Total pendiente</b><p className="text-xl font-bold">{money(pendingTotal())}</p></div>{creditGroups.map((group) => <div key={group} className="rounded bg-white p-3"><b>{group}</b><p className="text-xl font-bold">{money(pendingTotal(group))}</p></div>)}</div>
      <label className="mt-4 block max-w-sm text-sm font-bold">Medio del cobro recibido<select value={collectionMethod} onChange={(event) => setCollectionMethod(event.target.value)} className="mt-1 w-full rounded border p-2 font-normal">{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
      <div className="mt-3 space-y-2">{pending.map((sale) => <div key={sale.id} className="flex flex-wrap items-center justify-between gap-3 rounded border bg-white p-3 text-sm"><div><b>{sale.customer}</b><span className="ml-2 rounded bg-slate-100 px-2 py-1 text-xs">{saleGroup(sale)}</span><p>{sale.createdAt} · {money(sale.net)}{sale.dueAtISO ? ` · vence ${new Date(sale.dueAtISO).toLocaleDateString("es-AR")}` : ""}</p></div><button disabled={!canWrite} onClick={() => onCollect(sale, collectionMethod)} className="rounded bg-[#183a67] px-3 py-2 font-bold text-white disabled:opacity-50">Marcar cobrada</button></div>)}{!pending.length && <p className="rounded bg-white p-3 text-sm text-slate-600">No hay ventas pendientes de cobro en este local.</p>}</div>
    </section>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border bg-white p-4"><div className="grid gap-2 sm:grid-cols-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, documento, email o grupo" className="rounded border p-2"/><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value as CustomerGroup | "Todos")} className="rounded border p-2"><option>Todos</option>{groups.map((group) => <option key={group}>{group}</option>)}</select></div><label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)}/> Incluir clientes desactivados</label><div className="mt-3 space-y-2">{visible.map((customer) => { const related = customerHistory(customer, sales, returnsLog); return <button key={customer.id} onClick={() => select(customer)} className="block w-full rounded border p-3 text-left"><b>{customer.name}</b><span className="ml-2 rounded bg-slate-100 px-2 py-1 text-xs">{groupOf(customer)}</span>{!customer.active && <span className="ml-2 text-xs text-slate-500">Inactivo</span>}<span className="ml-2 text-sm">{customer.documentType} {customer.documentNumber}</span><p className="text-sm text-slate-600">{related.sales.length} ventas · {related.returns.length} devoluciones</p></button>; })}{!visible.length && <p className="p-3 text-sm text-slate-500">No hay clientes que coincidan con la búsqueda.</p>}</div></div>
      <div className="rounded-xl border bg-white p-4"><h2 className="font-bold">{form.id ? "Editar cliente" : "Alta de cliente"}</h2>{error && <p className="mt-2 text-red-700">{error}</p>}<div className="mt-3 grid gap-2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre o razón social" disabled={!canWrite} className="rounded border p-2"/><select value={form.customerGroup} onChange={(event) => setForm({ ...form, customerGroup: event.target.value as CustomerGroup })} disabled={!canWrite} className="rounded border p-2">{groups.map((group) => <option key={group}>{group}</option>)}</select>{creditGroups.includes(form.customerGroup) && <label className="text-sm font-bold">Plazo de cobro (días)<input type="number" min="0" max="365" value={form.creditTermDays} onChange={(event) => setForm({ ...form, creditTermDays: Number(event.target.value) || 0 })} disabled={!canWrite} className="mt-1 w-full rounded border p-2 font-normal"/></label>}<select value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value as "DNI" | "CUIT" | "Otro" })} disabled={!canWrite} className="rounded border p-2"><option>DNI</option><option>CUIT</option><option>Otro</option></select><input value={form.documentNumber} onChange={(event) => setForm({ ...form, documentNumber: event.target.value })} disabled={!canWrite} placeholder="Documento" className="rounded border p-2"/><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} disabled={!canWrite} placeholder="Email" className="rounded border p-2"/><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} disabled={!canWrite} placeholder="Teléfono" className="rounded border p-2"/><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} disabled={!canWrite} placeholder="Domicilio" className="rounded border p-2"/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.consentPromotions} onChange={(event) => setForm({ ...form, consentPromotions: event.target.checked })} disabled={!canWrite}/> Acepta recibir promociones</label></div>{canWrite ? <div className="mt-3 flex gap-2"><button onClick={save} className="rounded bg-[#183a67] px-3 py-2 font-bold text-white">Guardar</button>{form.id && <button onClick={() => { onDeactivate(form.id); setForm(blank()); setSelectedId(null); }} className="rounded border px-3 py-2">Desactivar</button>}</div> : <p className="mt-3 text-sm text-amber-700">Tu rol puede consultar, pero no modificar clientes.</p>}</div>
    </div>
    {selected && history && <div className="mt-5 rounded-xl border bg-white p-4"><h2 className="font-bold">Historial de {selected.name}</h2><div className="mt-3 grid gap-4 lg:grid-cols-2"><div><b className="text-sm">Ventas</b><div className="mt-2 space-y-2">{history.sales.length ? history.sales.map((sale) => <div key={sale.id} className="rounded border p-2 text-sm">{sale.createdAt} · {sale.site} · {sale.status} · {sale.paymentStatus || "Pagada"} · <b>{money(sale.net)}</b></div>) : <p className="text-sm text-slate-500">Sin ventas asociadas.</p>}</div></div><div><b className="text-sm">Devoluciones y cambios</b><div className="mt-2 space-y-2">{history.returns.length ? history.returns.map((item) => <div key={item.id} className="rounded border p-2 text-sm">{item.createdAt} · {item.kind} · {item.reason} · <b>{money(item.amount)}</b></div>) : <p className="text-sm text-slate-500">Sin devoluciones asociadas.</p>}</div></div></div></div>}
  </section>;
}
