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

test("editing a user without permissions keeps the stored ones (NULL = role defaults)", () => {
  const api = readFileSync(new URL("../donweb-api/index.php", import.meta.url), "utf8");
  assert.match(api, /\$actionPermissionsValue = array_key_exists\('actionPermissions', \$body\) \? json_encode\(\$actionPermissions, JSON_UNESCAPED_UNICODE\) : \$existing\['action_permissions'\];/);
  assert.match(api, /\$reportPermissionsValue = array_key_exists\('reportPermissions', \$body\)/);
});

test("administration can grant and revoke supervisor personnel and overview permissions", () => {
  assert.match(source, /\["administracion", "supervisora"\]\.includes\(profile\.role\)/);
  assert.match(source, /\["Personal", "Resumen"\]\.includes\(report\.id\)/);
  assert.match(source, /profile\.role === "administracion" && checked && profile\.reportPermissions\.length === 1/);
  assert.match(source, /user\?\.role === "supervisora" && user\.reportPermissions\.includes\("Personal"\)/);
  assert.match(source, /user\?\.role === "supervisora" && user\.reportPermissions\.length > 0/);
});
