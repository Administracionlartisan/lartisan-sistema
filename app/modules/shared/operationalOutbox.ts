import type { OperationalSnapshot } from "./types";

export type PendingOperationalWrite = {
  requestId: string;
  site: string;
  state: OperationalSnapshot;
  baseState: OperationalSnapshot;
  baseRevision: number;
  event: { action: string; detail: string; recordedAt: string; testOperatingDate?: string; testLabel?: string };
  queuedAt: string;
  /** Operaciones de la interfaz acumuladas en este envío. */
  operations?: number;
  /** Se envió al menos una vez: ya no se modifica y se reintenta con el mismo requestId. */
  sentAt?: string;
};

export type SiteQueue = {
  writes: PendingOperationalWrite[];
  /** Rechazo definitivo del servidor: no se reintenta solo hasta que se pida sincronizar. */
  blocked?: string;
};

/** A 2xx HTTP status alone is not proof that the operation was committed. */
export function confirmedSyncResponse(value: unknown): value is { ok: true; revision: number; merged?: boolean } {
  if (!value || typeof value !== "object") return false;
  const response = value as { ok?: unknown; revision?: unknown; merged?: unknown };
  return response.ok === true && Number.isSafeInteger(response.revision) && (response.revision as number) >= 0
    && (response.merged === undefined || typeof response.merged === "boolean");
}

/**
 * Agrega un envío a la cola de un local, en orden estricto.
 *
 * Si el último envío todavía no salió y el nuevo parte exactamente de su estado
 * (`continuous`), se acumulan en uno solo: estado nuevo sobre la base del
 * anterior. El servidor recibe así la suma de los cambios, y la cola ocupa lo
 * mismo con una operación que con cien. Sin continuidad comprobada (por ejemplo,
 * tras recargar desde el servidor) se agrega como envío aparte.
 */
export function appendToQueue(queue: SiteQueue, write: PendingOperationalWrite, continuous: boolean): SiteQueue {
  const writes = [...queue.writes];
  const last = writes[writes.length - 1];
  const incoming = { ...write, operations: write.operations ?? 1 };
  if (last && !last.sentAt && continuous) {
    writes[writes.length - 1] = {
      ...incoming,
      baseState: last.baseState,
      baseRevision: last.baseRevision,
      queuedAt: last.queuedAt,
      operations: (last.operations ?? 1) + incoming.operations,
      event: {
        // Conserva la identidad de la operación (incluida la fecha operativa
        // restringida) al compactar reintentos. Si se descartaran estos campos,
        // la API rechazaría un cambio auditado de Maure por carecer de su
        // etiqueta y fecha de prueba.
        ...incoming.event,
        detail: `${incoming.event.detail} (${(last.operations ?? 1) + incoming.operations} operaciones acumuladas sin conexión)`.slice(0, 800),
      },
    };
  } else {
    // Un envío que sigue a otro pendiente se apoya en él: se fuerza al servidor
    // a combinar por diferencias (revisión anterior) en lugar de reemplazar.
    if (last) incoming.baseRevision = Math.min(incoming.baseRevision, last.baseRevision);
    writes.push(incoming);
  }
  return { ...queue, writes };
}

/** Quita el primer envío si coincide con el confirmado por el servidor. */
export function acknowledgeInQueue(queue: SiteQueue, requestId: string): SiteQueue {
  return queue.writes[0]?.requestId === requestId ? { ...queue, writes: queue.writes.slice(1) } : queue;
}

export const pendingOperations = (queue: SiteQueue | undefined) =>
  (queue?.writes ?? []).reduce((sum, write) => sum + (write.operations ?? 1), 0);

/** Último estado encolado del local (desde donde parte la próxima operación). */
export const latestQueuedState = (queue: SiteQueue | undefined) => queue?.writes[queue.writes.length - 1]?.state;

/**
 * Reconoce exclusivamente una apertura antigua que ya quedó incluida en un
 * turno cerrado del servidor. Es una recuperación de cola, no una anulación:
 * exige las mismas identidades de turno y de asiento de caja, no admite ventas
 * ni movimientos de stock nuevos y nunca toca una operación que el servidor
 * todavía no haya confirmado.
 */
export function isOpeningAlreadyClosedOnServer(
  write: PendingOperationalWrite | undefined,
  server: OperationalSnapshot | undefined,
): boolean {
  if (!write || !server || server.cashOpen || server.activeShift) return false;
  const idsAdded = (key: "sales" | "payments" | "returnsLog" | "stockMovements" | "shiftLog" | "cashLedger") => {
    const before = new Set(((write.baseState[key] ?? []) as unknown as { id?: string }[]).map((item) => item?.id).filter(Boolean));
    return ((write.state[key] ?? []) as unknown as { id?: string }[]).filter((item) => item?.id && !before.has(item.id));
  };
  // No se descarta una venta, devolución, pago ni movimiento de inventario.
  if (idsAdded("sales").length || idsAdded("payments").length || idsAdded("returnsLog").length || idsAdded("stockMovements").length) return false;
  const shifts = idsAdded("shiftLog");
  const ledger = idsAdded("cashLedger");
  if (shifts.length !== 1 || ledger.length !== 1) return false;
  const shiftId = shifts[0].id;
  const ledgerId = ledger[0].id;
  return Boolean(
    shiftId && ledgerId &&
    write.state.cashOpen && write.state.activeShift?.id === shiftId &&
    (server.shiftLog ?? []).some((item) => item?.id === shiftId && (item.closedAtISO || item.closedAt)) &&
    (server.cashLedger ?? []).some((item) => item?.id === ledgerId),
  );
}

/**
 * Detecta una apertura local obsoleta que nunca llegó a confirmarse y fue
 * reemplazada por una apertura posterior ya vigente en el servidor. No admite
 * ventas, cobros, stock ni ningún otro movimiento: sólo puede retirar esa
 * apertura inválida para que no bloquee operaciones nuevas que sí son reales.
 */
export function isOpeningSupersededByServer(
  write: PendingOperationalWrite | undefined,
  server: OperationalSnapshot | undefined,
): boolean {
  if (!write || !server?.cashOpen || !server.activeShift || !write.state.cashOpen || !write.state.activeShift) return false;
  if (server.activeShift.id === write.state.activeShift.id) return false;
  const added = (key: "sales" | "payments" | "returnsLog" | "stockMovements" | "cashAdjustments" | "cashTransfers") => {
    const before = new Set(((write.baseState[key] ?? []) as unknown as { id?: string }[]).map((item) => item?.id).filter(Boolean));
    return ((write.state[key] ?? []) as unknown as { id?: string }[]).some((item) => item?.id && !before.has(item.id));
  };
  if (added("sales") || added("payments") || added("returnsLog") || added("stockMovements") || added("cashAdjustments") || added("cashTransfers")) return false;
  const newShifts = (write.state.shiftLog ?? []).filter((item) => !(write.baseState.shiftLog ?? []).some((base) => base.id === item.id));
  const newLedger = (write.state.cashLedger ?? []).filter((item) => !(write.baseState.cashLedger ?? []).some((base) => base.id === item.id));
  return newShifts.length === 1 && newShifts[0].id === write.state.activeShift.id && newLedger.length === 1 && newLedger[0].shiftId === write.state.activeShift.id;
}

const DB_NAME = "lartisan-outbox";
const STORE = "queues";
const legacyPrefix = (userId: string) => `lartisan:operations-outbox:${userId}:`;

type StoredQueue = SiteQueue & { key: string; userId: string; site: string };

/** Count all profiles in this browser; malformed stored data must not permit opening. */
export function countDevicePendingForSite(stored: unknown[], legacy: unknown[], site: string): number {
  let count = 0;
  const operationCount = (write: unknown): number => {
    if (!write || typeof write !== "object") throw new Error("Operación local ilegible");
    const operations = (write as PendingOperationalWrite).operations;
    if (operations !== undefined && (!Number.isSafeInteger(operations) || operations < 1)) throw new Error("Operación local ilegible");
    return operations ?? 1;
  };
  for (const value of stored) {
    if (!value || typeof value !== "object") throw new Error("Cola local ilegible");
    const queue = value as Partial<StoredQueue>;
    if (typeof queue.site !== "string" || !Array.isArray(queue.writes)) throw new Error("Cola local ilegible");
    if (queue.site === site) for (const write of queue.writes) count += operationCount(write);
  }
  for (const value of legacy) {
    if (!value || typeof value !== "object" || typeof (value as PendingOperationalWrite).site !== "string") throw new Error("Cola anterior ilegible");
    const write = value as PendingOperationalWrite;
    if (write.site === site) count += operationCount(write);
  }
  return count;
}

const request = <T>(operation: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });

/**
 * Cola persistente de operaciones sin confirmar, por usuario y local, en
 * IndexedDB (cientos de MB disponibles; localStorage tiene ~5 MB y un solo
 * estado de un local ya lo llenaba). Si IndexedDB no está disponible, la cola
 * funciona en memoria y lo informa con `durable = false`.
 */
export class OperationalOutbox {
  private queues = new Map<string, StoredQueue>();
  private db: IDBDatabase | null = null;
  durable = false;
  private readonly userId: string;

  private constructor(userId: string) {
    this.userId = userId;
  }

  static async open(userId: string): Promise<OperationalOutbox> {
    const outbox = new OperationalOutbox(userId);
    try {
      outbox.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(DB_NAME, 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore(STORE, { keyPath: "key" });
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      outbox.durable = true;
      const stored = await request(outbox.db.transaction(STORE, "readonly").objectStore(STORE).getAll()) as StoredQueue[];
      for (const queue of stored) if (queue.userId === userId && queue.writes?.length) outbox.queues.set(queue.site, queue);
    } catch {
      outbox.db = null;
      outbox.durable = false;
    }
    await outbox.migrateLegacy();
    return outbox;
  }

  /** Mueve a IndexedDB lo que la versión anterior dejó en localStorage. */
  private async migrateLegacy() {
    let keys: string[] = [];
    try {
      keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
        .filter((item): item is string => Boolean(item?.startsWith(legacyPrefix(this.userId))));
    } catch { return; }
    const legacy = keys.flatMap((storageKey) => {
      try {
        const write = JSON.parse(window.localStorage.getItem(storageKey) || "") as PendingOperationalWrite;
        if (!write || typeof write.site !== "string" || typeof write.requestId !== "string" || typeof write.queuedAt !== "string" || !write.state || !write.baseState || !write.event) return [];
        return [{ ...write, storageKey }];
      }
      catch { return []; }
    }).sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
    // Cada envío anterior tenía su propia base: se conservan separados y en orden.
    for (const { storageKey, ...write } of legacy) {
      // Un cierre entre guardar y quitar la clave anterior no debe duplicarla.
      if (!this.get(write.site).writes.some((item) => item.requestId === write.requestId))
        await this.save(write.site, appendToQueue(this.get(write.site), write, false));
      if (this.durable) window.localStorage.removeItem(storageKey);
    }
  }

  get(site: string): SiteQueue {
    return this.queues.get(site) ?? { writes: [] };
  }

  sites(): string[] {
    return [...this.queues.keys()];
  }

  count(): number {
    return [...this.queues.values()].reduce((sum, queue) => sum + pendingOperations(queue), 0);
  }

  /** Read all profiles afresh; never interpret inaccessible storage as empty. */
  async countDevicePendingForSite(site: string): Promise<number> {
    if (!this.db || !this.durable) throw new Error("No se puede verificar la cola local");
    const stored = await request(this.db.transaction(STORE, "readonly").objectStore(STORE).getAll());
    const legacy: unknown[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("lartisan:operations-outbox:")) {
        const raw = window.localStorage.getItem(key);
        if (!raw) throw new Error("Cola anterior ilegible");
        legacy.push(JSON.parse(raw));
      }
    }
    return countDevicePendingForSite(stored, legacy, site);
  }

  private async save(site: string, queue: SiteQueue) {
    const key = `${this.userId}:${site}`;
    // Publicar la cola en memoria antes de esperar permite que otra operación
    // encolada durante la transacción parta de la versión más reciente.
    const previous = this.queues.get(site);
    const next = queue.writes.length ? { ...queue, key, userId: this.userId, site } : undefined;
    if (next) this.queues.set(site, next);
    else this.queues.delete(site);
    if (this.db) {
      try {
        const transaction = this.db.transaction(STORE, "readwrite");
        const completed = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error || new Error("No se pudo guardar la cola local"));
          transaction.onerror = () => reject(transaction.error || new Error("No se pudo guardar la cola local"));
        });
        const store = transaction.objectStore(STORE);
        if (next) store.put(next);
        else store.delete(key);
        await completed;
      } catch (error) {
        if (this.queues.get(site) === next) {
          if (previous) this.queues.set(site, previous);
          else this.queues.delete(site);
        }
        throw error;
      }
    }
  }

  enqueue(write: PendingOperationalWrite, continuous: boolean) {
    return this.save(write.site, appendToQueue(this.get(write.site), write, continuous));
  }

  markSent(site: string, requestId: string) {
    const queue = this.get(site);
    if (queue.writes[0]?.requestId !== requestId || queue.writes[0].sentAt) return Promise.resolve();
    return this.save(site, { ...queue, writes: [{ ...queue.writes[0], sentAt: new Date().toISOString() }, ...queue.writes.slice(1)] });
  }

  acknowledge(site: string, requestId: string) {
    return this.save(site, acknowledgeInQueue(this.get(site), requestId));
  }

  block(site: string, message: string) {
    return this.save(site, { ...this.get(site), blocked: message });
  }

  unblockAll() {
    return Promise.all(this.sites().map((site) => this.save(site, { ...this.get(site), blocked: undefined })));
  }

  /** Retira sólo una apertura local que el servidor ya reemplazó de forma segura. */
  async discardSupersededOpening(site: string, server: OperationalSnapshot): Promise<boolean> {
    const queue = this.get(site);
    if (!isOpeningSupersededByServer(queue.writes[0], server)) return false;
    await this.save(site, { ...queue, writes: queue.writes.slice(1), blocked: undefined });
    return true;
  }

  /**
   * Corrige exclusivamente la apertura de caja que quedó en la cola local
   * antes de que la interfaz recibiera la ventana excepcional de fecha
   * operativa. No toca nada ya confirmado por la API ni ventas, cobros,
   * devoluciones o ajustes: exige que la diferencia sea solamente la apertura
   * de caja y mantiene el mismo requestId para conservar la idempotencia.
   */
  async normalizeLegacyTestOpening(site: string, businessDate: string, label: string): Promise<boolean> {
    if (site !== "Maure" || businessDate !== "2026-10-15" || label !== "PRUEBA DE VALIDACIÓN") return false;
    const queue = this.get(site);
    const write = queue.writes[0];
    // Algunas versiones anteriores persistían el texto genérico
    // «Actualización operativa». La identidad se determina por la diferencia
    // exacta de estado que se valida debajo, no por una etiqueta mutable.
    if (!write || write.event.testOperatingDate || write.event.testLabel) return false;
    const before = write.baseState;
    const after = write.state;
    const newItems = (key: "sales" | "payments" | "returnsLog" | "stockMovements" | "shiftLog" | "cashLedger") => {
    const known = new Set(((before[key] ?? []) as unknown as { id?: string }[]).map((item) => item?.id).filter((id): id is string => typeof id === "string"));
      return ((after[key] ?? []) as unknown as Record<string, unknown>[]).filter((item) => Boolean(item && typeof item.id === "string" && !known.has(item.id)));
    };
    // Una apertura no puede traer ventas, pagos, devoluciones ni movimientos de
    // stock. Esta guarda evita que el arreglo de compatibilidad amplíe el
    // alcance de una operación ya encolada.
    if (!after.cashOpen || !after.activeShift || newItems("sales").length || newItems("payments").length || newItems("returnsLog").length || newItems("stockMovements").length || newItems("shiftLog").length !== 1 || newItems("cashLedger").length !== 1) return false;

    const withBusinessDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)
      ? `${businessDate}${value.slice(10)}`
      : value;
    const targetIso = withBusinessDate(write.queuedAt);
    if (typeof targetIso !== "string") return false;
    const formatLocal = (iso: string) => new Date(iso).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const normalizeRecord = (item: Record<string, unknown>) => ({
      ...item,
      ...(typeof item.openedAtISO === "string" ? { openedAtISO: withBusinessDate(item.openedAtISO), openedAt: formatLocal(withBusinessDate(item.openedAtISO) as string) } : {}),
      ...(typeof item.atISO === "string" ? { atISO: withBusinessDate(item.atISO), at: formatLocal(withBusinessDate(item.atISO) as string) } : {}),
    });
    const knownShiftIds = new Set((before.shiftLog ?? []).map((item) => item.id));
    const knownLedgerIds = new Set((before.cashLedger ?? []).map((item) => item.id));
    const state: OperationalSnapshot = {
      ...after,
      activeShift: normalizeRecord(after.activeShift as unknown as Record<string, unknown>) as typeof after.activeShift,
      shiftLog: (after.shiftLog ?? []).map((item) => knownShiftIds.has(item.id) ? item : normalizeRecord(item as unknown as Record<string, unknown>)) as typeof after.shiftLog,
      cashLedger: (after.cashLedger ?? []).map((item) => knownLedgerIds.has(item.id) ? item : normalizeRecord(item as unknown as Record<string, unknown>)) as typeof after.cashLedger,
    };
    const repaired: PendingOperationalWrite = {
      ...write,
      state,
      event: {
        ...write.event,
        action: "Caja abierta",
        detail: `${label} · Apertura de caja Maure normalizada desde la cola local previa a la activación de la fecha operativa.`.slice(0, 800),
        recordedAt: targetIso,
        testOperatingDate: businessDate,
        testLabel: label,
      },
      queuedAt: targetIso,
    };
    await this.save(site, { ...queue, blocked: undefined, writes: [repaired, ...queue.writes.slice(1)] });
    return true;
  }
}
