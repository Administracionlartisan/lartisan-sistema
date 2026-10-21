// Exclusivamente para la base ficticia local en 127.0.0.1:3313.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const base = "http://localhost:8081/sistema-api";
const headers = { Origin: "http://localhost:3210", "Content-Type": "application/json" };
const id = randomUUID();
const mysql = "C:/laragon/bin/mysql/mysql-8.4.3-winx64/bin/mysql.exe";
const sql = (query) => execFileSync(mysql, ["-h", "127.0.0.1", "-P", "3313", "-u", "lartisan_dev", "-N", "lartisan_dev", "-e", query], { encoding: "utf8", env: { ...process.env, MYSQL_PWD: "dev-local-only" } }).trim();
async function login(username) {
  const response = await fetch(`${base}/auth/login`, { method: "POST", headers, body: JSON.stringify({ username, password: "Pruebas2026!" }) });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}
async function call(cookie, path, body) {
  const response = await fetch(`${base}/${path}`, { method: body ? "POST" : "GET", headers: { ...headers, Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
sql(`INSERT INTO lartisan_stock_movements (id, site, product_id, movement_type, quantity, remito, detail, occurred_at, created_by) VALUES ('${id}', 'Recoleta', 1, 'Ingreso por remito', 2, 'PRUEBA', 'Datos ficticios', NOW(), 'Vendedora de Prueba')`);
const before = sql(`SELECT CONCAT(quantity, ':', detail) FROM lartisan_stock_movements WHERE id='${id}'`);
const stateBefore = sql("SELECT CONCAT(revision, ':', SHA2(state_json, 256)) FROM operation_site_states WHERE site='Recoleta'");
const seller = await login("vendedora.pruebas");
const supervisor = await login("supervisora.pruebas");
assert.equal((await call(seller, "stock/receipts?site=Maure")).status, 403);
assert.ok((await call(seller, "stock/receipts?site=Recoleta")).data.movements.some(row => row.id === id));
assert.equal((await call(seller, "stock/receipts", { site: "Recoleta", movementId: id, status: "revisado" })).status, 403);
assert.equal((await call(supervisor, "stock/receipts", { site: "Recoleta", movementId: id, status: "diferencia" })).status, 422);
assert.equal((await call(supervisor, "stock/receipts", { site: "Recoleta", movementId: id, status: "diferencia", observation: "Falta una unidad" })).status, 200);
const reviewed = (await call(seller, "stock/receipts?site=Recoleta")).data.movements.find(row => row.id === id);
assert.equal(reviewed.review_status, "diferencia");
assert.equal(reviewed.observation, "Falta una unidad");
assert.equal(sql(`SELECT CONCAT(quantity, ':', detail) FROM lartisan_stock_movements WHERE id='${id}'`), before);
assert.equal(sql("SELECT CONCAT(revision, ':', SHA2(state_json, 256)) FROM operation_site_states WHERE site='Recoleta'"), stateBefore);
console.log("Historial: lectura por local, permisos, auditoría de revisión y movimiento intacto: OK");
