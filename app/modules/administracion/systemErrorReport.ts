export type SystemError = { id: number; at: string; source: string; site: string; route: string; userName: string; message: string; fingerprint: string };
export type ErrorGroup = { fingerprint: string; source: string; message: string; count: number; first: string; last: string; sites: string[]; routes: string[]; users: string[] };

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/** Agrupa las repeticiones del mismo error (misma huella del servidor). */
export function groupSystemErrors(errors: SystemError[]): ErrorGroup[] {
  const groups = new Map<string, SystemError[]>();
  for (const error of errors) groups.set(error.fingerprint, [...(groups.get(error.fingerprint) ?? []), error]);
  return [...groups.values()].map((items) => {
    const sorted = [...items].sort((left, right) => left.at.localeCompare(right.at));
    const latest = sorted[sorted.length - 1];
    return { fingerprint: latest.fingerprint, source: latest.source, message: latest.message, count: items.length, first: sorted[0].at, last: latest.at,
      sites: unique(items.map((item) => item.site)), routes: unique(items.map((item) => item.route)), users: unique(items.map((item) => item.userName)) };
  }).sort((left, right) => right.last.localeCompare(left.last));
}

/** Texto listo para pegar en Codex u otro agente: contexto, reglas y errores agrupados. */
export function systemErrorReport(groups: ErrorGroup[], from: string, to: string, total: number, generatedAt = new Date()): string {
  const lines = [
    `## Errores del sistema L'Artisan (${from} a ${to})`,
    "",
    `Generado desde Administración → Registro técnico el ${generatedAt.toLocaleString("es-AR")}. ${total} registro(s), ${groups.length} error(es) distinto(s).`,
    "",
    "Antes de corregir: leé AGENTS.md, reproducí el error en el entorno local (dev/README.md) y corré `npm run check`. No uses datos reales ni hagas pruebas en producción.",
  ];
  groups.forEach((group, index) => {
    lines.push("", `### ${index + 1}. ${group.source} — ${group.count} ${group.count === 1 ? "vez" : "veces"}`,
      `- Primera vez: ${group.first} · Última vez: ${group.last}`,
      ...(group.sites.length ? [`- Local(es): ${group.sites.join(", ")}`] : []),
      ...(group.routes.length ? [`- Ruta de la API: ${group.routes.map((route) => `/${route}`).join(", ")}`] : []),
      `- Mensaje: ${group.message}`);
  });
  return lines.join("\n");
}
