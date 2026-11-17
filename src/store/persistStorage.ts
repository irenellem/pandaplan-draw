import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * localStorage adapter for zustand/persist with a 300 ms debounce. Serialising happens only when the
 * timer fires, so a drag that produces 60 updates a second costs one JSON.stringify.
 * Pending writes are flushed on pagehide / tab hide, so a reload never loses the last edit.
 * A corrupt stored value is copied to `<key>.corrupt-<ts>` before it is replaced. Nothing is discarded.
 */
export type SaveState = 'idle' | 'pending' | 'saved' | 'error';
export interface SaveStatus {
  state: SaveState;
  savedAt: number | null;
  error: string | null;
}

let status: SaveStatus = { state: 'idle', savedAt: null, error: null };
const listeners = new Set<() => void>();
const flushers = new Set<() => void>();

function setStatus(next: Partial<SaveStatus>) {
  status = { ...status, ...next };
  listeners.forEach((l) => l());
}

export const saveStatus = {
  get: (): SaveStatus => status,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function flushAll(): void {
  flushers.forEach((f) => f());
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

export function createDebouncedStorage<S>(delay = 300): PersistStorage<S> {
  let pending: { name: string; value: StorageValue<S> } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const { name, value } = pending;
    try {
      localStorage.setItem(name, JSON.stringify(value));
      pending = null;
      setStatus({ state: 'saved', savedAt: Date.now(), error: null });
    } catch (err) {
      // Keep `pending` so the next mutation or flush retries. Work stays in memory.
      setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  };
  flushers.add(write);

  return {
    getItem(name) {
      if (pending && pending.name === name) return pending.value;
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(name);
      } catch {
        return null;
      }
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        try {
          localStorage.setItem(`${name}.corrupt-${Date.now()}`, raw);
        } catch {
          /* quota: nothing more we can do */
        }
        return null;
      }
    },
    setItem(name, value) {
      pending = { name, value };
      setStatus({ state: 'pending' });
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, delay);
    },
    removeItem(name) {
      pending = null;
      try {
        localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}
