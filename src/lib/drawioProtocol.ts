/**
 * draw.io embed protocol adapter (proto=json). The self-hosted drawio webapp is mounted at the same
 * origin under /drawio/, so messages are only accepted from that frame and only sent to our origin.
 * https://www.drawio.com/doc/faq/embed-mode
 */
export const DRAWIO_PATH = '/drawio/';
export const DRAWIO_SRC = `${DRAWIO_PATH}?embed=1&proto=json&spin=1&libraries=1&noSaveBtn=1&saveAndExit=0&noExitBtn=1&v=32.6.10`;
// draw.io ships a ~10 MB bundle. A cold download on a phone can take well over 8 s, and failing
// there reads as "broken". Wait long enough that only a real fault trips this.
export const INIT_TIMEOUT_MS = 45000;
/** Present in this app's index.html: if /drawio/ returns it, the path is an SPA fallback, not draw.io. */
export const SHELL_MARKER = 'data-app="pandaplan-draw"';

/** Reply to `configure` (only sent by draw.io when the URL has configure=1). Both shapes, flat and `config`. */
export const CONFIGURE_REPLY = {
  action: 'configure',
  compressXml: false,
  noSaveBtn: true,
  saveAndExit: false,
  config: { compressXml: false },
} as const;

export type Probe = { ok: true } | { ok: false; reason: string };

/** Is the drawio webapp actually mounted at /drawio/? */
export async function probeDrawio(): Promise<Probe> {
  try {
    const r = await fetch(DRAWIO_PATH, { cache: 'no-store', headers: { accept: 'text/html' } });
    if (!r.ok) return { ok: false, reason: `GET ${DRAWIO_PATH} returned HTTP ${r.status}` };
    const t = await r.text();
    if (t.includes(SHELL_MARKER)) return { ok: false, reason: `GET ${DRAWIO_PATH} falls through to this app (no drawio files there)` };
    return { ok: true };
  } catch {
    return { ok: false, reason: `GET ${DRAWIO_PATH} failed (network error)` };
  }
}

export interface DrawioHandlers {
  /**
   * Return the XML to load, or null to defer: a warm spare frame boots with no file yet and gets its
   * first `load` later through `link.load()`.
   */
  onInit(): string | null;
  /** draw.io's `load` event (proto=json): the diagram is on the canvas and the editor is usable. */
  onLoaded?(): void;
  onSave(xml: string): void;
  onAutosave(xml: string): void;
  onExit(): void;
  title?: () => string;
}

export interface DrawioLink {
  send(msg: Record<string, unknown>): void;
  /** Ask draw.io for an SVG data URI of the current diagram (used for host-side Print / PDF). */
  exportSvg(timeoutMs?: number): Promise<string>;
  /**
   * Load a diagram: the first one into a spare, or the next one into a frame that already shows a
   * file (one frame serves every file of the page). False if draw.io has not sent `init` yet.
   */
  load(xml: string): boolean;
  /** draw.io sent `init`. */
  readonly ready: boolean;
  /** At least one `load` has been sent to this frame. */
  readonly loadSent: boolean;
  /** A `load` was sent and draw.io has not answered it yet: `autosave` / `save` are being dropped. */
  readonly fenced: boolean;
  dispose(): void;
}

/** If draw.io never answers a `load`, stop dropping its messages after this long (never lose edits silently). */
export const FENCE_MAX_MS = 10000;

/**
 * The fence. draw.io posts `autosave` synchronously on every model change, and window→window
 * messages arrive in the order they were posted. So between our `load` and draw.io's `load` reply,
 * any `autosave` / `save` either belongs to the diagram being replaced or is the new one being set
 * up: neither may be stored as the new file. They are dropped; the replaced file's last edits were
 * already received (they were posted when made) and are flushed by the app before it switches.
 */
export function connectDrawio(frame: HTMLIFrameElement, h: DrawioHandlers): DrawioLink {
  let ready = false;
  let loadSent = false;
  let unanswered = 0;
  let fenceTimer: ReturnType<typeof setTimeout> | undefined;
  const waiters: Array<(data: string | null) => void> = [];

  const send = (msg: Record<string, unknown>) => {
    frame.contentWindow?.postMessage(JSON.stringify(msg), window.location.origin);
  };

  // autosave:1 turns on `autosave` events without changing the iframe URL.
  const doLoad = (xml: string) => {
    loadSent = true;
    unanswered++;
    clearTimeout(fenceTimer);
    fenceTimer = setTimeout(() => (unanswered = 0), FENCE_MAX_MS);
    send({ action: 'load', xml, autosave: 1, title: h.title?.() ?? '' });
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== frame.contentWindow || ev.origin !== window.location.origin) return;
    if (typeof ev.data !== 'string' || !ev.data.startsWith('{')) return;
    let msg: { event?: string; xml?: unknown; data?: unknown };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    switch (msg.event) {
      case 'configure':
        send({ ...CONFIGURE_REPLY });
        break;
      case 'init': {
        ready = true;
        const xml = h.onInit();
        if (xml !== null && !loadSent) doLoad(xml);
        break;
      }
      case 'load':
        if (unanswered > 0 && --unanswered === 0) clearTimeout(fenceTimer);
        h.onLoaded?.();
        break;
      case 'autosave':
        if (typeof msg.xml === 'string' && unanswered === 0) h.onAutosave(msg.xml);
        break;
      case 'save':
        if (typeof msg.xml === 'string' && unanswered === 0) h.onSave(msg.xml);
        break;
      case 'exit':
        h.onExit();
        break;
      case 'export':
        waiters.splice(0).forEach((w) => w(typeof msg.data === 'string' ? msg.data : null));
        break;
    }
  };
  window.addEventListener('message', onMessage);

  return {
    send,
    get ready() {
      return ready;
    },
    get loadSent() {
      return loadSent;
    },
    get fenced() {
      return unanswered > 0;
    },
    load(xml: string) {
      if (!ready) return false;
      doLoad(xml);
      return true;
    },
    exportSvg(timeoutMs = 8000) {
      if (!ready) return Promise.reject(new Error('Editor not ready.'));
      return new Promise<string>((resolve, reject) => {
        const t = window.setTimeout(() => reject(new Error('draw.io did not answer the export request.')), timeoutMs);
        waiters.push((data) => {
          window.clearTimeout(t);
          if (data) resolve(data);
          else reject(new Error('draw.io returned an empty export.'));
        });
        send({ action: 'export', format: 'svg', spinKey: 'export' });
      });
    },
    dispose() {
      clearTimeout(fenceTimer);
      window.removeEventListener('message', onMessage);
      waiters.splice(0).forEach((w) => w(null));
    },
  };
}
