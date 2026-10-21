/*
 * Local-only concurrent operations simulation.
 *
 * It deliberately targets 127.0.0.1 and refuses any non-local API base.  It
 * creates identifiable fictitious users/data in lartisan_dev, never in a
 * hosted environment.  Run after dev/seed.php and the PHP server start:
 *   node scripts/simulate-concurrent-workload.mjs
 */
import crypto from 'node:crypto';

const base = process.env.LARTISAN_SIM_API ?? 'http://127.0.0.1:8081/sistema-api';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/sistema-api$/.test(base)) {
  throw new Error(`Refusing non-local API base: ${base}`);
}
const origin = 'http://localhost:3210';
const password = 'Simulacion2026!';
const run = `SIM-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const usernameRun = run.replace(/[^a-z0-9]/gi, '').toLowerCase();
// Fecha operativa en la zona del sistema: en UTC, después de las 21 h de
// Argentina ya es el día siguiente y los reportes del día salían vacíos.
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
const id = () => crypto.randomUUID();
const result = { run, startedAt: new Date().toISOString(), checks: [], errors: [] };

function check(name, condition, detail = '') {
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  result.checks.push({ name, ok: true, detail });
}
function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];
  return values.map(value => value.split(';')[0]).filter(Boolean).join('; ');
}
async function client(username, pass = password) {
  let cookie = '';
  async function request(path, { method = 'GET', body, allow = [] } = {}) {
    const response = await fetch(`${base}/${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const received = cookieFrom(response); if (received) cookie = received;
    let json; try { json = await response.json(); } catch { json = { ok: false, error: 'Respuesta no JSON' }; }
    if (!response.ok && !allow.includes(response.status)) {
      throw new Error(`${method} ${path} → ${response.status}: ${json.error ?? JSON.stringify(json)}`);
    }
    return { status: response.status, json };
  }
  const login = await request('auth/login', { method: 'POST', body: { username, password: pass } });
  check(`Inicio de sesión local: ${username}`, login.json.ok === true);
  const me = await request('auth/me'); check(`Sesión persistente: ${username}`, me.json.ok === true && !!me.json.user);
  return { request, user: me.json.user };
}
function account(username, fullName, role, sites, extras = {}) {
  return { username, fullName, role, assignedLocation: sites[0], assignedLocations: sites, accessAllLocations: !!extras.all,
    reportPermissions: extras.reports ?? [], actionPermissions: extras.actions ?? [], temporaryPassword: password };
}
function makeState(site, seller, shiftId) {
  const now = new Date().toISOString();
  const shift = { id: shiftId, site, openedBy: seller.fullName, openedAtISO: now, initialFund: 1000, initialFundCash: 1000 };
  return { cashOpen: true, activeShift: shift, shiftLog: [shift], sales: [], payments: [], cashLedger: [], stockMovements: [], returnsLog: [] };
}
function addSale(state, site, seller, number) {
  const at = new Date().toISOString(); const saleId = id(); const amount = 1200 + number * 100;
  const item = { id: 900000 + number, name: `Producto ficticio ${run}`, detail: 'Unidad de simulación', category: 'Pruebas', price: amount };
  state.sales.push({ id: saleId, site, createdAtISO: at, items: [item], gross: amount, discount: 0, net: amount, method: 'Efectivo', invoiceType: 'Comprobante de prueba', customer: `Cliente ficticio ${run}`, invitation: false, channel: 'Mostrador', status: 'activa', note: `${run} — venta simulada` });
  state.payments.push({ id: id(), saleId, site, shiftId: state.activeShift.id, method: 'Efectivo', amount, createdAtISO: at });
  state.cashLedger.push({ id: id(), site, shiftId: state.activeShift.id, atISO: at, kind: 'Venta simulada', direction: 'Ingreso', amount, cashImpact: amount, paymentMethod: 'Efectivo', reference: saleId, detail: `${run} — venta de carga`, createdBy: seller.fullName });
  state.stockMovements.push({ id: id(), site, productId: item.id, productName: item.name, quantity: -1, atISO: at, reason: `${run} — venta simulada`, reference: saleId, createdBy: seller.fullName });
}
async function sync(api, site, requestId, baseRevision, baseState, state, allow = []) {
  return api.request('sync', { method: 'POST', allow, body: { site, requestId, baseRevision, baseState, state, event: { action: 'simulacion_carga_local', detail: run } } });
}
async function sellerFlow(seller, site) {
  const shiftId = id(); let revision = 0; let previous = {}; let state = makeState(site, seller, shiftId);
  let response = await sync(seller.api, site, id(), revision, previous, state);
  check(`${site}: apertura de caja`, response.json.ok === true); revision = response.json.revision; previous = structuredClone(state);
  for (let n = 1; n <= 5; n += 1) {
    addSale(state, site, seller, n); const requestId = id();
    response = await sync(seller.api, site, requestId, revision, previous, state);
    check(`${site}: venta simulada ${n}`, response.json.ok === true); revision = response.json.revision; previous = structuredClone(state);
    const retry = await sync(seller.api, site, requestId, revision, previous, state);
    check(`${site}: idempotencia venta ${n}`, retry.json.alreadyProcessed === true);
  }
  const closeAt = new Date().toISOString();
  state.cashOpen = false;
  state.shiftLog = state.shiftLog.map(shift => shift.id === shiftId ? { ...shift, closedAtISO: closeAt, closedBy: seller.fullName, expectedCash: 7500, countedCash: 7500, difference: 0 } : shift);
  state.activeShift = null;
  response = await sync(seller.api, site, id(), revision, previous, state);
  check(`${site}: cierre completo de caja`, response.json.ok === true);
  return { site, seller, sales: 5 };
}

async function main() {
  const health = await fetch(`${base}/health`); check('API aislada disponible', health.ok);
  const admin = await client('admin.pruebas', 'Pruebas2026!');
  const users = [
    account(`sim.recoleta.${usernameRun}`, `Vendedora Recoleta ${run}`, 'vendedora', ['Recoleta'], { actions: ['cobrar', 'egresos', 'pedidos', 'incidencias'] }),
    account(`sim.villamitre.${usernameRun}`, `Vendedora Villa Mitre ${run}`, 'vendedora', ['Villa Mitre'], { actions: ['cobrar', 'egresos', 'pedidos', 'incidencias'] }),
    account(`sim.congreso.${usernameRun}`, `Vendedora Congreso ${run}`, 'vendedora', ['Congreso'], { actions: ['cobrar', 'egresos', 'pedidos', 'incidencias'] }),
    account(`sim.maure.${usernameRun}`, `Vendedora Maure ${run}`, 'vendedora', ['Maure'], { actions: ['cobrar', 'egresos', 'pedidos', 'incidencias'] }),
    account(`sim.betsy.${usernameRun}`, `Betsy Supervisión ${run}`, 'supervisora', ['Recoleta', 'Villa Mitre', 'Congreso', 'Maure'], { reports: ['Personal'], actions: ['cobrar', 'egresos', 'pedidos', 'incidencias'] }),
    account(`sim.andrea.${usernameRun}`, `Andrea Supervisión ${run}`, 'supervisora', ['Recoleta', 'Villa Mitre', 'Congreso', 'Maure'], { reports: ['Personal'], actions: ['cobrar', 'egresos', 'pedidos', 'incidencias'] }),
    account(`sim.gerencia.${usernameRun}`, `Gerencia de Prueba ${run}`, 'administracion', ['Recoleta'], { all: true }),
  ];
  const create = await Promise.all(users.map(async spec => {
    const created = await admin.request('admin/users', { method: 'POST', body: spec });
    check(`Alta de perfil ficticio: ${spec.fullName}`, created.status === 201 && Number.isInteger(created.json.id));
    return { ...spec, id: created.json.id };
  }));
  const profiles = await Promise.all(create.map(async spec => {
    // Accounts provisioned by Administración correctly force a first password
    // change. Complete that real first-login flow before simulating work.
    const firstLogin = await client(spec.username);
    const changed = await firstLogin.request('auth/change-password', { method: 'POST', body: { currentPassword: password, newPassword: password } });
    check(`Cambio obligatorio de contraseña: ${spec.fullName}`, changed.json.ok === true);
    return { ...spec, api: await client(spec.username) };
  }));
  const sellers = profiles.slice(0, 4);
  const flows = await Promise.all(sellers.map((seller, index) => sellerFlow(seller, ['Recoleta', 'Villa Mitre', 'Congreso', 'Maure'][index])));
  check('Cuatro ventas concurrentes independientes', flows.reduce((n, flow) => n + flow.sales, 0) === 20);

  // A realistic concurrent reopening race after Recoleta's complete closure.
  const raceSeller = sellers[0];
  const beforeRace = await raceSeller.api.request('operations/states');
  const raceBase = beforeRace.json.states.Recoleta.state;
  const raceRevision = beforeRace.json.states.Recoleta.revision;
  const reopen = (shiftId) => {
    const openedAtISO = new Date().toISOString();
    const shift = { id: shiftId, site: 'Recoleta', openedBy: raceSeller.fullName, openedAtISO, initialFund: 1000, initialFundCash: 1000 };
    return { ...structuredClone(raceBase), cashOpen: true, activeShift: shift, shiftLog: [...(raceBase.shiftLog ?? []), shift] };
  };
  const first = reopen(id()); const second = reopen(id());
  // La perdedora es un conflicto de caja para conciliar (422), no un 500 que
  // la cola reintentaría a ciegas.
  const race = await Promise.all([
    sync(raceSeller.api, 'Recoleta', id(), raceRevision, raceBase, first, [422]),
    sync(raceSeller.api, 'Recoleta', id(), raceRevision, raceBase, second, [422]),
  ]);
  check('Carrera de apertura: una única solicitud aceptada', race.filter(item => item.status === 200 && item.json.ok).length === 1);
  check('Carrera de apertura: segundo dispositivo rechazado para conciliar', race.filter(item => item.status === 422).length === 1);
  const openWinner = race.find(item => item.status === 200 && item.json.ok);
  const current = await raceSeller.api.request('operations/states'); const state = current.json.states.Recoleta.state;
  check('Carrera de apertura: queda una responsable activa', state.cashOpen === true && state.activeShift.id === (state.activeShift.id));
  const closed = structuredClone(state); const closeAt = new Date().toISOString(); closed.cashOpen = false; closed.activeShift = null;
  closed.shiftLog = closed.shiftLog.map(shift => shift.id === state.activeShift.id ? { ...shift, closedAtISO: closeAt, closedBy: raceSeller.fullName, expectedCash: 0, countedCash: 0 } : shift);
  const closeRace = await sync(raceSeller.api, 'Recoleta', id(), current.json.states.Recoleta.revision, state, closed);
  check('Carrera de apertura: caja ganadora cerrada', closeRace.json.ok === true);

  const betsy = profiles[4]; const andrea = profiles[5]; const gerencia = profiles[6];
  const direct = await sellers[0].api.request('chat/direct', { method: 'POST', body: { recipientId: betsy.id } });
  check('Chat autorizado vendedora → Betsy', direct.json.ok && !!direct.json.thread?.id);
  const clientId = id(); const sent = await sellers[0].api.request('chat/messages', { method: 'POST', body: { threadId: direct.json.thread.id, body: `${run}: mensaje operativo de simulación`, clientId } });
  const retried = await sellers[0].api.request('chat/messages', { method: 'POST', body: { threadId: direct.json.thread.id, body: `${run}: mensaje operativo de simulación`, clientId } });
  check('Chat: reintento sin duplicado', sent.json.messageId === retried.json.messageId);
  const messages = await betsy.api.request(`chat/messages?thread=${encodeURIComponent(direct.json.thread.id)}`);
  check('Chat: entrega a destinataria', messages.json.messages.some(message => message.id === sent.json.messageId));
  await betsy.api.request('chat/read', { method: 'POST', body: { threadId: direct.json.thread.id } });
  const denied = await sellers[0].api.request('chat/direct', { method: 'POST', body: { recipientId: sellers[1].id }, allow: [403] });
  check('Chat: bloqueo entre vendedoras no autorizadas', denied.status === 403);

  const from = today; const to = today;
  for (const viewer of [admin, gerencia.api]) {
    const reports = await Promise.all(Array.from({ length: 8 }, () => viewer.request(`admin/report-sales?from=${from}&to=${to}`)));
    check('Reporte concurrente de administración/gerencia', reports.every(item => item.json.ok && item.json.sales.length >= 20));
  }
  for (const supervisor of [betsy.api, andrea.api]) {
    const reports = await Promise.all(Array.from({ length: 8 }, () => supervisor.request(`attendance/report?from=${from}&to=${to}`)));
    check('Consulta concurrente de supervisión', reports.every(item => item.json.ok));
  }
  const sellerDenied = await sellers[0].api.request(`admin/report-sales?from=${from}&to=${to}`, { allow: [403] });
  check('Permisos: vendedora no accede a reportes administrativos', sellerDenied.status === 403);
  const cash = await admin.request(`admin/cash-history?from=${from}&to=${to}`);
  check('Auditoría de cajas: sesiones simuladas conservadas', cash.json.sessions.filter(item => ['Recoleta', 'Villa Mitre', 'Congreso', 'Maure'].includes(item.site)).length >= 5);
  const audit = await admin.request('admin/audit');
  check('Auditoría disponible para la simulación', audit.json.ok === true);
  result.finishedAt = new Date().toISOString(); result.status = 'passed';
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { result.finishedAt = new Date().toISOString(); result.status = 'failed'; result.errors.push(error.message); console.error(JSON.stringify(result, null, 2)); process.exitCode = 1; });
