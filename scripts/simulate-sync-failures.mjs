/*
 * Simulación local de fallas de sincronización (cola de pendientes ↔ /sync).
 *
 * Solo apunta a la API y la base de desarrollo de esta PC (dev/README.md) y
 * rechaza cualquier otra. Crea usuarios y ventas ficticias identificables.
 * Reproduce la lógica del navegador con las mismas funciones de la cola
 * (operationalOutbox.ts) y la misma clasificación de respuestas que
 * sendPendingWrite/drainSite en app/page.tsx; un proxy intermedio inyecta
 * cortes, respuestas perdidas o incompletas, errores 500 y demoras.
 *
 *   node --experimental-strip-types scripts/simulate-sync-failures.mjs
 *
 * Cada escenario verifica ventas, pagos, stock y caja en el estado del local
 * y en las tablas normalizadas (lartisan_sales, lartisan_sale_payments,
 * lartisan_stock_movements, lartisan_cash_movements).
 */
import http from "node:http";
import { spawnSync } from "node:child_process";
import { randomUUID as id } from "node:crypto";
import { appendToQueue, acknowledgeInQueue, confirmedSyncResponse, latestQueuedState, pendingOperations } from "../app/modules/shared/operationalOutbox.ts";

// Varios servidores PHP contra la misma base: el servidor de desarrollo de PHP
// atiende de a una petición, y las carreras reales necesitan procesos paralelos.
const upstreams = (process.env.LARTISAN_SIM_UPSTREAMS ?? "http://127.0.0.1:8080").split(",");
for (const upstream of upstreams) if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(upstream)) throw new Error(`Refusing non-local API: ${upstream}`);
let nextUpstream = 0;
const mariadb = process.env.LARTISAN_MARIADB ?? "C:/lartisan-dev/mariadb/bin/mariadb.exe";
const proxyPort = 8090;
const base = `http://127.0.0.1:${proxyPort}/sistema-api`;
const origin = "http://localhost:3210";
const password = "Simulacion2026!";
const run = `FALLAS-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const usernameRun = run.replace(/[^a-z0-9]/gi, "").toLowerCase();
const PRODUCT = 990001;
// Locales de la simulación: uno para cortes y reintentos, otro para varios equipos y caja.
const SITE_A = process.env.LARTISAN_SIM_SITE_A ?? "Novo Pacheco";
const SITE_B = process.env.LARTISAN_SIM_SITE_B ?? "Congreso";
const results = [];

// ---------- base de datos local (solo lectura para verificar) ----------
function sql(query) {
  const out = spawnSync(mariadb, ["-h127.0.0.1", "-P3313", "-ulartisan_dev", "-pdev-local-only", "lartisan_dev", "-N", "-B", "-e", query], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`SQL: ${out.stderr}`);
  return out.stdout.trim();
}
const inList = (ids) => ids.map((value) => `'${value.replace(/[^a-f0-9-]/gi, "")}'`).join(",");

// ---------- proxy con fallas inyectadas ----------
const faults = [];
const proxy = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const fault = req.url.endsWith("/sync") ? faults.shift() : undefined;
    if (fault === "lose-request") return req.socket.destroy();
    if (fault === "server-500") {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end('{"ok":false,"error":"Falla simulada del alojamiento"}');
    }
    try {
      const headers = { Origin: req.headers.origin ?? origin };
      if (req.headers.cookie) headers.Cookie = req.headers.cookie;
      if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
      const upstream = upstreams[nextUpstream++ % upstreams.length];
      const response = await fetch(`${upstream}${req.url}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const text = await response.text();
      // El servidor ya procesó la escritura: el navegador no se entera.
      if (fault === "lose-response") return req.socket.destroy();
      if (fault === "hang") return;
      const out = { "Content-Type": response.headers.get("content-type") ?? "application/json" };
      const cookies = response.headers.getSetCookie();
      if (cookies.length) out["Set-Cookie"] = cookies;
      res.writeHead(response.status, out);
      res.end(fault === "truncate" ? text.slice(0, Math.floor(text.length / 2)) : text);
    } catch (error) {
      res.writeHead(502); res.end(String(error));
    }
  });
});

// ---------- sesión y equipo (navegador) ----------
async function session(username, pass = password) {
  let cookie = "";
  // El navegador no corta la recarga de estados por tiempo; con varios
  // equipos en estrés un GET de ~4 MB puede superar 15 s en esta PC.
  async function request(path, { method = "GET", body, timeout = 60000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${base}/${path}`, {
        method, signal: controller.signal,
        headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const received = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
      if (received) cookie = received;
      return { response, data: await response.json().catch(() => null) };
    } finally { clearTimeout(timer); }
  }
  const login = await request("auth/login", { method: "POST", body: { username, password: pass } });
  if (!login.response.ok) throw new Error(`login ${username}: ${login.response.status}`);
  return { request, username, async relogin() { await request("auth/login", { method: "POST", body: { username, password: pass } }); } };
}

class Device {
  constructor(name, api, site, fullName) { Object.assign(this, { name, api, site, fullName }); this.queue = { writes: [] }; }
  async load() {
    const { data } = await this.api.request("operations/states");
    const entry = data.states[this.site];
    this.revision = entry?.revision ?? 0;
    this.lastPersisted = JSON.stringify(entry?.state ?? {});
    this.lastAck = null;
    // Como loadOperationalData: con pendientes no bloqueados, la pantalla
    // continúa desde el último estado encolado y no desde el del servidor.
    const queued = this.queue.blocked ? undefined : latestQueuedState(this.queue);
    this.local = structuredClone(queued ?? entry?.state ?? {});
    this.queuedBase = queued ? JSON.stringify(queued) : null;
    return this;
  }
  // Igual que el efecto de persistencia de page.tsx.
  operate(mutate, action = "Venta registrada") {
    const baseJson = this.queuedBase ?? this.lastPersisted;
    const next = structuredClone(this.local);
    mutate(next);
    const serialized = JSON.stringify(next);
    if (serialized === baseJson) return;
    const write = { requestId: id(), site: this.site, state: next, baseState: JSON.parse(baseJson), baseRevision: this.revision,
      event: { action, detail: `${run} · ${this.name}`, recordedAt: new Date().toISOString() }, queuedAt: new Date().toISOString() };
    this.queuedBase = serialized;
    const latest = latestQueuedState(this.queue);
    this.queue = appendToQueue(this.queue, write, Boolean(latest) && JSON.stringify(latest) === baseJson);
    this.local = next;
  }
  // Igual que sendPendingWrite, con su mismo límite de 25 segundos.
  async send(write) {
    let result;
    try { result = await this.api.request("sync", { method: "POST", body: write, timeout: 25000 }); }
    catch (error) { return { kind: "retry", message: error.name === "AbortError" ? "timeout" : error.message }; }
    const { response, data } = result;
    if (response.ok) return confirmedSyncResponse(data) ? { kind: "saved", revision: data.revision, merged: data.merged } : { kind: "retry", message: "sin confirmación válida" };
    if (response.status === 401) return { kind: "session" };
    if (response.status >= 500 || [408, 409, 425, 429].includes(response.status)) return { kind: "retry", message: data?.error ?? `HTTP ${response.status}` };
    return { kind: "rejected", message: data?.error ?? `HTTP ${response.status}` };
  }
  // Igual que drainSite: orden estricto, mismo requestId al reintentar.
  async drain() {
    let last = null; let merged = false;
    for (;;) {
      const write = this.queue.writes[0];
      if (!write || this.queue.blocked) break;
      if (!write.sentAt) this.queue = { ...this.queue, writes: [{ ...write, sentAt: new Date().toISOString() }, ...this.queue.writes.slice(1)] };
      const head = this.queue.writes[0];
      const exactBase = this.lastAck && !this.lastAck.merged && this.lastAck.stateJson === JSON.stringify(head.baseState);
      const result = await this.send(exactBase ? { ...head, baseRevision: this.revision } : head);
      last = result;
      if (result.kind === "retry" || result.kind === "session") break;
      if (result.kind === "rejected") { this.queue = { ...this.queue, blocked: result.message }; break; }
      this.queue = acknowledgeInQueue(this.queue, head.requestId);
      this.revision = result.revision;
      this.lastPersisted = JSON.stringify(head.state);
      this.lastAck = { stateJson: this.lastPersisted, merged: Boolean(result.merged) };
      merged ||= Boolean(result.merged);
    }
    // page.tsx recarga del servidor cuando hubo combinación y no queda nada pendiente.
    if (merged && !this.queue.writes.length) await this.load();
    return last;
  }
  pending() { return pendingOperations(this.queue); }
}

// ---------- operaciones de negocio ----------
const sales = new Map(); // site -> ids de ventas creadas por la simulación
function sell(device, note = "") {
  const saleId = id();
  device.operate((state) => {
    const at = new Date().toISOString();
    const shiftId = state.activeShift?.id ?? null;
    const item = { id: PRODUCT, name: `Producto ficticio ${run}`, detail: "Unidad", category: "Pruebas", price: 1000 };
    state.sales = [{ id: saleId, site: device.site, createdAtISO: at, items: [item], gross: 1000, discount: 0, net: 1000, method: "Efectivo", invoiceType: "Comprobante de prueba", customer: `Cliente ficticio ${run}`, invitation: false, channel: "Mostrador", status: "activa", note: `${run} ${note}` }, ...(state.sales ?? [])];
    state.payments = [{ id: id(), saleId, site: device.site, shiftId, method: "Efectivo", amount: 1000, createdAtISO: at }, ...(state.payments ?? [])];
    state.cashLedger = [{ id: id(), site: device.site, shiftId, atISO: at, kind: "Venta", direction: "Ingreso", amount: 1000, cashImpact: 1000, paymentMethod: "Efectivo", reference: saleId, detail: `${run} venta`, createdBy: device.fullName }, ...(state.cashLedger ?? [])];
    state.stockMovements = [{ id: id(), site: device.site, productId: PRODUCT, kind: "Venta", quantity: -1, atISO: at, detail: `${run} venta`, reference: saleId, createdBy: device.fullName }, ...(state.stockMovements ?? [])];
    state.stock = { ...(state.stock ?? {}), [PRODUCT]: Math.max(0, Number(state.stock?.[PRODUCT] ?? 0) - 1) };
  });
  if (!sales.has(device.site)) sales.set(device.site, []);
  sales.get(device.site).push(saleId);
  return saleId;
}
function restock(device, quantity) {
  device.operate((state) => {
    state.stockMovements = [{ id: id(), site: device.site, productId: PRODUCT, kind: "Ingreso", quantity, atISO: new Date().toISOString(), detail: `${run} ingreso`, reference: "", createdBy: device.fullName }, ...(state.stockMovements ?? [])];
    state.stock = { ...(state.stock ?? {}), [PRODUCT]: Number(state.stock?.[PRODUCT] ?? 0) + quantity };
  }, "Ingreso de mercadería");
}
function openShift(device) {
  const shift = { id: id(), site: device.site, openedBy: device.fullName, openedAtISO: new Date().toISOString(), initialFund: 1000, initialFundCash: 1000 };
  device.operate((state) => { state.cashOpen = true; state.activeShift = shift; state.shiftLog = [...(state.shiftLog ?? []), shift]; }, "Apertura de caja");
  return shift.id;
}
function closeShift(device) {
  device.operate((state) => {
    const current = state.activeShift;
    if (!current) return;
    state.shiftLog = (state.shiftLog ?? []).map((shift) => shift.id === current.id ? { ...shift, closedAtISO: new Date().toISOString(), closedBy: device.fullName, expectedCash: 0, countedCash: 0 } : shift);
    if (!state.shiftLog.some((shift) => shift.id === current.id)) state.shiftLog.push({ ...current, closedAtISO: new Date().toISOString(), closedBy: device.fullName });
    state.cashOpen = false; state.activeShift = null;
  }, "Cierre de caja");
}

// ---------- verificación ----------
async function serverState(api, site) { return (await api.request("operations/states")).data.states[site]; }
function check(condition, message) { if (!condition) throw new Error(message); }
async function verify(api, site, saleIds, label) {
  const { state } = await serverState(api, site);
  const count = (list, predicate) => (list ?? []).filter(predicate).length;
  for (const saleId of saleIds) {
    check(count(state.sales, (sale) => sale.id === saleId) === 1, `${label}: venta ${saleId} no está exactamente una vez en el estado`);
    check(count(state.payments, (payment) => payment.saleId === saleId) === 1, `${label}: pago de ${saleId} no está exactamente una vez`);
    check(count(state.cashLedger, (entry) => entry.reference === saleId) === 1, `${label}: caja de ${saleId} no está exactamente una vez`);
    check(count(state.stockMovements, (movement) => movement.reference === saleId) === 1, `${label}: movimiento de stock de ${saleId} no está exactamente una vez`);
  }
  if (saleIds.length) {
    const ids = inList(saleIds);
    check(Number(sql(`SELECT COUNT(*) FROM lartisan_sales WHERE id IN (${ids})`)) === saleIds.length, `${label}: lartisan_sales no tiene todas las ventas`);
    check(Number(sql(`SELECT COUNT(*) FROM lartisan_sale_payments WHERE sale_id IN (${ids})`)) === saleIds.length, `${label}: lartisan_sale_payments no coincide`);
    check(Number(sql(`SELECT COUNT(*) FROM lartisan_stock_movements WHERE source_reference IN (${ids})`)) === saleIds.length, `${label}: lartisan_stock_movements no coincide`);
    check(Number(sql(`SELECT COUNT(*) FROM lartisan_cash_movements WHERE reference_id IN (${ids})`)) === saleIds.length, `${label}: lartisan_cash_movements no coincide`);
  }
  // Stock: el saldo del servidor es exactamente la suma de sus movimientos.
  const documented = (state.stockMovements ?? []).filter((movement) => Number(movement.productId) === PRODUCT && String(movement.detail ?? "").startsWith(run)).reduce((sum, movement) => sum + Number(movement.quantity), 0);
  return { state, documented };
}

async function scenario(name, body) {
  const started = Date.now();
  try { const detail = await body(); results.push({ name, ok: true, detail: detail ?? "", ms: Date.now() - started }); console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  catch (error) { results.push({ name, ok: false, detail: error.message }); console.log(`✗ ${name}\n    ${error.message}`); }
}

// ---------- preparación ----------
async function createSeller(admin, key, fullName, site) {
  const username = `sim.${key}.${usernameRun}`;
  const created = await admin.request("admin/users", { method: "POST", body: { username, fullName, role: "vendedora", assignedLocation: site, assignedLocations: [site], accessAllLocations: false, reportPermissions: [], actionPermissions: ["cobrar", "egresos", "pedidos", "incidencias"], temporaryPassword: password } });
  if (created.response.status !== 201) throw new Error(`alta ${username}: ${JSON.stringify(created.data)}`);
  const first = await session(username);
  await first.request("auth/change-password", { method: "POST", body: { currentPassword: password, newPassword: password } });
  return { api: await session(username), fullName };
}
async function resetCash(admin, site) {
  const device = await new Device("admin", admin, site, "Administración de Prueba").load();
  if (device.local.cashOpen) { closeShift(device); const result = await device.drain(); check(!device.queue.writes.length, `no se pudo cerrar la caja de ${site}: ${result?.message}`); }
}

async function main() {
  await new Promise((resolve) => proxy.listen(proxyPort, "127.0.0.1", resolve));
  const admin = await session("admin.pruebas", "Pruebas2026!");
  check((await admin.request("operations/test-operating-date")).data.ok, "API local no disponible");
  await admin.request("admin/test-operating-date/disable", { method: "POST", body: {} });
  const A = await createSeller(admin, "pachecoa", `Vendedora A ${run}`, SITE_A);
  const B = await createSeller(admin, "pachecob", `Vendedora B ${run}`, SITE_A);
  const C = await createSeller(admin, "congresoc", `Vendedora C ${run}`, SITE_B);
  const D = await createSeller(admin, "congresod", `Vendedora D ${run}`, SITE_B);
  for (const site of [SITE_A, SITE_B]) await resetCash(admin, site);

  const pa = await new Device("A", A.api, SITE_A, A.fullName).load();
  await scenario(`Preparación: apertura de caja e ingreso de 1000 unidades (${SITE_A})`, async () => {
    openShift(pa); restock(pa, 1000); await pa.drain();
    check(!pa.queue.writes.length, "la apertura no se confirmó");
  });

  const lossCase = (fault, label) => scenario(label, async () => {
    const saleId = sell(pa, fault);
    faults.push(fault);
    const first = await pa.drain();
    check(first?.kind === "retry", `se esperaba reintento, llegó ${first?.kind}`);
    check(pa.queue.writes.length === 1, "la cola perdió la operación tras la falla");
    const second = await pa.drain();
    check(second?.kind === "saved" && !pa.queue.writes.length, `el reintento no confirmó: ${second?.message}`);
    await verify(admin, SITE_A, [saleId], label);
    return "1 venta, 1 pago, 1 movimiento de stock y 1 de caja";
  });
  await lossCase("lose-response", "Corte después de guardar (respuesta perdida) → reintento sin duplicar");
  await lossCase("truncate", "Respuesta incompleta (HTTP 200 truncado) → no se retira de la cola y no duplica");
  await lossCase("lose-request", "Corte antes de llegar al servidor → reintento guarda una vez");
  await lossCase("hang", "Servidor guarda pero no responde a tiempo → reintento sin duplicar");

  await scenario("Error 500 transitorio tres veces seguidas → se conserva y luego guarda una vez", async () => {
    const saleId = sell(pa, "500");
    faults.push("server-500", "server-500", "server-500");
    for (let attempt = 0; attempt < 3; attempt++) check((await pa.drain())?.kind === "retry", "el 500 no se trató como reintento");
    check((await pa.drain())?.kind === "saved", "no guardó tras los 500");
    await verify(admin, SITE_A, [saleId], "500");
  });

  await scenario("Sin conexión: 38 ventas acumuladas + 1 posterior (caso Dharling: 2 envíos, 39 operaciones)", async () => {
    const ids = Array.from({ length: 38 }, (_, index) => sell(pa, `offline-${index}`));
    check(pa.queue.writes.length === 1 && pa.pending() === 38, `se esperaba 1 envío con 38 operaciones, hay ${pa.queue.writes.length}/${pa.pending()}`);
    faults.push("lose-request"); await pa.drain(); // el primer envío ya salió
    ids.push(sell(pa, "offline-39"));
    check(pa.queue.writes.length === 2 && pa.pending() === 39, `se esperaban 2 envíos y 39 operaciones, hay ${pa.queue.writes.length}/${pa.pending()}`);
    await pa.drain();
    check(!pa.queue.writes.length, "quedaron pendientes");
    await verify(admin, SITE_A, ids, "offline");
    return "39 ventas guardadas una sola vez";
  });

  await scenario("Envío duplicado en paralelo (dos pestañas, mismo requestId) → una sola venta", async () => {
    const saleId = sell(pa, "paralelo");
    const head = { ...pa.queue.writes[0], sentAt: new Date().toISOString() };
    const both = await Promise.all([pa.send(head), pa.send(head)]);
    check(both.every((result) => result.kind === "saved"), `ambos debían confirmar (uno como ya procesado): ${JSON.stringify(both)}`);
    await pa.drain();
    check(!pa.queue.writes.length, "quedó pendiente");
    await verify(admin, SITE_A, [saleId], "paralelo");
    return both.map((result) => result.kind).join(" + ");
  });

  await scenario("Cambio de usuario: A con 3 ventas sin enviar, B vende 2 en el mismo local y luego A sincroniza", async () => {
    const ids = [sell(pa, "A-1"), sell(pa, "A-2"), sell(pa, "A-3")];
    const pb = await new Device("B", B.api, SITE_A, B.fullName).load();
    ids.push(sell(pb, "B-1"), sell(pb, "B-2"));
    await pb.drain(); check(!pb.queue.writes.length, "B no sincronizó");
    await pa.drain(); check(!pa.queue.writes.length, `A no sincronizó: ${pa.queue.blocked ?? ""}`);
    await verify(admin, SITE_A, ids, "cambio de usuario");
    return "5 ventas de ambas usuarias conservadas";
  });

  await scenario("Sesión vencida con pendientes → 401 conserva la cola; al volver a ingresar se envía", async () => {
    const saleId = sell(pa, "sesion");
    await A.api.request("auth/logout", { method: "POST", body: {} });
    const expired = await pa.drain();
    check(expired?.kind === "session" && pa.queue.writes.length === 1, `se esperaba sesión vencida con la cola intacta, llegó ${expired?.kind}`);
    await A.api.relogin();
    await pa.drain();
    check(!pa.queue.writes.length, "no envió tras reingresar");
    await verify(admin, SITE_A, [saleId], "sesión");
  });

  await scenario(`Stock de ${SITE_A} = 1000 − ventas, sin descuentos dobles`, async () => {
    const { state } = await serverState(admin, SITE_A);
    const sold = sales.get(SITE_A).length;
    const movementsSum = Number(sql(`SELECT COALESCE(SUM(quantity),0) FROM lartisan_stock_movements WHERE site='${SITE_A}' AND product_id=${PRODUCT} AND detail LIKE '${run}%'`));
    check(movementsSum === 1000 - sold, `movimientos suman ${movementsSum}, se esperaba ${1000 - sold}`);
    check(Number(state.stock[PRODUCT]) >= 1000 - sold, "el saldo quedó por debajo de lo vendido");
    return `${sold} ventas, movimientos netos ${movementsSum}`;
  });

  // ---------- SITE_B: varios equipos y conflictos de caja ----------
  const c1 = await new Device("C", C.api, SITE_B, C.fullName).load();
  await scenario(`Preparación: apertura (C) e ingreso de 1000 unidades (${SITE_B})`, async () => {
    openShift(c1); restock(c1, 1000); await c1.drain();
    check(!c1.queue.writes.length, "no se confirmó la apertura");
  });

  await scenario("Dos equipos venden a la vez en el mismo local (10 + 10, envíos intercalados)", async () => {
    const d1 = await new Device("D", D.api, SITE_B, D.fullName).load();
    await c1.load();
    const ids = [];
    await Promise.all([c1, d1].map(async (device) => {
      for (let n = 0; n < 10; n++) { ids.push(sell(device, `${device.name}-${n}`)); await device.drain(); }
      while (device.queue.writes.length && !device.queue.blocked) await device.drain();
      check(!device.queue.writes.length, `${device.name} quedó con pendientes: ${device.queue.blocked ?? ""}`);
    }));
    await verify(admin, SITE_B, ids, "dos equipos");
    return "20 ventas combinadas sin pérdidas";
  });

  await scenario("Estrés: 3 equipos × 15 ventas a la vez, con cortes aleatorios", async () => {
    const devices = await Promise.all([[C, "E1"], [D, "E2"], [C, "E3"]].map(([seller, name]) => new Device(name, seller.api, SITE_B, seller.fullName).load()));
    const ids = [];
    await Promise.all(devices.map(async (device) => {
      for (let n = 0; n < 15; n++) {
        ids.push(sell(device, `${device.name}-${n}`));
        if (Math.random() < 0.2) faults.push(["lose-response", "truncate", "server-500"][n % 3]);
        await device.drain();
      }
      for (let attempt = 0; attempt < 10 && device.queue.writes.length && !device.queue.blocked; attempt++) await device.drain();
      check(!device.queue.writes.length, `${device.name} quedó con pendientes: ${device.queue.blocked ?? device.queue.writes.length}`);
    }));
    await verify(admin, SITE_B, ids, "estrés");
    return "45 ventas, cada una exactamente una vez";
  });

  await scenario("Ráfaga: 6 equipos envían a la vez desde la misma revisión", async () => {
    const devices = await Promise.all(Array.from({ length: 6 }, (_, index) => new Device(`R${index}`, index % 2 ? D.api : C.api, SITE_B, index % 2 ? D.fullName : C.fullName).load()));
    const ids = devices.map((device) => sell(device, "rafaga"));
    await Promise.all(devices.map((device) => device.drain()));
    for (const device of devices) while (device.queue.writes.length && !device.queue.blocked) await device.drain();
    check(devices.every((device) => !device.queue.writes.length), `quedaron pendientes: ${devices.map((d) => d.queue.blocked ?? d.queue.writes.length).join(",")}`);
    await verify(admin, SITE_B, ids, "ráfaga");
  });

  await scenario("Caja antigua vs vigente: C vende sin conexión; D cierra el turno y abre otro; C sincroniza", async () => {
    await c1.load();
    const oldShift = c1.local.activeShift.id;
    const ids = [sell(c1, "turno-viejo-1"), sell(c1, "turno-viejo-2"), sell(c1, "turno-viejo-3")];
    const d1 = await new Device("D", D.api, SITE_B, D.fullName).load();
    closeShift(d1); await d1.drain(); const newShift = openShift(d1); await d1.drain();
    check(!d1.queue.writes.length, `D no pudo hacer el relevo: ${d1.queue.blocked ?? ""}`);
    await c1.drain();
    check(!c1.queue.writes.length, `las ventas del turno anterior quedaron trabadas: ${c1.queue.blocked ?? ""}`);
    const { state } = await verify(admin, SITE_B, ids, "caja antigua");
    check(state.cashOpen === true && state.activeShift?.id === newShift, "se sobrescribió la caja vigente");
    check(state.shiftLog.some((shift) => shift.id === oldShift && shift.closedAtISO), "se perdió el cierre del turno anterior");
    return "ventas guardadas en su turno; caja vigente intacta";
  });

  await scenario("Cierre obsoleto: C cierra sin conexión un turno que D ya relevó → se conserva la caja vigente y la venta", async () => {
    await c1.load();
    const saleId = sell(c1, "antes-de-cierre-obsoleto");
    closeShift(c1);
    const d1 = await new Device("D", D.api, SITE_B, D.fullName).load();
    closeShift(d1); await d1.drain(); const current = openShift(d1); await d1.drain();
    check(!d1.queue.writes.length, "D no pudo relevar");
    await c1.drain();
    check(!c1.queue.writes.length, `quedó trabado: ${c1.queue.blocked ?? ""}`);
    const { state } = await verify(admin, SITE_B, [saleId], "cierre obsoleto");
    check(state.cashOpen === true && state.activeShift?.id === current, "el cierre obsoleto cerró la caja vigente");
  });

  await scenario("Relevo sin conexión: D cierra con arqueo y abre su turno antes de que salga el envío (un solo envío acumulado)", async () => {
    const d1 = await new Device("D", D.api, SITE_B, D.fullName).load();
    const closing = d1.local.activeShift.id;
    const saleId = sell(d1, "antes-del-relevo");
    closeShift(d1); const opened = openShift(d1);
    check(d1.queue.writes.length === 1, "se esperaba un único envío acumulado");
    const result = await d1.drain();
    check(!d1.queue.writes.length, `el relevo quedó trabado (${result?.kind}): ${d1.queue.blocked ?? result?.message ?? ""}`);
    const { state } = await verify(admin, SITE_B, [saleId], "relevo sin conexión");
    check(state.activeShift?.id === opened && state.shiftLog.some((shift) => shift.id === closing && shift.closedAtISO), "el relevo no quedó registrado");
  });

  await scenario("Apertura en conflicto: C abre sin conexión mientras D ya abrió → 422, cola detenida y conservada", async () => {
    const d1 = await new Device("D", D.api, SITE_B, D.fullName).load();
    closeShift(d1); await d1.drain();
    await c1.load();
    openShift(c1); const pendingSale = sell(c1, "en-apertura-conflictiva");
    sales.get(SITE_B).pop(); // no debe guardarse: queda para conciliar
    await d1.load(); const winner = openShift(d1); await d1.drain();
    const result = await c1.drain();
    check(result?.kind === "rejected", `se esperaba rechazo definitivo (422), llegó ${result?.kind}: ${result?.message}`);
    check(c1.queue.blocked && c1.pending() >= 1, "la cola no quedó conservada");
    const { state } = await serverState(admin, SITE_B);
    check(state.activeShift?.id === winner, "se sobrescribió la caja vigente");
    check(!(state.sales ?? []).some((sale) => sale.id === pendingSale), "se guardó una venta de una apertura rechazada");
    return `mensaje: «${result.message.slice(0, 90)}…»`;
  });

  await scenario("Ventana de prueba activa en Maure → 422 conservando la cola; al cerrarla se sincroniza una vez", async () => {
    const maure = await new Device("Admin", admin, "Maure", "Administración de Prueba").load();
    const enable = await admin.request("admin/test-operating-date/enable", { method: "POST", body: { site: "Maure", businessDate: "2026-10-15", label: "PRUEBA DE VALIDACIÓN", purpose: run } });
    check(enable.response.ok, "no se pudo activar la ventana");
    const saleId = sell(maure, "ventana");
    const blocked = await maure.drain();
    check(blocked?.kind === "rejected" && maure.queue.blocked, `se esperaba 422, llegó ${blocked?.kind}`);
    const disable = await admin.request("admin/test-operating-date/disable", { method: "POST", body: {} });
    check(disable.response.ok, "no se pudo cerrar la ventana");
    maure.queue = { ...maure.queue, blocked: undefined }; // botón «Sincronizar» (unblockAll)
    await maure.drain();
    check(!maure.queue.writes.length, `no sincronizó tras cerrar la ventana: ${maure.queue.blocked ?? ""}`);
    await verify(admin, "Maure", [saleId], "ventana");
  });

  await scenario(`${SITE_B}: totales en tablas normalizadas`, async () => {
    const ids = sales.get(SITE_B);
    await verify(admin, SITE_B, ids, `${SITE_B} total`);
    const movementsSum = Number(sql(`SELECT COALESCE(SUM(quantity),0) FROM lartisan_stock_movements WHERE site='${SITE_B}' AND product_id=${PRODUCT} AND detail LIKE '${run}%'`));
    check(movementsSum === 1000 - ids.length, `movimientos suman ${movementsSum}, se esperaba ${1000 - ids.length}`);
    return `${ids.length} ventas, movimientos netos ${movementsSum}`;
  });

  for (const site of [SITE_A, SITE_B]) await resetCash(admin, site);
  proxy.closeAllConnections(); proxy.close();
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} escenarios (${run})`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((error) => { console.error(error); proxy.closeAllConnections(); proxy.close(); process.exitCode = 1; });
