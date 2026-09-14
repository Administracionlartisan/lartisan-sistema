import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("app/page.tsx");
const api = read("donweb-api/index.php");
const bootstrap = read("donweb-api/bootstrap.php");
const outbox = read("app/modules/shared/operationalOutbox.ts");
const monitor = read("donweb-api/monitor.php");

test("operational writes are queued locally and idempotent on the server", () => {
  assert.match(page, /savePendingWrite/);
  assert.match(page, /flushPendingWrites/);
  assert.match(outbox, /localStorage/);
  assert.match(outbox, /requestId/);
  assert.match(outbox, /sort\(\(left, right\) => left\.queuedAt/);
  assert.match(api, /operation_requests/);
  assert.match(api, /requestId/);
  assert.match(api, /baseState/);
  assert.match(bootstrap, /merge_operational_snapshot/);
});

test("monitoring supports visible heartbeats and unattended scheduled alerts", () => {
  assert.match(page, /monitoring\/heartbeat/);
  assert.match(bootstrap, /notify_monitoring_alerts/);
  assert.match(bootstrap, /cooldown_hours/);
  assert.match(monitor, /PHP_SAPI !== 'cli'/);
  assert.match(monitor, /notify_monitoring_alerts/);
});

test("administration exposes filtered audit, cash and historical report endpoints", () => {
  for (const route of ["admin/audit", "admin/cash-history", "admin/report-sales", "admin/history/import"]) {
    assert.match(api, new RegExp(route.replace("/", "\\/")));
    assert.match(page, new RegExp(route.replace("/", "\\/")));
  }
  assert.match(page, /auditUserFilter/);
  assert.match(page, /auditActionFilter/);
  assert.match(page, /exportAdminReport/);
  assert.match(page, /const batchSize = 25/);
  assert.match(page, /"Content-Type": "text\/plain;charset=UTF-8"/);
  assert.match(page, /Importando historial:/);
  assert.match(bootstrap, /historical_datetime/);
  assert.match(bootstrap, /historical_number/);
});
