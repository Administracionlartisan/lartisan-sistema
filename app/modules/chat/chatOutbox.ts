export type PendingChatMessage = {
  key: string;
  userId: string;
  threadId: string;
  clientId: string;
  body: string;
  attachments: Array<{ name: string; mime: string; data: string }>;
  queuedAt: string;
};

const request = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });

/** Cola durable: conserva la misma identidad de mensaje tras cortes o recargas. */
export class ChatOutbox {
  private db: IDBDatabase | null = null;
  private memory = new Map<string, PendingChatMessage>();
  private constructor(private readonly userId: string) {}
  static async open(userId: string) {
    const outbox = new ChatOutbox(userId);
    try {
      outbox.db = await new Promise<IDBDatabase>((resolve, reject) => { const opening = indexedDB.open("lartisan-chat-outbox", 1); opening.onupgradeneeded = () => opening.result.createObjectStore("messages", { keyPath: "key" }); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
      const stored = await request(outbox.db.transaction("messages", "readonly").objectStore("messages").getAll()) as PendingChatMessage[];
      for (const message of stored) if (message.userId === userId) outbox.memory.set(message.key, message);
    } catch { /* Se conserva al menos durante la sesión si IndexedDB no existe. */ }
    return outbox;
  }
  async put(message: Omit<PendingChatMessage, "key" | "userId" | "queuedAt">) {
    const value: PendingChatMessage = { ...message, key: `${this.userId}:${message.clientId}`, userId: this.userId, queuedAt: new Date().toISOString() };
    this.memory.set(value.key, value);
    if (this.db) await request(this.db.transaction("messages", "readwrite").objectStore("messages").put(value));
    return value;
  }
  async remove(clientId: string) {
    const key = `${this.userId}:${clientId}`; this.memory.delete(key);
    if (this.db) await request(this.db.transaction("messages", "readwrite").objectStore("messages").delete(key));
  }
  find(threadId: string, body: string) {
    return [...this.memory.values()].find(message => message.threadId === threadId && message.body === body);
  }
}
