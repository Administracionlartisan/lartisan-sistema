// Integration test against the explicit local-only development API and DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = "http://localhost:8080/sistema-api";
const headers = { Origin: "http://localhost:3210", "Content-Type": "application/json" };
async function login(username) {
  const response = await fetch(`${base}/auth/login`, { method: "POST", headers, body: JSON.stringify({ username, password: "Pruebas2026!" }) });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}
async function call(cookie, path, body) {
  const response = await fetch(`${base}/${path}`, { method: body ? "POST" : "GET", headers: { ...headers, Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const seller = await login("vendedora.pruebas");
const supervisor = await login("supervisora.pruebas");
const id = randomUUID();
const payload = { site: "Recoleta", id, destination: "API local", carrier: "Test", reason: "Test", lines: [{ productId: 1, quantity: 1 }] };
assert.equal((await call(seller, "stock/outflows", payload)).status, 200);
assert.equal((await call(seller, "stock/outflows", payload)).status, 200);
assert.equal((await call(seller, `stock/outflows/${id}/approve`, { site: "Recoleta" })).status, 403);
assert.equal((await call(seller, "stock/outflows?site=Maure")).status, 403);
assert.equal((await call(seller, "stock/outflows")).status, 403);
assert.ok((await call(supervisor, "stock/outflows")).data.pending.some((row) => row.site === "Recoleta"));
assert.equal((await call(supervisor, `stock/outflows/${id}/approve`, { site: "Recoleta" })).status, 200);
assert.equal((await call(supervisor, `stock/outflows/${id}/approve`, { site: "Recoleta" })).status, 409);
const list = (await call(supervisor, "stock/outflows?site=Recoleta")).data.requests;
assert.equal(list.filter((row) => row.id === id).length, 1);
assert.equal(list.find((row) => row.id === id).status, "Aprobado");
console.log("API local: idempotent request, scoped permissions, alert, approval and duplicate rejection OK");
