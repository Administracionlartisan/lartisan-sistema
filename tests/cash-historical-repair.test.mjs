import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("la reparación histórica exige una decisión explícita y un cierre real", async () => {
  const [page, api] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("donweb-api/cash_sheet_sync.php", root), "utf8"),
  ]);
  assert.match(page, /Reparación histórica sin registro/);
  assert.match(page, /historicalRepair: dailyCashHistoricalRepair/);
  assert.match(api, /if \(!\$historicalRepair\) throw new InvalidArgumentException\('No hay un cierre sincronizado/);
  assert.match(api, /SELECT id FROM lartisan_cash_sessions WHERE site=\? AND closed_at IS NOT NULL AND DATE\(closed_at\)=\?/);
  assert.match(api, /cash_sheet_historical_repaired/);
});
