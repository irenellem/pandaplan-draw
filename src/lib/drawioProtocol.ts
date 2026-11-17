/**
 * draw.io embed protocol adapter (proto=json). The self-hosted drawio webapp is mounted at the same
 * origin under /drawio/, so messages are only accepted from that frame and only sent to our origin.
 * https://www.drawio.com/doc/faq/embed-mode
 */
export const DRAWIO_PATH = '/drawio/';
export const DRAWIO_SRC = `${DRAWIO_PATH}?embed=1&proto=json&spin=1&libraries=1&noSaveBtn=1&saveAndExit=0&noExitBtn=1&v=32.6.10`;
export const INIT_TIMEOUT_MS = 8000;
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
  /** Return the XML to load. */
  onInit(): string;
  onSave(xml: string): void;
  onAutosave(xml: string): void;
  onExit(): void;
  title?: () => string;
}

export interface DrawioLink {
  send(msg: Record<string, unknown>): void;
  /** Ask draw.io for an SVG data URI of the current diagram (used for host-side Print / PDF). */
  exportSvg(timeoutMs?: number): Promise<string>;
  readonly ready: boolean;
  dispose(): void;
}

export function connectDrawio(frame: HTMLIFrameElement, h: DrawioHandlers): DrawioLink {
  let ready = false;
  const waiters: Array<(data: string | null) => void> = [];

  const send = (msg: Record<string, unknown>) => {
    frame.contentWindow?.postMessage(JSON.stringify(msg), window.location.origin);
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
      case 'init':
        ready = true;
        // autosave:1 turns on `autosave` events without changing the iframe URL.
        send({ action: 'load', xml: h.onInit(), autosave: 1, title: h.title?.() ?? '' });
        break;
      case 'autosave':
        if (typeof msg.xml === 'string') h.onAutosave(msg.xml);
        break;
      case 'save':
        if (typeof msg.xml === 'string') h.onSave(msg.xml);
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
      window.removeEventListener('message', onMessage);
      waiters.splice(0).forEach((w) => w(null));
    },
  };
}
