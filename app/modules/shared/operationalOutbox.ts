import type { OperationalSnapshot } from "./types";

export type PendingOperationalWrite = {
  requestId: string;
  site: string;
  state: OperationalSnapshot;
  baseState: OperationalSnapshot;
  baseRevision: number;
  event: { action: string; detail: string; recordedAt: string };
  queuedAt: string;
};

const prefix = "lartisan:operations-outbox:";
const userPrefix = (userId: string) => `${prefix}${userId}:`;
const key = (userId: string, write: PendingOperationalWrite) => `${userPrefix(userId)}${encodeURIComponent(write.site)}:${write.requestId}`;

export function savePendingWrite(userId: string, write: PendingOperationalWrite) {
  window.localStorage.setItem(key(userId, write), JSON.stringify(write));
}

export function readPendingWrites(userId: string): PendingOperationalWrite[] {
  const ownedPrefix = userPrefix(userId);
  return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((item): item is string => Boolean(item?.startsWith(ownedPrefix)))
    .flatMap((item) => {
      try { return [JSON.parse(window.localStorage.getItem(item) || "") as PendingOperationalWrite]; }
      catch { window.localStorage.removeItem(item); return []; }
    })
    .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
}

export function removePendingWrite(userId: string, site: string, requestId?: string) {
  const ownedPrefix = userPrefix(userId);
  for (const storageKey of Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))) {
    if (!storageKey?.startsWith(ownedPrefix)) continue;
    try {
      const current = JSON.parse(window.localStorage.getItem(storageKey) || "null") as PendingOperationalWrite | null;
      if (current?.site !== site || (requestId && current.requestId !== requestId)) continue;
    } catch { /* Remove malformed pending data below. */ }
    window.localStorage.removeItem(storageKey);
  }
}
