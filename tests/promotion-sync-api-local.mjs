// Solo para la API aislada en 8085 y su base descartable.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:8085/sistema-api';
const headers = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'vendedora.pruebas', password: 'Pruebas2026!' }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
async function call(path, body) {
  const res = await fetch(`${base}/${path}`, { method: body ? 'POST' : 'GET', headers: { ...headers, Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
}
const before = (await call('operations/states')).data.states.Recoleta;
const original = before.state.sales.find((s) => s.promotionId && s.id.startsWith('251a5f58'));
assert.ok(original, 'la venta ficticia de pantalla debe existir');
const id = randomUUID();
const invalid = { ...original, id, promotionId: randomUUID(), createdAtISO: new Date().toISOString() };
const attempt = await call('sync', { site: 'Recoleta', requestId: randomUUID(), baseRevision: before.revision, baseState: before.state, state: { ...before.state, sales: [invalid, ...before.state.sales] }, event: { action: 'Venta', detail: 'promoción inválida de prueba' } });
assert.equal(attempt.status, 422, JSON.stringify(attempt.data));
assert.match(attempt.data.error, /promoción/);
const after = (await call('operations/states')).data.states.Recoleta;
assert.equal(after.revision, before.revision);
assert.ok(!after.state.sales.some((s) => s.id === id));
console.log('Promoción inválida rechazada sin confirmar ni alterar estado.');
