import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

// Ejecuta los módulos reales con SQLite y un upstream de identidad controlado.
// No agrega rutas, credenciales ni bypass de autenticación a producción.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = new Map();
function moduleUrl(file) {
  if (modules.has(file)) return modules.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/import \{ env \} from "cloudflare:workers";/, 'const env = globalThis.__testCatalogEnv;');
  code = code.replace(/from "(\.[^"]+)"/g, (_, path) => 'from "' + moduleUrl(resolve(dirname(file), path + '.ts')) + '"');
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  modules.set(file, url);
  return url;
}
const model = await import(moduleUrl(resolve(root, 'app/modules/config/catalogModel.ts')));
const { PRODUCTS } = await import(moduleUrl(resolve(root, 'app/modules/config/operationalCatalog.ts')));
const seed = PRODUCTS.map(p => ({ ...p, onlinePrice: p.price * 1.25, barcodeAliases: p.code === '501' ? ['LART-401'] : [] }));
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync(resolve(root, 'drizzle/0000_opposite_reavers.sql'), 'utf8'));
globalThis.__testCatalogEnv = { DB: { prepare(query) {
  const stmt = sql.prepare(query);
  let args = [];
  return { bind(...values) { args = values; return this; }, async first() { return stmt.get(...args) ?? null; }, async run() { return stmt.run(...args); } };
} } };
const api = await import(moduleUrl(resolve(root, 'app/api/catalog/route.ts')));
const nativeFetch = globalThis.fetch;
let role = 'administracion', mustChange = false, upstreamStatus = 200;
globalThis.fetch = async (url, options) => {
  assert.match(String(url), /^https:\/\/www\.lartisantaller\.com\/sistema-api\/(auth\/me|operations\/states)$/);
  assert.equal(options.headers.Cookie, 'lartisan_session=abc123');
  assert.equal(options.redirect, 'manual', 'workerd no acepta redirect:error; tampoco seguir redirecciones con la cookie');
  if (String(url).endsWith('/auth/me')) return Response.json({ user: { id: 1, role, mustChangePassword: mustChange } }, { status: upstreamStatus });
  return Response.json({ states: { Recoleta: { state: { prices: { 1: 9000 }, onlinePrices: { 1: 11000 } } } } });
};
const request = (method = 'GET', body, headers = {}) => new Request('https://admin.lartisantaller.com/api/catalog', {
  method, headers: { cookie: 'unrelated=secret; lartisan_session=abc123', origin: 'https://admin.lartisantaller.com', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
test.after(() => { globalThis.fetch = nativeFetch; sql.close(); delete globalThis.__testCatalogEnv; });

test('conserva IDs y todos los códigos actuales; reconoce ceros y apóstrofe', () => {
  assert.equal(seed.length, 57);
  assert.deepEqual(model.validateCatalog(seed, seed), seed);
  assert.equal(model.findScannedProduct(seed, "LART'001").code, '001');
  assert.equal(model.findScannedProduct(seed, "LART'401").code, '501');
  assert.equal(model.findScannedProduct(seed, 'prefijoLART-501').code, '501');
  assert.equal(model.findScannedProduct(seed, 'LART-9999'), undefined);
});
test('editar código conserva ambas etiquetas anteriores; se rechaza duplicado y alias ajeno', () => {
  const changed = model.validateCatalog(seed.map(p => p.code === '501' ? { ...p, barcode: 'LART-777' } : p), seed);
  const product = changed.find(p => p.code === '777');
  assert.deepEqual(product.barcodeAliases, ['LART-401', 'LART-501']);
  assert.equal(model.findScannedProduct(changed, "LART'501").id, product.id);
  assert.equal(model.findScannedProduct(changed, "LART'777").id, product.id);
  assert.throws(() => model.validateCatalog(changed.map(p => p.id === 1 ? { ...p, barcode: 'LART-401' } : p), changed), /ya pertenece/);
});
test('altas seguras, sin reasignar IDs, borrar historial o aceptar precios inválidos', () => {
  const added = { ...seed[0], id: 58, name: 'Producto de prueba', code: '999', barcode: 'LART-999', barcodeAliases: [] };
  assert.equal(model.validateCatalog([...seed, added], seed).length, 58);
  assert.throws(() => model.validateCatalog(seed.slice(1), seed), /eliminar/);
  assert.throws(() => model.validateCatalog([...seed, { ...added, id: 900 }], seed), /asignar/);
  for (const price of [-1, NaN, Infinity, '12']) assert.throws(() => model.validateCatalog(seed.map((p, i) => i ? p : { ...p, price }), seed), /precios/);
});
test('API exige sesión, origen válido y Administración para guardar', async () => {
  assert.equal((await api.GET(request('GET', undefined, { cookie: '' }))).status, 401);
  assert.equal((await api.PUT(request('PUT', {}, { origin: 'https://ajeno.example' }))).status, 403);
  for (const candidate of ['vendedora', 'supervisora']) {
    role = candidate;
    assert.equal((await api.GET(request())).status, 200);
    assert.equal((await api.PUT(request('PUT', {}))).status, 403);
  }
  role = 'administracion'; mustChange = true;
  assert.equal((await api.GET(request())).status, 403);
  mustChange = false; upstreamStatus = 401;
  assert.equal((await api.GET(request())).status, 401);
  upstreamStatus = 200;
});
test('una redirección de identidad no concede acceso ni se sigue con la cookie', async () => {
  upstreamStatus = 302;
  assert.equal((await api.GET(request())).status, 503);
  assert.equal((await api.PUT(request('PUT', {}))).status, 503);
  upstreamStatus = 200;
});

test('una falla TLS bloquea carga y guardado con explicación, sin omitir seguridad', async () => {
  upstreamStatus = 526;
  try {
    const response = await api.GET(request());
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /certificado/);
    assert.equal((await api.PUT(request('PUT', seed))).status, 503);
  } finally { upstreamStatus = 200; }
});
test('migración guarda precios vigentes; recarga persiste y conflicto no sobrescribe', async () => {
  const initial = await (await api.GET(request())).json();
  assert.equal(initial.revision, 0);
  assert.equal(initial.products[0].price, 9000);
  assert.equal(initial.products[0].onlinePrice, 11000);
  assert.equal((await api.PUT(request('PUT', initial))).status, 200);
  assert.equal((await api.PUT(request('PUT', initial))).status, 409);
  const saved = await (await api.GET(request())).json();
  assert.equal(saved.revision, 1);
  saved.products[0].barcode = 'LART-998';
  assert.equal((await api.PUT(request('PUT', saved))).status, 200);
  const reloaded = await (await api.GET(request())).json();
  assert.equal(reloaded.products[0].barcode, 'LART-998');
  assert.deepEqual(reloaded.products[0].barcodeAliases, ['LART-010']);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM catalog_revisions').get().n, 2);
});
test('duplicados y cuerpos inválidos no crean revisiones', async () => {
  const saved = await (await api.GET(request())).json();
  saved.products[0].barcode = saved.products[1].barcode;
  assert.equal((await api.PUT(request('PUT', saved))).status, 422);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM catalog_revisions').get().n, 2);
});
