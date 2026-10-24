import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Caja ofrece ayuda contextual para toda carga manual", async () => {
  const [page, help] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/modules/shared/FieldHelp.tsx", root), "utf8"),
  ]);
  assert.match(help, /role="tooltip"/);
  assert.match(help, /group-hover:visible/);
  for (const field of ["Fondo inicial", "Ajuste \/ movimiento de caja", "Impacto del ajuste", "Importe", "Retiros", "Efectivo contado en caja", "Sobre en efectivo", "Motivo de la diferencia"]) {
    assert.match(page, new RegExp(`${field}[\\s\\S]{0,500}<FieldHelp>`), `${field} debe tener ayuda contextual`);
  }
});
