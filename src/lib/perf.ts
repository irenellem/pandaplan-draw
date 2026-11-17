/**
 * Measured, never estimated: how long opening a diagram took in this browser. One record per open,
 * kept in `window.__pandadrawPerf` (read by test/perf.mjs and test/e2e.mjs) and the last one in
 * sessionStorage (shown by `?selftest=1`). All times are milliseconds from the click.
 */
export type OpenPath =
  /** the editor already showed this very file: the click only switched the view */
  | 'same'
  /** the editor already showed another file: its next `load` went into the same frame */
  | 'reused'
  /** the warm frame had started draw.io and held no file yet */
  | 'warm-booted'
  /** the warm frame existed but draw.io had not started yet */
  | 'warm-booting'
  /** no frame before the click (Save-Data, or clicked before the warm-up) */
  | 'fresh';

export interface OpenTiming {
  title: string;
  path: OpenPath;
  /** The frame existed this long before the click (0 for a fresh frame). */
  frameAgeMs: number;
  clickToFrameMs: number;
  clickToInitMs: number | null;
  /** draw.io's `load` event for this file (the view switch alone for `same`). */
  clickToUsableMs: number | null;
  /** The frame after that was painted: the diagram is on screen. */
  clickToVisibleMs: number | null;
  /** The file's XML was already in memory at the click (prefetched), so no fetch stood in the way. */
  xmlCached: boolean;
}

export const LAST_OPEN_KEY = 'pandadraw.perf.lastOpen';

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
let current: { t0: number; rec: OpenTiming } | null = null;

/** Called when she clicks a file (or New diagram), before anything is fetched. */
export function beginOpen(title: string): void {
  current = {
    t0: now(),
    rec: { title, path: 'fresh', frameAgeMs: 0, clickToFrameMs: 0, clickToInitMs: null, clickToUsableMs: null, clickToVisibleMs: null, xmlCached: false },
  };
}

export function noteXmlCached(cached: boolean): void {
  if (current) current.rec.xmlCached = cached;
}

/**
 * The frame that will show this file. `bornAt` is when it was created; `booted` = it already sent
 * `init`; `hadFile` = it already showed another diagram.
 */
export function noteFrame(bornAt: number, booted: boolean, hadFile: boolean): void {
  if (!current) return;
  const warm = bornAt < current.t0;
  current.rec.path = !warm ? 'fresh' : hadFile ? 'reused' : booted ? 'warm-booted' : 'warm-booting';
  current.rec.frameAgeMs = warm ? Math.max(0, Math.round(current.t0 - bornAt)) : 0;
  current.rec.clickToFrameMs = warm ? 0 : Math.max(0, Math.round(bornAt - current.t0));
  if (booted) current.rec.clickToInitMs = 0;
}

export function noteInit(): void {
  if (current && current.rec.clickToInitMs === null) current.rec.clickToInitMs = Math.round(now() - current.t0);
}

const afterPaint = (cb: () => void) => {
  if (typeof requestAnimationFrame === 'undefined') return cb();
  // rAF runs before the paint; a task queued from it runs after that frame was painted.
  requestAnimationFrame(() => setTimeout(cb, 0));
};

function finish(c: { t0: number; rec: OpenTiming }) {
  afterPaint(() => {
    c.rec.clickToVisibleMs = Math.round(now() - c.t0);
    const w = typeof window === 'undefined' ? undefined : (window as Window & { __pandadrawPerf?: OpenTiming[] });
    if (w) (w.__pandadrawPerf ??= []).push(c.rec);
    try {
      sessionStorage.setItem(LAST_OPEN_KEY, JSON.stringify(c.rec));
    } catch {
      /* private mode / no storage: the in-memory record is enough */
    }
  });
}

export function noteUsable(): void {
  if (!current) return;
  const c = current;
  current = null;
  c.rec.clickToUsableMs = Math.round(now() - c.t0);
  finish(c);
}

/** The editor already showed this file: the click only flipped the view. */
export function noteSame(): void {
  if (!current) return;
  const c = current;
  current = null;
  Object.assign(c.rec, { path: 'same', clickToInitMs: 0, clickToUsableMs: Math.round(now() - c.t0), xmlCached: true });
  finish(c);
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
