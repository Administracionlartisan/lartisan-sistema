import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("action permissions are staged until an explicit save", () => {
  assert.match(source, /actionPermissionDrafts/);
  assert.match(source, /Guardar cambios/);
  assert.match(source, /saveActionPermissions\(profile\)/);
});

test("permission edits can be discarded before saving", () => {
  assert.match(source, /Cambios sin guardar/);
  assert.match(source, /Descartar/);
});

test("password recovery is integrated into registered users", () => {
  assert.match(source, /recuperaciones pendientes/);
  assert.match(source, /Atender recuperación/);
  assert.match(source, /Sin solicitud pendiente/);
});

test("the separate long recovery panel was removed", () => {
  assert.doesNotMatch(source, />Recuperación de contraseñas</);
});
