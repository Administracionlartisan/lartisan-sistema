"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../shared/constants";
import type { Product } from "../shared/types";

type Receipt = { id: string; product_id: number; quantity: number; movement_type: string; remito: string | null; detail: string | null; occurred_at: string | null; created_by: string | null; review_status: string | null; observation: string | null; reviewer_name: string | null; reviewed_at: string | null };

export default function StockReceiptHistory({ site: initialSite, sites, products, canReview }: { site: string; sites?: string[]; products: Product[]; canReview: boolean }) {
  const [selectedSite, setSelectedSite] = useState(initialSite);
  const site = sites ? selectedSite : initialSite;
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Receipt[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState("");
  const requestNumber = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`${API_BASE}/stock/receipts?site=${encodeURIComponent(site)}&offset=${offset}`, { credentials: "include", cache: "no-store" });
      const data = await response.json() as { ok?: boolean; error?: string; movements?: Receipt[] };
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo consultar el historial.");
      if (request === requestNumber.current) setRows(data.movements || []);
    } catch (e) { if (request === requestNumber.current) { setRows([]); setError(e instanceof Error ? e.message : "No se pudo consultar el historial."); } }
    finally { if (request === requestNumber.current) setLoading(false); }
  }, [site, offset]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => { window.clearTimeout(timer); requestNumber.current++; }; }, [load]);
  const review = async (movementId: string, status: "revisado" | "diferencia") => {
    const observation = (notes[movementId] || "").trim();
    if (status === "diferencia" && !observation) { setError("Escribí una observación para informar la diferencia."); return; }
    setSaving(movementId); setError("");
    try {
      const response = await fetch(`${API_BASE}/stock/receipts`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site, movementId, status, observation }) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo guardar la revisión.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la revisión."); }
    finally { setSaving(""); }
  };
  return <section className="my-5 rounded-2xl border bg-white p-5 shadow-sm">
    <h2 className="text-xl font-bold">Historial de ingresos de remitos · {site}</h2>
    {sites && <label className="mt-2 block text-sm font-bold">Local <select value={site} onChange={e => { setSelectedSite(e.target.value); setOffset(0); }} className="ml-2 rounded border p-2">{sites.map(local => <option key={local} value={local}>{local}</option>)}</select></label>}
    <p className="mt-1 text-sm text-slate-600">Ingresos guardados en el servidor, por producto. Incluye cargas manuales y recepciones de pedido; revisar no modifica el stock.</p>
    <button type="button" onClick={() => void load()} className="my-3 rounded border px-3 py-1.5 font-bold">Actualizar</button>
    {error && <p role="alert" className="my-2 rounded bg-red-50 p-2 text-red-800">{error}</p>}
    {loading ? <p>Cargando historial…</p> : !rows.length ? <p>No hay ingresos guardados para este local en esta página.</p> : <div className="overflow-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="bg-[#eef2f6] text-left"><th className="p-2">Fecha</th><th className="p-2">Producto / cantidad</th><th className="p-2">Remito / detalle</th><th className="p-2">Ingresado por</th><th className="p-2">Revisión</th></tr></thead><tbody>{rows.slice(0, 100).map(row => <tr key={row.id} className="border-t align-top"><td className="p-2">{row.occurred_at || "Sin fecha"}</td><td className="p-2">{products.find(p => p.id === Number(row.product_id))?.name || `Producto ${row.product_id}`} · {row.quantity}</td><td className="p-2">{row.remito || "Sin número"}<br />{row.detail || "—"}<br /><span className="text-xs text-slate-500">{row.movement_type} · {row.id}</span></td><td className="p-2">{row.created_by || "No disponible"}</td><td className="p-2"><b>{row.review_status === "revisado" ? "Revisado" : row.review_status === "diferencia" ? "Con diferencia" : "Sin revisar"}</b>{row.reviewer_name && <p>{row.reviewer_name} · {row.reviewed_at}</p>}{row.observation && <p>{row.observation}</p>}{canReview && <div className="mt-2"><input aria-label={`Observación para ${row.id}`} maxLength={500} value={notes[row.id] || ""} onChange={e => setNotes(v => ({ ...v, [row.id]: e.target.value }))} placeholder="Observación" className="w-full rounded border p-2" /><div className="mt-2 flex gap-2"><button type="button" disabled={!!saving} onClick={() => void review(row.id, "revisado")} className="rounded border px-2 py-1">Marcar revisado</button><button type="button" disabled={!!saving} onClick={() => void review(row.id, "diferencia")} className="rounded border px-2 py-1">Informar diferencia</button></div></div>}</td></tr>)}</tbody></table></div>}
    <div className="mt-3 flex gap-2"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))} className="rounded border px-2 py-1 disabled:opacity-40">Más recientes</button><button type="button" disabled={loading || rows.length <= 100} onClick={() => setOffset(offset + 100)} className="rounded border px-2 py-1 disabled:opacity-40">Más antiguos</button></div>
  </section>;
}
