// Run only against the two isolated local PHP servers and disposable database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const bases = [8080, 8081].map(port => `http://localhost:${port}/sistema-api`);
const headers = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
async function login(base, username) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username, password: 'Pruebas2026!' }) });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
async function call(base, cookie, path, payload) {
  const r = await fetch(`${base}/stock/outflows${path}`, { method: payload ? 'POST' : 'GET', headers: { ...headers, Cookie: cookie }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  return { status: r.status, body: await r.json() };
}
function stock() {
  const output = execFileSync('C:/laragon/bin/mysql/mysql-8.4.3-winx64/bin/mysql.exe', ['--host=127.0.0.1', '--port=3313', '--user=lartisan_dev', '--batch', '--skip-column-names', 'lartisan_dev'], { env: { ...process.env, MYSQL_PWD: 'dev-local-only' }, input: "SELECT JSON_UNQUOTE(JSON_EXTRACT(state_json, '$.stock.\"1\"')) FROM operation_site_states WHERE site='Recoleta';", encoding: 'utf8' });
  return Number(output.trim());
}
const seller = await login(bases[0], 'vendedora.pruebas');
const approvers = await Promise.all(bases.map(base => login(base, 'supervisora.pruebas')));
const before = stock();
assert.ok(before >= 1, 'La base ficticia necesita stock suficiente');
const id = randomUUID();
assert.equal((await call(bases[0], seller, '', { id, site: 'Recoleta', destination: 'Concurrencia local', carrier: 'Prueba', reason: 'Prueba aislada', lines: [{ productId: 1, quantity: 1 }] })).status, 200);
const decisions = await Promise.all(bases.map((base, i) => call(base, approvers[i], `/${id}/approve`, { site: 'Recoleta' })));
assert.deepEqual(decisions.map(x => x.status).sort(), [200, 409]);
assert.equal(stock(), before - 1, 'El stock debe disminuir exactamente una unidad');
const list = await call(bases[0], approvers[0], '?site=Recoleta');
assert.equal(list.body.requests.filter(item => item.id === id && item.status === 'Aprobado').length, 1);
console.log('Aprobaciones simultáneas: una confirmada, otra rechazada y un solo descuento.');
