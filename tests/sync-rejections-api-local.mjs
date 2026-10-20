// Integration test against the explicit local-only development API and DB.
// Un rechazo definitivo de /sync debe responder 422 (la cola se detiene y se
// conserva para conciliar), nunca 500 (la cola reintenta a ciegas).
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
const admin = await login("admin.pruebas");
const window = { site: "Maure", businessDate: "2026-10-15", label: "PRUEBA DE VALIDACIÓN", purpose: "Prueba automática local" };
const states = (await call(admin, "operations/states")).data.states;
const sync = (site, state) => call(admin, "sync", { site, requestId: randomUUID(), baseRevision: states[site].revision, baseState: states[site].state, state, event: { action: "Venta", detail: "Prueba local" } });

// La ventana de prueba de Maure se puede abrir y cerrar varias veces.
for (let round = 0; round < 2; round++) {
  assert.equal((await call(admin, "admin/test-operating-date/enable", window)).status, 200);
  assert.equal((await call(admin, "admin/test-operating-date/disable", {})).status, 200);
}
assert.equal((await call(admin, "operations/test-operating-date")).data.testOperatingDate.active, false);

// Con la ventana activa, una venta real de Maure se rechaza para conciliar.
assert.equal((await call(admin, "admin/test-operating-date/enable", window)).status, 200);
const realSale = { id: randomUUID(), site: "Maure", customer: "Cliente", createdAtISO: new Date().toISOString() };
const maure = await sync("Maure", { ...states.Maure.state, sales: [realSale, ...(states.Maure.state.sales || [])] });
assert.equal((await call(admin, "admin/test-operating-date/disable", {})).status, 200);
assert.equal(maure.status, 422, JSON.stringify(maure.data));
assert.match(maure.data.error, /ventana de prueba/);

// Abrir una caja a nombre de otra responsable también es un rechazo definitivo.
const cash = await sync("Novo Pacheco", { ...states["Novo Pacheco"].state, cashOpen: true, activeShift: { id: randomUUID(), site: "Novo Pacheco", openedBy: "Otra responsable" } });
assert.equal(cash.status, 422, JSON.stringify(cash.data));
assert.match(cash.data.error, /responsable/);

// Nada de lo rechazado quedó guardado.
const after = (await call(admin, "operations/states")).data.states;
assert.equal(after.Maure.revision, states.Maure.revision);
assert.equal(after["Novo Pacheco"].revision, states["Novo Pacheco"].revision);

// Un reintento con el mismo requestId (respuesta perdida) no aplica dos veces.
const pacheco = after["Novo Pacheco"];
const retried = { site: "Novo Pacheco", requestId: randomUUID(), baseRevision: pacheco.revision, baseState: pacheco.state, event: { action: "Incidencia", detail: "Prueba local" },
  state: { ...pacheco.state, incidents: [{ id: randomUUID(), site: "Novo Pacheco", detail: "Prueba de idempotencia" }, ...(pacheco.state.incidents || [])] } };
const first = await call(admin, "sync", retried);
const second = await call(admin, "sync", retried);
assert.equal(first.status, 200, JSON.stringify(first.data));
assert.equal(second.status, 200);
assert.equal(second.data.alreadyProcessed, true);
assert.equal(second.data.revision, first.data.revision);
assert.equal((await call(admin, "operations/states")).data.states["Novo Pacheco"].revision, pacheco.revision + 1);
console.log("API local: rechazos de /sync como 422, ventana de prueba reabrible, sin escrituras parciales y reintento idempotente OK");
