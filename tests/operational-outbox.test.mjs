import assert from "node:assert/strict";
import test from "node:test";
import { OperationalOutbox, appendToQueue, acknowledgeInQueue, pendingOperations, latestQueuedState, isOpeningAlreadyClosedOnServer, countDevicePendingForSite, confirmedSyncResponse } from "../app/modules/shared/operationalOutbox.ts";

test("a successful HTTP response must contain an explicit valid server confirmation", () => {
  for (const response of [null, {}, { ok: false, revision: 1 }, { ok: true }, { ok: true, revision: -1 }, { ok: true, revision: "3" }, { ok: true, revision: 2, merged: "yes" }]) {
    assert.equal(confirmedSyncResponse(response), false);
  }
  assert.equal(confirmedSyncResponse({ ok: true, revision: 1, merged: false }), true);
  assert.equal(confirmedSyncResponse({ ok: true, revision: 8, alreadyProcessed: true }), true);
});

test("opening guard counts pending writes across browser profiles and legacy storage", () => {
  const stored = [
    { site: "Maure", userId: "1", writes: [{ operations: 2 }] },
    { site: "Maure", userId: "2", writes: [{}, { operations: 3 }] },
    { site: "Recoleta", userId: "2", writes: [{ operations: 8 }] },
  ];
  assert.equal(countDevicePendingForSite(stored, [{ site: "Maure" }], "Maure"), 7);
  assert.equal(countDevicePendingForSite([], [], "Maure"), 0);
  assert.throws(() => countDevicePendingForSite([{ site: "Maure" }], [], "Maure"));
  assert.throws(() => countDevicePendingForSite([], [{}], "Maure"));
});

const write = (id, state, baseState, baseRevision = 5) => ({
  requestId: id, site: "Recoleta", state, baseState, baseRevision,
  event: { action: "Venta registrada", detail: id, recordedAt: "2026-09-30T12:00:00Z" }, queuedAt: `2026-09-30T12:00:0${id.length}Z`,
});
const s = (n) => ({ sales: Array.from({ length: n }, (_, i) => ({ id: `v${i}` })) });

test("la migración conserva datos ilegibles y espera la transacción antes de borrar el original", async () => {
  const previousWindow = globalThis.window, previousIndexedDB = globalThis.indexedDB;
  const values = new Map([
    ["lartisan:operations-outbox:17:good", JSON.stringify(write("a", s(1), s(0)))],
    ["lartisan:operations-outbox:17:bad", "{incorrecto"],
  ]);
  let failCommit = true;
  const db = { transaction() {
    const transaction = { objectStore() { return {
      getAll() { const req = {}; queueMicrotask(() => { req.result = []; req.onsuccess(); }); return req; },
      put() { queueMicrotask(() => failCommit ? transaction.onabort() : transaction.oncomplete()); },
    }; } };
    return transaction;
  } };
  globalThis.window = { localStorage: {
    get length() { return values.size; }, key(i) { return [...values.keys()][i] ?? null; },
    getItem(key) { return values.get(key) ?? null; }, removeItem(key) { values.delete(key); },
  } };
  globalThis.indexedDB = { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } };
  try {
    await assert.rejects(OperationalOutbox.open("17"), /guardar la cola/);
    assert.equal(values.has("lartisan:operations-outbox:17:good"), true);
    assert.equal(values.has("lartisan:operations-outbox:17:bad"), true);
    failCommit = false;
    const outbox = await OperationalOutbox.open("17");
    assert.equal(outbox.count(), 1);
    assert.equal(values.has("lartisan:operations-outbox:17:good"), false);
    assert.equal(values.has("lartisan:operations-outbox:17:bad"), true);
  } finally { globalThis.window = previousWindow; globalThis.indexedDB = previousIndexedDB; }
});

test("si falla la transacción de confirmación, la operación sigue en memoria", async () => {
  const previousWindow = globalThis.window, previousIndexedDB = globalThis.indexedDB;
  let fail = false;
  const db = { transaction() {
    const tx = { objectStore() { return {
      getAll() { const req = {}; queueMicrotask(() => { req.result = []; req.onsuccess(); }); return req; },
      put() { queueMicrotask(() => fail ? tx.onabort() : tx.oncomplete()); },
      delete() { queueMicrotask(() => fail ? tx.onabort() : tx.oncomplete()); },
    }; } };
    return tx;
  } };
  globalThis.window = { localStorage: { length: 0, key() { return null; } } };
  globalThis.indexedDB = { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } };
  try {
    const outbox = await OperationalOutbox.open("17");
    await outbox.enqueue(write("a", s(1), s(0)), false);
    fail = true;
    await assert.rejects(outbox.acknowledge("Recoleta", "a"), /guardar la cola/);
    assert.equal(outbox.get("Recoleta").writes[0].requestId, "a");
  } finally { globalThis.window = previousWindow; globalThis.indexedDB = previousIndexedDB; }
});

test("operaciones continuas sin enviar se acumulan en un solo envío con la base original", () => {
  let queue = { writes: [] };
  queue = appendToQueue(queue, write("a", s(1), s(0)), false);
  queue = appendToQueue(queue, write("b", s(2), s(1)), true);
  queue = appendToQueue(queue, write("c", s(3), s(2)), true);
  assert.equal(queue.writes.length, 1);
  assert.deepEqual(queue.writes[0].state, s(3));
  assert.deepEqual(queue.writes[0].baseState, s(0));
  assert.equal(queue.writes[0].requestId, "c");
  assert.equal(pendingOperations(queue), 3);
});

test("un envío ya despachado no se modifica: lo nuevo va detrás, forzando combinación", () => {
  let queue = appendToQueue({ writes: [] }, write("a", s(1), s(0), 5), false);
  queue = { writes: [{ ...queue.writes[0], sentAt: "2026-09-30T12:00:01Z" }] };
  queue = appendToQueue(queue, write("b", s(2), s(1), 9), true);
  assert.equal(queue.writes.length, 2);
  assert.equal(queue.writes[0].requestId, "a");
  assert.deepEqual(queue.writes[1].baseState, s(1));
  assert.equal(queue.writes[1].baseRevision, 5, "revisión anterior para que el servidor combine por diferencias");
  queue = appendToQueue(queue, write("c", s(3), s(2), 9), true);
  assert.equal(queue.writes.length, 2, "lo posterior sigue acumulándose en el segundo envío");
  assert.deepEqual(latestQueuedState(queue), s(3));
});

test("sin continuidad comprobada no se acumula", () => {
  let queue = appendToQueue({ writes: [] }, write("a", s(1), s(0)), false);
  queue = appendToQueue(queue, write("b", s(2), s(0)), false);
  assert.equal(queue.writes.length, 2);
  assert.deepEqual(queue.writes[1].baseState, s(0));
});

test("la compactación conserva la fecha operativa restringida y su etiqueta", () => {
  let queue = appendToQueue({ writes: [] }, write("a", s(1), s(0)), false);
  const validationWrite = {
    ...write("b", s(2), s(1)),
    site: "Maure",
    event: {
      action: "Ingreso manual de prueba",
      detail: "PRUEBA DE VALIDACIÓN",
      recordedAt: "2026-10-15T12:00:00Z",
      testOperatingDate: "2026-10-15",
      testLabel: "PRUEBA DE VALIDACIÓN",
    },
  };
  queue = appendToQueue(queue, validationWrite, true);
  assert.equal(queue.writes[0].event.testOperatingDate, "2026-10-15");
  assert.equal(queue.writes[0].event.testLabel, "PRUEBA DE VALIDACIÓN");
});

test("solo se confirma el primer envío de la cola", () => {
  const queue = { writes: [write("a", s(1), s(0)), write("b", s(2), s(1))] };
  assert.equal(acknowledgeInQueue(queue, "b").writes.length, 2);
  assert.deepEqual(acknowledgeInQueue(queue, "a").writes.map((w) => w.requestId), ["b"]);
});

test("solo recupera una apertura cuyo mismo turno y asiento ya quedaron cerrados en servidor", () => {
  const opening = {
    ...write("open", {
      cashOpen: true,
      activeShift: { id: "turno-1" },
      shiftLog: [{ id: "turno-1" }],
      cashLedger: [{ id: "asiento-1" }],
      sales: [], payments: [], returnsLog: [], stockMovements: [],
    }, {
      cashOpen: false, activeShift: null, shiftLog: [], cashLedger: [], sales: [], payments: [], returnsLog: [], stockMovements: [],
    }),
  };
  const closedOnServer = {
    cashOpen: false, activeShift: null,
    shiftLog: [{ id: "turno-1", closedAtISO: "2026-10-09T15:00:00Z" }],
    cashLedger: [{ id: "asiento-1" }], sales: [], payments: [], returnsLog: [], stockMovements: [],
  };
  assert.equal(isOpeningAlreadyClosedOnServer(opening, closedOnServer), true);
  assert.equal(isOpeningAlreadyClosedOnServer({ ...opening, state: { ...opening.state, sales: [{ id: "venta-1" }] } }, closedOnServer), false, "nunca descarta una venta");
  assert.equal(isOpeningAlreadyClosedOnServer(opening, { ...closedOnServer, cashOpen: true }), false, "no toca una caja aún abierta");
});
