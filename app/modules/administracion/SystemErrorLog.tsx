"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../shared/constants";
import { groupSystemErrors, systemErrorReport, type SystemError } from "./systemErrorReport";

const localDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });

export default function SystemErrorLog() {
  const [from, setFrom] = useState(() => localDate(-6));
  const [to, setTo] = useState(() => localDate());
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<SystemError[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setStatus("");
    try {
      const params = new URLSearchParams({ from, to, ...(search.trim() ? { q: search.trim() } : {}) });
      const response = await fetch(`${API_BASE}/admin/system-errors?${params}`, { credentials: "include", cache: "no-store" });
      const data = await response.json() as { ok: boolean; error?: string; errors?: SystemError[] };
      if (!response.ok || !data.ok || !Array.isArray(data.errors)) throw new Error(data.error || "No se pudo consultar el registro técnico.");
      setErrors(data.errors);
    } catch (error) { setStatus(error instanceof Error ? error.message : "No se pudo consultar el registro técnico."); }
    finally { setLoading(false); }
  }, [from, to, search]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const groups = useMemo(() => groupSystemErrors(errors), [errors]);
  const copy = async () => {
    const report = systemErrorReport(groups, from, to, errors.length);
    setCopyFallback("");
    try { await navigator.clipboard.writeText(report); setStatus("Reporte copiado. Pegalo en Codex tal cual; revisalo antes si lo vas a compartir con otras personas."); }
    catch { setCopyFallback(report); setStatus("El navegador no permitió copiar automáticamente: seleccioná el texto de abajo y copialo."); }
  };
  return <div className="mt-5">
    <p className="text-sm text-slate-500">
      Errores técnicos del servidor (sincronización, facturación, integraciones, errores no controlados) de los últimos 90 días. Las repeticiones del mismo error se agrupan. Puede incluir nombres de locales o personas: revisalo antes de compartirlo fuera del equipo.
    </p>
    <div className="mt-3 grid gap-3 md:grid-cols-4">
      <label className="text-sm font-bold">Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full rounded border p-2 font-normal" /></label>
      <label className="text-sm font-bold">Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full rounded border p-2 font-normal" /></label>
      <label className="text-sm font-bold md:col-span-2">Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Origen, local o texto del error" className="mt-1 block w-full rounded border p-2 font-normal" /></label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void load()} disabled={loading} className="rounded border p-2 font-bold disabled:opacity-50">{loading ? "Consultando…" : "Actualizar"}</button>
      <button type="button" onClick={() => void copy()} disabled={!groups.length} className="rounded bg-[#183a67] p-2 font-bold text-white disabled:opacity-50">Copiar reporte para Codex</button>
      <span className="text-sm text-slate-600">{errors.length} registro(s) · {groups.length} error(es) distinto(s)</span>
    </div>
    {status && <p role="status" className="mt-2 rounded bg-amber-100 p-2 text-sm">{status}</p>}
    {copyFallback && <textarea readOnly value={copyFallback} rows={10} className="mt-2 w-full rounded border p-2 font-mono text-xs" onFocus={(event) => event.target.select()} />}
    <div className="mt-4 overflow-auto rounded border">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Última vez</th><th className="p-3 text-left">Veces</th><th className="p-3 text-left">Origen</th><th className="p-3 text-left">Local</th><th className="p-3 text-left">Mensaje</th></tr></thead>
        <tbody>{groups.length ? groups.map((group) => <tr key={group.fingerprint} className="border-t align-top">
          <td className="p-3 whitespace-nowrap">{group.last}{group.count > 1 && <span className="block text-xs text-slate-500">desde {group.first}</span>}</td>
          <td className="p-3 font-bold">{group.count}</td>
          <td className="p-3 font-bold">{group.source}{group.routes.length > 0 && <span className="block text-xs font-normal text-slate-500">/{group.routes.join(", /")}</span>}</td>
          <td className="p-3">{group.sites.join(", ") || "—"}</td>
          <td className="p-3 break-words">{group.message}</td>
        </tr>) : <tr><td colSpan={5} className="p-4 text-center text-slate-500">{loading ? "Consultando…" : "Sin errores registrados en el período."}</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
