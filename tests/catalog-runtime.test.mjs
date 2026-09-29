import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, createFetchMock } from 'miniflare';

test('el endpoint carga y guarda dentro de workerd, sin conexiones externas reales', async () => {
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  const api = fetchMock.get('https://www.lartisantaller.com');
  api.intercept({ path: '/sistema-api/auth/me', method: 'GET' }).reply(200, JSON.stringify({ user: { id: 1, role: 'administracion' } })).persist();
  api.intercept({ path: '/sistema-api/operations/states', method: 'GET' }).reply(200, JSON.stringify({ states: { Recoleta: { state: { prices: { 1: 9000 } } } } })).persist();
  const bundle = await build({
    stdin: { contents: 'import {GET,PUT} from "./app/api/catalog/route.ts"; export default {fetch(request) { return request.method === "PUT" ? PUT(request) : GET(request); }}', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  });
  const worker = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', script: bundle.outputFiles[0].text, d1Databases: ['DB'], fetchMock });
  try {
    const db = await worker.getD1Database('DB');
    await db.exec(readFileSync('drizzle/0000_opposite_reavers.sql', 'utf8').replace(/\r?\n/g, ' '));
    const headers = { Cookie: 'lartisan_session=abc123', Origin: 'https://admin.lartisantaller.com' };
    const response = await worker.dispatchFetch('https://admin.lartisantaller.com/api/catalog', { headers });
    assert.equal(response.status, 200, await response.clone().text());
    const doc = await response.json();
    assert.equal(doc.products[0].price, 9000);
    const saved = await worker.dispatchFetch('https://admin.lartisantaller.com/api/catalog', { method: 'PUT', headers, body: JSON.stringify(doc) });
    assert.equal(saved.status, 200, await saved.clone().text());
    const reloaded = await worker.dispatchFetch('https://admin.lartisantaller.com/api/catalog', { headers });
    assert.equal((await reloaded.json()).revision, 1);
  } finally { await worker.dispose(); await fetchMock.close(); }
});
