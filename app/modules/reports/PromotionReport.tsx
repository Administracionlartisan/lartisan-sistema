"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "../shared/constants";

type Row = { site: string; promotion: string; count: number };
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monday = () => {
  const date = new Date();
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return localDate(date);
};

export default function PromotionReport() {
  const [from, setFrom] = useState(monday);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unavailable, setUnavailable] = useState(0);
  const [error, setError] = useState("");
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const to = Number.isNaN(end.getTime()) ? "" : localDate(end);

  useEffect(() => {
    if (!from || !to) return;
    const controller = new AbortController();
    fetch(`${API_BASE}/reports/promotions?${new URLSearchParams({ from, to })}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { ok: boolean; rows: Row[]; unavailable: number; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo cargar el informe.");
        setRows(data.rows);
        setUnavailable(data.unavailable);
      })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo cargar el informe."); });
    return () => controller.abort();
  }, [from, to]);

  return <section className="mt-6 rounded-2xl border bg-white p-5">
    <h2 className="text-xl font-bold">Promociones por semana</h2>
    <p className="mt-1 text-sm text-slate-600">Ventas activas por local y tipo de promoción, sin distinguir vendedora.</p>
    <label className="mt-4 block text-sm font-bold">Desde <input className="ml-3 rounded border p-2" type="date" value={from} onChange={(event) => { setRows(null); setError(""); setFrom(event.target.value); }} /></label>
    <p className="mt-2 text-sm">Hasta: {to || "—"}</p>
    {error ? <p role="alert" className="mt-4 text-red-700">{error}</p> : rows === null ? <p className="mt-4">Cargando informe…</p> : <>
      {unavailable > 0 && <p role="alert" className="mt-4 rounded bg-amber-100 p-3 text-sm">Hay {unavailable} ventas sin detalle histórico disponible. No se puede determinar su promoción; los totales podrían estar incompletos.</p>}
      <div className="mt-4 overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Local</th><th className="p-3">Promoción</th><th className="p-3 text-right">Ventas</th></tr></thead><tbody>
        {rows.map((row) => <tr className="border-b" key={JSON.stringify([row.site, row.promotion])}><td className="p-3">{row.site}</td><td className="p-3">{row.promotion}</td><td className="p-3 text-right">{row.count}</td></tr>)}
      </tbody></table>{!rows.length && <p className="p-4 text-sm">No se encontraron promociones registradas en este período.</p>}</div>
    </>}
  </section>;
}
