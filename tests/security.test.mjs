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
  assert.match(api, /operational_snapshot_for_user\(\$user,\s*\$state\)/);
  assert.doesNotMatch(api, /\$body\['eventType'\]/);
  assert.match(api, /'operacion_actualizada'/);
});

test("public user responses never include password material", () => {
  const bootstrap = read("donweb-api/bootstrap.php");
  const publicUser = bootstrap.slice(bootstrap.indexOf("function public_user"), bootstrap.indexOf("function ensure_user_locations_schema"));
  assert.doesNotMatch(publicUser, /password_hash|passwordHash|temporaryPassword/);
});
