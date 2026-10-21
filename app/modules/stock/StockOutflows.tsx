"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../shared/constants";
import type { Product } from "../shared/types";

type Outflow = { id: string; site: string; destination: string; carrier: string; reason: string; status: string; requestedBy: string; requestedAtISO: string; decidedBy?: string; decisionReason?: string; lines: { productId: number; quantity: number }[] };
type Props = { site: string; products: Product[]; canRequest: boolean; canApprove: boolean; pendingSync: number; refreshStock: () => Promise<void> };

export default function StockOutflows({ site, products, canRequest, canApprove, pendingSync, refreshStock }: Props) {
  const [requests, setRequests] = useState<Outflow[]>([]);
  const [error, setError] = useState("");
  const [destination, setDestination] = useState("");
  const [carrier, setCarrier] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([{ productId: "", quantity: "" }]);
  const [busy, setBusy] = useState(false);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const requestId = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/stock/outflows?site=${encodeURIComponent(site)}`, { credentials: "include", cache: "no-store" });
      const data = await response.json() as { ok: boolean; error?: string; requests: Outflow[] };
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudieron consultar las solicitudes.");
      setRequests(data.requests);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de conexión."); }
  }, [site]);
  useEffect(() => { const initial = setTimeout(() => void refresh(), 0); const timer = setInterval(() => void refresh(), 30000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [refresh]);
  const send = async (path: string, payload: object) => {
    const response = await fetch(`${API_BASE}/stock/outflows${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site, ...payload }) });
    const data = await response.json() as { ok: boolean; error?: string; request?: Outflow };
    if (!response.ok || !data.ok) throw new Error(data.error || "La operación no fue confirmada; consultá su estado.");
    return data;
  };
  const submit = async () => {
    setBusy(true); setError("");
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      await send("", { id: requestId.current, destination, carrier, reason, lines: lines.map((line) => ({ productId: Number(line.productId), quantity: Number(line.quantity) })) });
      requestId.current = null; setDestination(""); setCarrier(""); setReason(""); setLines([{ productId: "", quantity: "" }]); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "No se confirmó el envío. Reintentá sin cambiar la solicitud."); }
    finally { setBusy(false); }
  };
  const decide = async (id: string, action: "approve" | "reject") => {
    const decisionReason = action === "reject" ? rejectionReasons[id] || "" : "";
    if (action === "reject" && !decisionReason.trim()) { setError("Indicá el motivo del rechazo."); return; }
    setBusy(true); setError("");
    try { await send(`/${id}/${action}`, { reason: decisionReason }); await refresh(); if (action === "approve") await refreshStock(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se confirmó la decisión."); await refresh(); }
    finally { setBusy(false); }
  };
  return <section className="mb-5 min-w-0 rounded-2xl border bg-white p-4">
    <h2 className="text-lg font-bold">Egresos de mercadería · {site}</h2>
    <p className="text-sm text-slate-600">La mercadería solo se descuenta cuando una supervisora autorizada por Administración aprueba la solicitud.</p>
    {error && <p role="alert" className="my-2 text-red-700">{error}</p>}
    {canRequest && <div className="my-3 grid grid-cols-1 gap-2">
      <input aria-label="Destino" placeholder="Destino: restaurante o franquicia" value={destination} onChange={(e) => setDestination(e.target.value)} className="rounded border p-2" />
      <input aria-label="Responsable del retiro" placeholder="Quién retira la mercadería" value={carrier} onChange={(e) => setCarrier(e.target.value)} className="rounded border p-2" />
      <label className="grid gap-1 text-sm font-bold">Motivo del egreso / observación<textarea aria-label="Motivo del egreso" placeholder="Explicá por qué sale la mercadería (obligatorio)" required maxLength={300} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="rounded border p-2 font-normal" /></label>
      {lines.map((line, index) => <div key={index} className="flex flex-wrap gap-2"><select aria-label={`Producto ${index + 1}`} value={line.productId} onChange={(e) => setLines((current) => current.map((item, i) => i === index ? { ...item, productId: e.target.value } : item))} className="min-w-0 flex-1 basis-full rounded border p-2 sm:basis-0"><option value="">Elegir producto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.detail}</option>)}</select><input aria-label={`Cantidad ${index + 1}`} type="number" min="1" step="1" value={line.quantity} onChange={(e) => setLines((current) => current.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} className="w-24 rounded border p-2" placeholder="Cant." /><button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} disabled={lines.length === 1}>Quitar</button></div>)}
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setLines((current) => [...current, { productId: "", quantity: "" }])} className="rounded border p-2">Agregar producto</button><button type="button" disabled={busy || !reason.trim()} onClick={() => void submit()} className="rounded bg-[#183a67] p-2 font-bold text-white">Solicitar egreso</button></div>
    </div>}
    {canApprove && requests.some((item) => item.status === "Pendiente") && <p role="status" className="my-2 rounded bg-amber-100 p-2 font-bold">Hay solicitudes de egreso pendientes de autorización.</p>}
    {pendingSync > 0 && canApprove && <p className="text-red-700">Sincronizá las operaciones pendientes antes de aprobar un egreso.</p>}
    <div className="grid gap-2">{requests.map((item) => <article key={item.id} className="rounded border p-3"><b>{item.status} · {item.destination}</b><p className="my-1 rounded bg-slate-100 p-2 text-sm"><b>Motivo del egreso:</b> {item.reason}</p><p className="text-sm">Retira: {item.carrier} · Solicitó: {item.requestedBy} · {new Date(item.requestedAtISO).toLocaleString("es-AR")}</p><p className="text-sm">{item.lines.map((line) => `${products.find((p) => p.id === line.productId)?.name ?? `Producto ${line.productId}`} × ${line.quantity}`).join("; ")}</p>{item.decidedBy && <p className="text-sm">Resolvió: {item.decidedBy} {item.decisionReason && `· ${item.decisionReason}`}</p>}{canApprove && item.status === "Pendiente" && <div className="mt-2 flex flex-wrap gap-2"><button disabled={busy || pendingSync > 0} onClick={() => void decide(item.id, "approve")} className="rounded bg-green-700 p-2 font-bold text-white disabled:opacity-50">Aprobar y descontar stock</button><input aria-label={`Motivo de rechazo ${item.id}`} placeholder="Motivo obligatorio para rechazar" value={rejectionReasons[item.id] || ""} onChange={(event) => setRejectionReasons((current) => ({ ...current, [item.id]: event.target.value }))} className="rounded border p-2" /><button disabled={busy} onClick={() => void decide(item.id, "reject")} className="rounded border p-2">Rechazar</button></div>}</article>)}</div>
  </section>;
}
