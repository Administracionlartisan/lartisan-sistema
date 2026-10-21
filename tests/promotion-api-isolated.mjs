// Exclusivamente para la instancia descartable localhost:3314.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = "http://127.0.0.1:8085/sistema-api";
const headers = { Origin: "http://localhost:3000", "Content-Type": "application/json" };
const sql = (query) => execFileSync("C:/laragon/bin/mysql/mysql-8.4.3-winx64/bin/mysql.exe", ["--no-defaults", "--protocol=TCP", "--host=127.0.0.1", "--port=3314", "--user=root", "lartisan_dev", "--execute", query]);
async function login(username) {
  const response = await fetch(`${base}/auth/login`, { method: "POST", headers, body: JSON.stringify({ username, password: "Pruebas2026!" }) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get("set-cookie").split(";")[0];
}
async function get(cookie, path) {
  const response = await fetch(`${base}/${path}`, { headers: { ...headers, Cookie: cookie } });
  return { status: response.status, data: await response.json() };
}
const admin = await login("admin.pruebas");
await get(admin, "admin/report-sales?from=2026-10-19&to=2026-10-25");
sql(`UPDATE users SET report_permissions='["Resumen"]' WHERE username='supervisora.pruebas';
INSERT INTO lartisan_sales (id,site,occurred_at,status) VALUES ('test-promo-1','Recoleta','2026-10-19 10:00:00','activa'),('test-promo-2','Recoleta','2026-10-20 10:00:00','activa'),('test-promo-3','Recoleta','2026-10-20 10:00:00','anulada'),('test-promo-4','Maure','2026-10-20 10:00:00','activa'),('test-promo-5','Recoleta','2026-10-21 10:00:00','activa');
INSERT INTO operation_site_states (site,state_json,revision) VALUES ('Recoleta','{"sales":[{"id":"test-promo-1","promotion":"15% efectivo"},{"id":"test-promo-3","promotion":"15% efectivo"}]}',1),('Maure','{"sales":[{"id":"test-promo-4","promotion":"15% efectivo"}]}',1);
INSERT INTO operation_archive (site,field,item_key,item_json) VALUES ('Recoleta','sales','test-promo-2','{"id":"test-promo-2","promotion":"10% débito"}');`);
const supervisor = await login("supervisora.pruebas");
const seller = await login("vendedora.pruebas");
const result = await get(supervisor, "reports/promotions?from=2026-10-19&to=2026-10-25");
assert.equal(result.status, 200, JSON.stringify(result.data));
assert.deepEqual(result.data.rows.sort((a,b) => a.promotion.localeCompare(b.promotion)), [{site:"Recoleta",promotion:"10% débito",count:1},{site:"Recoleta",promotion:"15% efectivo",count:1}]);
assert.equal(result.data.unavailable, 1);
assert.equal((await get(seller, "reports/promotions?from=2026-10-19&to=2026-10-25")).status, 403);
assert.equal((await get(supervisor, "reports/promotions?from=2026-10-19&to=2026-10-27")).status, 422);
console.log("Informe: estado, archivo, anuladas, faltantes, permisos y locales verificados.");
