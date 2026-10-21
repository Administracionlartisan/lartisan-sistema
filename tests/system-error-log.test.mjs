import assert from "node:assert/strict";
import test from "node:test";
import { groupSystemErrors, systemErrorReport } from "../app/modules/administracion/systemErrorReport.ts";

const row = (id, at, fingerprint, extra = {}) => ({ id, at, fingerprint, source: "operation sync failed", site: "Maure", route: "sync", userName: "Dharling", message: "autorizar: ventana de prueba activa", ...extra });

test("las repeticiones del mismo error se agrupan con primera y última vez", () => {
  const groups = groupSystemErrors([
    row(3, "2026-10-20 10:05:00", "a"), row(1, "2026-10-20 09:00:00", "a", { site: "Recoleta" }),
    row(2, "2026-10-20 09:30:00", "b", { source: "assistant failed", site: "" }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual([groups[0].fingerprint, groups[0].count, groups[0].first, groups[0].last], ["a", 2, "2026-10-20 09:00:00", "2026-10-20 10:05:00"]);
  assert.deepEqual(groups[0].sites, ["Maure", "Recoleta"]);
  assert.deepEqual(groups[1].sites, []);
});

test("el reporte para Codex incluye reglas del proyecto y cada error con su contexto", () => {
  const report = systemErrorReport(groupSystemErrors([row(1, "2026-10-20 09:00:00", "a"), row(2, "2026-10-20 09:10:00", "a")]), "2026-10-14", "2026-10-20", 2, new Date("2026-10-20T12:00:00Z"));
  assert.match(report, /AGENTS\.md/);
  assert.match(report, /No uses datos reales ni hagas pruebas en producción/);
  assert.match(report, /### 1\. operation sync failed — 2 veces/);
  assert.match(report, /- Local\(es\): Maure/);
  assert.match(report, /- Ruta de la API: \/sync/);
  assert.match(report, /- Mensaje: autorizar: ventana de prueba activa/);
});
