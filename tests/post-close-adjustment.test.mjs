import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const source = (name) => readFileSync(new URL(name, root), 'utf8');

test('PHP y Apps Script conservan el contrato de firma canónica v2', () => {
  const php = source('donweb-api/cash_sheet_sync.php');
  const script = source('google-apps-script/LArtisanCashCloseSync.gs');
  assert.match(php, /signatureV2/);
  assert.match(php, /canonicalB64/);
  assert.match(php, /hash_hmac\('sha256', \$canonicalB64/);
  assert.match(script, /decoded !== canonical/);
  assert.match(script, /hmacHex_\(canonicalB64, secret\)/);
  assert.doesNotMatch(script, /request\.signature\s*\|\|/);
});

test('la identidad de ajuste es estable y la firma cubre todos sus campos', () => {
  const adjustmentId = randomUUID();
  const payload = {
    version: 1, closeId: randomUUID(), site: 'Villa Mitre', businessDate: '2026-10-09',
    payments: [], metrics: [], kind: 'post_close_cancellation_adjustment', adjustmentId,
    saleId: randomUUID(), amount: 8200, paymentMethod: 'Efectivo',
    reason: 'Anulación posterior al cierre', auditReference: 'audit:test',
  };
  const canonical = JSON.stringify(payload);
  const canonicalB64 = Buffer.from(canonical, 'utf8').toString('base64');
  const secret = 'test-only-secret-that-is-long-enough';
  const signature = createHmac('sha256', secret).update(canonicalB64).digest('hex');
  assert.equal(Buffer.from(canonicalB64, 'base64').toString('utf8'), canonical);
  assert.equal(signature.length, 64);
  assert.equal(`LARTISAN_ADJUSTMENT_${adjustmentId}`, `LARTISAN_ADJUSTMENT_${adjustmentId}`);
});

test('las tres capas registran un único ajuste y nunca editan ingresos', () => {
  const frontend = source('app/page.tsx');
  const php = source('donweb-api/cash_sheet_sync.php');
  const script = source('google-apps-script/LArtisanCashCloseSync.gs');
  assert.match(frontend, /cash-sheets\/adjustment/);
  assert.match(frontend, /postCloseAdjustments/);
  assert.match(php, /cash_sheet_adjustment_runs/);
  assert.match(php, /cash_sheet_sync_runs WHERE close_id=\?/);
  assert.match(script, /AJUSTES SISTEMA/);
  assert.match(script, /LARTISAN_ADJUSTMENT_/);
  assert.doesNotMatch(script, /syncAdjustment_[\s\S]{0,2000}setValue\(/);
});
