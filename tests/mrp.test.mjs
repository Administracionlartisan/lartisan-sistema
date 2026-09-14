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
  assert.match(panel, /Ninguna acción de esta pantalla escribe en Google Sheets/);
});

test("MRP operational records are stored separately with optimistic versioning", () => {
  assert.match(sync, /CREATE TABLE IF NOT EXISTS mrp_purchase_orders/);
  assert.match(sync, /CREATE TABLE IF NOT EXISTS mrp_receipts/);
  assert.match(sync, /CREATE TABLE IF NOT EXISTS mrp_weekly_controls/);
  assert.match(api, /row_version=row_version\+1 WHERE id=\? AND row_version=\?/);
  assert.match(api, /Otro usuario actualizó esta orden/);
});

test("MRP source refreshes automatically while retaining the last verified copy", () => {
  assert.match(api, /route === 'mrp\/latest'/);
  assert.match(api, /mrp_sync_from_google/);
  assert.match(api, /status='verified'/);
});
