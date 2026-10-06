import type { OperationalSnapshot } from "./types";

export type PendingOperationalWrite = {
  requestId: string;
  site: string;
  state: OperationalSnapshot;
  baseState: OperationalSnapshot;
  baseRevision: number;
  event: { action: string; detail: string; recordedAt: string };
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
        action: incoming.event.action,
        detail: `${incoming.event.detail} (${(last.operations ?? 1) + incoming.operations} operaciones acumuladas sin conexión)`.slice(0, 800),
        recordedAt: incoming.event.recordedAt,
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
}
