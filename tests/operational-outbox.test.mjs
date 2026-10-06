import assert from "node:assert/strict";
import test from "node:test";
import { appendToQueue, acknowledgeInQueue, pendingOperations, latestQueuedState } from "../app/modules/shared/operationalOutbox.ts";

const write = (id, state, baseState, baseRevision = 5) => ({
  requestId: id, site: "Recoleta", state, baseState, baseRevision,
  event: { action: "Venta registrada", detail: id, recordedAt: "2026-09-30T12:00:00Z" }, queuedAt: `2026-09-30T12:00:0${id.length}Z`,
});
const s = (n) => ({ sales: Array.from({ length: n }, (_, i) => ({ id: `v${i}` })) });

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

test("solo se confirma el primer envío de la cola", () => {
  const queue = { writes: [write("a", s(1), s(0)), write("b", s(2), s(1))] };
  assert.equal(acknowledgeInQueue(queue, "b").writes.length, 2);
  assert.deepEqual(acknowledgeInQueue(queue, "a").writes.map((w) => w.requestId), ["b"]);
});
