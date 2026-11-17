/**
 * Saves made while the connection is down wait here, on this device, and go up when it returns.
 * A queued save is the newest state of one file, so a second save of the same file replaces the first
 * rather than queueing twice.
 */
export interface QueuedSave {
  url: string;
  body: string;
  at: string;
}

const KEY = 'pandadraw:offline-queue';

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const memory = new Map<string, string>();
const fallback: Store = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
};

function store(): Store {
  const s = (globalThis as { localStorage?: Store }).localStorage;
  return s ?? fallback;
}

export function readQueue(s: Store = store()): QueuedSave[] {
  try {
    const raw = s.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as QueuedSave[]) : [];
    return Array.isArray(list) ? list.filter((q) => q && typeof q.url === 'string' && typeof q.body === 'string') : [];
  } catch {
    return [];
  }
}

export function enqueue(save: QueuedSave, s: Store = store()): QueuedSave[] {
  const list = readQueue(s).filter((q) => q.url !== save.url);
  list.push(save);
  try {
    s.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full: the caller still has the download path for the edit */
  }
  return list;
}

export function clearQueue(s: Store = store()): void {
  try {
    s.setItem(KEY, '[]');
  } catch {
    /* nothing to clear */
  }
}

/** True for "the network never answered" - not for an HTTP error the Worker actually sent back. */
export function isOfflineError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /Could not reach the cloud storage|Failed to fetch|NetworkError|Load failed|The Internet connection appears to be offline/i.test(m);
}

/** Send queued saves oldest first. Stops at the first failure so order and the newest edit survive. */
export async function drain(
  put: (q: QueuedSave) => Promise<void>,
  s: Store = store(),
): Promise<{ sent: number; left: number }> {
  const list = readQueue(s);
  let sent = 0;
  for (const q of list) {
    try {
      await put(q);
      sent += 1;
      s.setItem(KEY, JSON.stringify(list.slice(sent)));
    } catch {
      break;
    }
  }
  return { sent, left: readQueue(s).length };
}
