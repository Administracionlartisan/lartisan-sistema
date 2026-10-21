// Se ejecuta exclusivamente contra la instancia aislada 3314 / 8085.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const db = 'C:/laragon/bin/mysql/mysql-8.4.3-winx64/bin/mysql.exe';
execFileSync(db, ['--no-defaults', '--protocol=TCP', '--host=127.0.0.1', '--port=3314', '--user=root', 'lartisan_dev', '--execute', `UPDATE users SET action_permissions='["gestionarPromociones"]' WHERE username='supervisora.pruebas'`]);
const base = 'http://127.0.0.1:8085/sistema-api';
const headers = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
async function login(username) {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username, password: 'Pruebas2026!' }) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get('set-cookie').split(';')[0];
}
async function call(cookie, path, method = 'GET', body) {
  const response = await fetch(`${base}/${path}`, { method, headers: { ...headers, Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const supervisor = await login('supervisora.pruebas');
const seller = await login('vendedora.pruebas');
const date = new Date();
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const draft = { name: 'Campaña aislada', percentage: 15, startsOn: day, endsOn: day, sites: ['Recoleta'], productIds: null };
assert.equal((await call(seller, 'promotions', 'POST', draft)).status, 403);
assert.equal((await call(supervisor, 'promotions', 'POST', { ...draft, sites: ['Maure'] })).status, 403);
assert.equal((await call(supervisor, 'promotions', 'POST', { ...draft, percentage: 101 })).status, 422);
const created = await call(supervisor, 'promotions', 'POST', draft);
assert.equal(created.status, 200, JSON.stringify(created.data));
const productCampaign = await call(supervisor, 'promotions', 'POST', { ...draft, name: 'Producto aislado', productIds: [1] });
assert.equal(productCampaign.status, 200, JSON.stringify(productCampaign.data));
const list = await call(seller, 'promotions?site=Recoleta');
assert.equal(list.status, 200, JSON.stringify(list.data));
assert.ok(list.data.promotions.some((item) => item.id === created.data.id && item.percentage === 15));
assert.deepEqual(list.data.promotions.find((item) => item.id === productCampaign.data.id)?.productIds, [1]);
assert.equal((await call(seller, 'promotions?site=Maure')).status, 403);
console.log('Promociones: creación, permisos y locales verificados.');
