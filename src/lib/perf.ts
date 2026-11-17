/**
 * Measured, never estimated: how long opening a diagram took in this browser. One record per open,
 * kept in `window.__pandadrawPerf` (read by test/perf.mjs) and the last one in sessionStorage
 * (shown by `?selftest=1`). All times are milliseconds from the click.
 */
export type OpenPath = 'warm-booted' | 'warm-booting' | 'fresh';

export interface OpenTiming {
  title: string;
  /** warm-booted: the spare frame had already started draw.io; warm-booting: spare still loading; fresh: a new frame. */
  path: OpenPath;
  /** The frame existed this long before the click (0 for a fresh frame). */
  frameAgeMs: number;
  clickToFrameMs: number;
  clickToInitMs: number | null;
  clickToUsableMs: number | null;
}

export const LAST_OPEN_KEY = 'pandadraw.perf.lastOpen';

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
let current: { t0: number; rec: OpenTiming } | null = null;

/** Called when she clicks a file (or New diagram), before anything is fetched. */
export function beginOpen(title: string): void {
  current = { t0: now(), rec: { title, path: 'fresh', frameAgeMs: 0, clickToFrameMs: 0, clickToInitMs: null, clickToUsableMs: null } };
}

/** The frame that will show this file. `bornAt` is when it was created; `booted` = it already sent `init`. */
export function noteFrame(bornAt: number, booted: boolean, warm: boolean): void {
  if (!current) return;
  const t = now();
  current.rec.path = !warm ? 'fresh' : booted ? 'warm-booted' : 'warm-booting';
  current.rec.frameAgeMs = warm ? Math.max(0, Math.round(current.t0 - bornAt)) : 0;
  current.rec.clickToFrameMs = warm ? 0 : Math.round(t - current.t0);
  if (booted) current.rec.clickToInitMs = 0;
}

export function noteInit(): void {
  if (current && current.rec.clickToInitMs === null) current.rec.clickToInitMs = Math.round(now() - current.t0);
}

export function noteUsable(): void {
  if (!current) return;
  current.rec.clickToUsableMs = Math.round(now() - current.t0);
  const rec = current.rec;
  current = null;
  const w = typeof window === 'undefined' ? undefined : (window as Window & { __pandadrawPerf?: OpenTiming[] });
  if (w) (w.__pandadrawPerf ??= []).push(rec);
  try {
    sessionStorage.setItem(LAST_OPEN_KEY, JSON.stringify(rec));
  } catch {
    /* private mode / no storage: the in-memory record is enough */
  }
}

export function lastOpen(): OpenTiming | null {
  try {
    const s = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(LAST_OPEN_KEY);
    return s ? (JSON.parse(s) as OpenTiming) : null;
  } catch {
    return null;
  }
}

/** This page's own navigation timing (the shell). Null outside a browser. */
export function shellTiming(): { domReadyMs: number; loadMs: number | null } | null {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return null;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return null;
  return { domReadyMs: Math.round(nav.domContentLoadedEventEnd), loadMs: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null };
}
