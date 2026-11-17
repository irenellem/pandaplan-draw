/**
 * Getting draw.io ready before it is needed. Two steps, both after the saved-work list is on screen
 * and the browser is idle, so they never compete with the app shell:
 *
 *  1. prefetch draw.io's critical files into the HTTP cache (`<link rel="prefetch">`);
 *  2. mount a hidden "spare" editor frame that boots while she is choosing a file (see App.tsx).
 *
 * Both are skipped when the browser asks to save data.
 */
import { DRAWIO_PATH } from './drawioProtocol';

/**
 * What draw.io's own index.html pulls on a self-hosted (non-diagrams.net, non-Electron) boot, in order:
 * index.html → styles/grapheditor.css, js/bootstrap.js → js/PreConfig.js → js/app.min.js →
 * js/PostConfig.js, plus js/main.js and the English string bundle. Read from draw.io 32.6.x's
 * bootstrap.js (loadAppJS). app.min.js is ~98% of the bytes (10.4 MB raw, ~2.3 MB zstd).
 *
 * index.html itself is NOT here: it is served `no-store` on purpose (deploy/nginx.conf), so a
 * prefetched copy is not something the frame may reuse, and it is 4 KB.
 */
export const DRAWIO_CRITICAL: ReadonlyArray<{ path: string; as: 'script' | 'style' | 'fetch' }> = [
  { path: 'js/app.min.js', as: 'script' },
  { path: 'styles/grapheditor.css', as: 'style' },
  { path: 'js/bootstrap.js', as: 'script' },
  { path: 'resources/dia.txt', as: 'fetch' },
  { path: 'js/PreConfig.js', as: 'script' },
  { path: 'js/PostConfig.js', as: 'script' },
  { path: 'js/main.js', as: 'script' },
];

export const prefetchUrls = (): string[] => DRAWIO_CRITICAL.map((f) => DRAWIO_PATH + f.path);

type Conn = { saveData?: boolean } | undefined;

/** False when the user asked the browser to save data (Data Saver / Lite mode). */
export function warmupAllowed(nav: { connection?: Conn } | undefined = typeof navigator === 'undefined' ? undefined : (navigator as { connection?: Conn })): boolean {
  return !nav?.connection?.saveData;
}

/** Run `cb` when the browser is idle (rIC; Safari has none, so a timeout). Returns a cancel function. */
export function whenIdle(cb: () => void, timeoutMs = 2000): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(cb, { timeout: timeoutMs });
    return () => w.cancelIdleCallback!(id);
  }
  const id = window.setTimeout(cb, 300);
  return () => window.clearTimeout(id);
}

let prefetched = false;

/** Inject the prefetch hints once per page. Returns how many were added (0 when skipped or already done). */
export function prefetchDrawio(doc: Document = document): number {
  if (prefetched || !warmupAllowed()) return 0;
  prefetched = true;
  for (const f of DRAWIO_CRITICAL) {
    const l = doc.createElement('link');
    l.rel = 'prefetch';
    l.as = f.as;
    l.href = DRAWIO_PATH + f.path;
    l.dataset.drawioPrefetch = '';
    doc.head.appendChild(l);
  }
  return DRAWIO_CRITICAL.length;
}

/* ------------------------------------------------------------------- loader wording */

/** After this long without a usable editor, the loader adds a plain second line. */
export const SLOW_AFTER_MS = 8000;

export type Stage = 'preparing' | 'opening';

export function stageText(stage: Stage, title: string): string {
  return stage === 'preparing' ? 'Preparing the editor…' : `Opening ${title}…`;
}
export const SLOW_TEXT = 'Still working — the editor takes a few seconds on a fresh session.';
