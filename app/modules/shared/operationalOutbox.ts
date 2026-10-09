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

const DB_NAME = "lartisan-outbox";
const STORE = "queues";
const legacyPrefix = (userId: string) => `lartisan:operations-outbox:${userId}:`;

type StoredQueue = SiteQueue & { key: string; userId: string; site: string };

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
      try { return [JSON.parse(window.localStorage.getItem(storageKey) || "") as PendingOperationalWrite]; }
      catch { return []; }
    }).sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
    // Cada envío anterior tenía su propia base: se conservan separados y en orden.
    for (const write of legacy) await this.save(write.site, appendToQueue(this.get(write.site), write, false));
    if (this.durable) for (const storageKey of keys) window.localStorage.removeItem(storageKey);
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

  private async save(site: string, queue: SiteQueue) {
    const key = `${this.userId}:${site}`;
    if (queue.writes.length) this.queues.set(site, { ...queue, key, userId: this.userId, site });
    else this.queues.delete(site);
    if (!this.db) return;
    const store = this.db.transaction(STORE, "readwrite").objectStore(STORE);
    if (queue.writes.length) await request(store.put({ ...queue, key, userId: this.userId, site }));
    else await request(store.delete(key));
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
      const known = new Set((before[key] ?? []).filter((item): item is { id: string } => Boolean(item && typeof item === "object" && "id" in item && typeof item.id === "string")).map((item) => item.id));
      return (after[key] ?? []).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && "id" in item && typeof item.id === "string" && !known.has(item.id)));
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
