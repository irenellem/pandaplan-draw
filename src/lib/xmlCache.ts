/**
 * The diagram XML a click is about to need, fetched before the click. A file is keyed by id AND by
 * its newest stored copy (key / updated), so a save from anywhere (this tab, the phone) is a new
 * cache entry, never a stale hit. Bounded; a failed fetch is forgotten so the click retries it.
 */
import { readXml, type Entry } from './savedWork';

type Slot = { p: Promise<string>; value?: string };

const MAX = 40;
const cache = new Map<string, Slot>();

export const cacheKey = (e: Pick<Entry, 'id' | 'key' | 'updated'>) => `${e.id}|${e.key ?? ''}|${e.updated}`;

function put(k: string, s: Slot) {
  cache.delete(k);
  cache.set(k, s);
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string);
}

/** The XML, from the cache when it is there. */
export function getXml(e: Entry, read: (e: Entry) => Promise<string> = readXml): Promise<string> {
  const k = cacheKey(e);
  const hit = cache.get(k);
  if (hit) return hit.p;
  const s: Slot = { p: read(e) };
  s.p.then(
    (v) => (s.value = v),
    () => cache.get(k) === s && cache.delete(k),
  );
  put(k, s);
  return s.p;
}

/** The XML now (synchronously), if it has already arrived. This is what makes a warm open one paint. */
export function peekXml(e: Pick<Entry, 'id' | 'key' | 'updated'>): string | undefined {
  return cache.get(cacheKey(e))?.value;
}

/** We already know this copy's XML (we just saved it): the next open of it needs no fetch. */
export function primeXml(e: Pick<Entry, 'id' | 'key' | 'updated'>, xml: string): void {
  put(cacheKey(e), { p: Promise.resolve(xml), value: xml });
}

/** Fire and forget. Skips very large files: a prefetch is a guess, not worth megabytes. */
export function prefetchXml(e: Entry, maxBytes = 1_000_000): void {
  if (e.size > maxBytes) return;
  getXml(e).catch(() => undefined);
}

export function clearXmlCache(): void {
  cache.clear();
}

type Conn = { saveData?: boolean; effectiveType?: string; rtt?: number } | undefined;

/** A link slow enough that fetching the rows in view (not only the hovered one) pays off. */
export function slowLink(nav: { connection?: Conn } | undefined = typeof navigator === 'undefined' ? undefined : (navigator as { connection?: Conn })): boolean {
  const c = nav?.connection;
  if (!c || c.saveData) return false; // Save-Data: only what she points at
  return /^(slow-2g|2g|3g)$/.test(c.effectiveType ?? '') || (typeof c.rtt === 'number' && c.rtt >= 300);
}
