import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const page = await readFile(new URL("app/page.tsx", root), "utf8");
const panel = await readFile(new URL("app/modules/administracion/MrpPanel.tsx", root), "utf8");
const api = await readFile(new URL("donweb-api/index.php", root), "utf8");
const sync = await readFile(new URL("donweb-api/mrp_sync.php", root), "utf8");

test("MRP appears for any authenticated role with the explicit permission", () => {
  assert.match(page, /\.\.\.\(can\("mrp"\) \? \["MRP"\] : \[\]\)/);
  assert.match(page, /tab === "MRP" && can\("mrp"\)/);
});

test("Google MRP integration is read-only and never calls a Sheets write endpoint", () => {
  assert.match(sync, /values:batchGet/);
  assert.doesNotMatch(sync, /values:append|values:batchUpdate|spreadsheets\.batchUpdate/);
  assert.match(panel, /no modifica el archivo original/);
});

test("MRP operational records are stored separately with optimistic versioning", () => {
  assert.match(sync, /CREATE TABLE IF NOT EXISTS mrp_purchase_orders/);
  assert.match(sync, /CREATE TABLE IF NOT EXISTS mrp_receipts/);
  assert.match(sync, /CREATE TABLE IF NOT EXISTS mrp_weekly_controls/);
  assert.match(api, /row_version=row_version\+1 WHERE id=\? AND row_version=\?/);
  assert.match(api, /Otro usuario actualizó esta orden/);
});

test("MRP reads its saved copy without Google refresh or OAuth", () => {
  assert.match(api, /route === 'mrp\/latest'/);
  const latest = api.split("$route === 'mrp/latest'")[1].split("$route === 'mrp/sync'")[0];
  assert.doesNotMatch(latest, /mrp_sync_from_google|pnl_is_connected|pnl_access_token/);
  assert.match(api, /status='verified'/);
  assert.doesNotMatch(panel, /Preparando importación|Conectar lectura de Google/);
});

test("One-time import requires admin and trusted origin, and verifies atomically", () => {
  const route = api.split("$route === 'mrp/import'")[1].split("$route === 'mrp/operations'")[0];
  assert.match(route, /require_user\(\$pdo, \['administracion'\]\)/);
  assert.match(route, /HTTP_ORIGIN/);
  assert.match(sync, /GET_LOCK\('lartisan_mrp_import'/);
  assert.match(sync, /alreadyImported/);
  assert.match(sync, /SELECT COUNT\(\*\) FROM/);
  assert.doesNotMatch(sync, /\.\.\.\$recipeSnapshot/);
});
