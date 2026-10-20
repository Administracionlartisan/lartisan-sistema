"use client";
import { useEffect, useState } from "react";
import { API_BASE } from "../shared/constants";

export default function StockOutflowAlerts({ onOpen }: { onOpen: (site: string) => void }) {
  const [pending, setPending] = useState<{ site: string; total: number }[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`${API_BASE}/stock/outflows`, { credentials: "include", cache: "no-store" });
        const data = await response.json() as { ok: boolean; pending?: { site: string; total: number }[] };
        if (!response.ok || !data.ok || !Array.isArray(data.pending)) throw new Error("unavailable");
        if (active) { setPending(data.pending); setUnavailable(false); }
      } catch { if (active) setUnavailable(true); }
    };
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 30000);
    return () => { active = false; clearTimeout(initial); clearInterval(timer); };
  }, []);
  if (unavailable) return <p role="status" className="bg-amber-100 px-4 py-2 text-sm">No se pudo consultar avisos de egresos. Revisá la conexión.</p>;
  if (!pending.length) return null;
  return <aside role="status" className="flex flex-wrap items-center gap-2 bg-amber-100 px-4 py-2 text-sm"><b>Solicitudes de mercadería pendientes:</b>{pending.map((item) => <button key={item.site} onClick={() => onOpen(item.site)} className="rounded border border-amber-700 px-2 py-1 font-bold">{item.site}: {item.total}</button>)}</aside>;
}
