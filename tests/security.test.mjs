import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = [
  read("app/page.tsx"),
  read("app/data/assistantKnowledge.ts"),
  read("app/data/reportGuide.ts"),
].join("\n");
const api = [read("donweb-api/bootstrap.php"), read("donweb-api/index.php"), read("donweb-api/pnl_sync.php")].join("\n");

test("the public bundle contains no internal Drive URLs, employee directory or administrative email", () => {
  assert.doesNotMatch(client, /docs\.google\.com|const\s+USERS\s*=|[\w.+-]+@lartisantaller\.com/i);
});

test("financial source identifiers are configuration-only", () => {
  assert.doesNotMatch(api, /spreadsheets\/d\/|spreadsheet_id'\]\s*\?\?\s*'[A-Za-z0-9_-]{20,}'/);
  assert.match(api, /pnl_sync'\]\['spreadsheet_id'\]\s*\?\?\s*''/);
});

test("operational state is authorized and filtered on the server", () => {
  assert.match(api, /authorize_operational_snapshot\(\$user,\s*\$previousState,\s*\$state\)/);
  // El filtro se aplica por local: cada usuario recibe solo los límites propios.
  assert.match(api, /operational_snapshot_for_user\(\$user,\s*\$state,\s*\(string\) \$row\['site'\]\)/);
  assert.doesNotMatch(api, /\$body\['eventType'\]/);
  assert.match(api, /'operacion_actualizada'/);
});

test("server authorization never depends on personal usernames", () => {
  const server = ["donweb-api/bootstrap.php", "donweb-api/index.php", "donweb-api/mrp_sync.php"].map(read).join("\n");
  assert.doesNotMatch(server, /yamila|valentina|jhaiber|betzi|betzy/i);
  assert.match(server, /user_can_action\(\$user, 'stockMrp'\)/);
  assert.match(server, /'comprasProduccion', user_action_permissions\(\$user\)/);
});

test("central sees only orders and adjustments of the sites it does not operate", () => {
  const bootstrap = read("donweb-api/bootstrap.php");
  const index = read("donweb-api/index.php");
  const view = bootstrap.slice(bootstrap.indexOf("function central_site_view"), bootstrap.indexOf("function authorize_central_changes"));
  assert.match(view, /'stockRequests' =>/);
  assert.match(view, /'stockAdjustments' =>/);
  assert.doesNotMatch(view, /'sales'|'cash|'stock' =>|'payments'/);
  assert.match(index, /\$centralOnly \? central_site_view\(\$state\)/);
  assert.match(index, /authorize_central_changes\(\$user, \$previousState/);
});

test("public user responses never include password material", () => {
  const bootstrap = read("donweb-api/bootstrap.php");
  const publicUser = bootstrap.slice(bootstrap.indexOf("function public_user"), bootstrap.indexOf("function ensure_user_locations_schema"));
  assert.doesNotMatch(publicUser, /password_hash|passwordHash|temporaryPassword/);
});

test("sessions expire both by total duration and by inactivity", () => {
  const bootstrap = read("donweb-api/bootstrap.php");
  const config = read("donweb-api/config.example.php");
  const page = read("app/page.tsx");
  assert.match(bootstrap, /last_seen_at > DATE_SUB\(NOW\(\), INTERVAL \$idleMinutes MINUTE\)/);
  assert.match(bootstrap, /session_idle_minutes.*\?\? 30/);
  assert.match(bootstrap, /INSERT INTO user_sessions \(id, user_id, expires_at, last_seen_at\).*NOW\(\)/);
  assert.match(config, /'session_idle_minutes' => 30/);
  assert.match(page, /La sesión se cerró por 30 minutos sin actividad/);
});

test("order reception has a manual fallback when the scanner is unavailable", () => {
  const page = read("app/page.tsx");
  const help = read("app/data/assistantKnowledge.ts");
  assert.match(page, /Recepción manual/);
  assert.match(page, /adjustManualReceptionCount/);
  assert.match(page, /Math\.min\(expected, current \+ change\)/);
  assert.match(help, /Si la lectora falla/);
});

