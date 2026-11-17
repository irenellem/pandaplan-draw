/**
 * Local stand-in for draw.pandaplan.work's edge, for tests only. No dependencies.
 *
 *   /api/draw/*   -> the REAL Worker module (worker/pandaplan-draw-api.mjs) over an in-memory R2
 *   /drawio/      -> a tiny fake of the draw.io embed page (init / load / autosave / export protocol)
 *   /__stub/dump  -> every stored object (key, customMetadata, parsed body) for assertions
 *   /__stub/seed  -> POST {count, folder?} stores that many filler objects (for the 400-item cap)
 *   /__stub/reset -> POST empties the bucket
 *   anything else -> `static(path)` (dist/ files with SPA fallback, or a proxy to `vite preview`)
 *
 * `handle()` is transport-free: test/stub-server.mjs serves it over HTTP, test/e2e.mjs feeds it
 * Chrome's intercepted requests (no port needed).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/pandaplan-draw-api.mjs';
import { callWorker, fakeR2 } from './fakeR2.mjs';

export const env = { BACKUPS: fakeR2() };

/** The fake editor: a textarea is the "canvas"; every keystroke is a draw.io `autosave` event. */
export const FAKE_DRAWIO = `<!doctype html><html><head><meta charset="utf-8"><title>fake draw.io</title></head>
<body style="margin:0"><textarea id="canvas" style="width:100%;height:300px"></textarea><div id="title"></div>
<script>
  const post = (m) => parent.postMessage(JSON.stringify(m), location.origin);
  const area = document.getElementById('canvas');
  let base = '';
  const enc = (s) => s.replace(/[&"<>]/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const dec = (s) => s.replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(n));
  const xml = () => base.replace(/(<mxCell id="t"[^>]*\\/>)?<\\/root>/, '<mxCell id="t" value="' + enc(area.value) + '" vertex="1" parent="1"/></root>');
  window.addEventListener('message', (ev) => {
    if (ev.source !== parent) return;
    const m = JSON.parse(ev.data);
    if (m.action === 'load') {
      base = m.xml;
      const hit = /<mxCell id="t" value="([^"]*)"/.exec(base);
      area.value = hit ? dec(hit[1]) : '';
      document.getElementById('title').textContent = m.title || '';
      document.body.dataset.loaded = '1';
      post({ event: 'load', xml: base }); // real draw.io (proto=json) answers every load with this
    }
    if (m.action === 'export') {
      const h = Number(localStorage.getItem('fakeSvgHeight')) || 300;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="' + h + '"><rect width="100%" height="100%" fill="#ddd"/></svg>';
      post({ event: 'export', data: 'data:image/svg+xml;base64,' + btoa(svg) });
    }
  });
  area.addEventListener('input', () => post({ event: 'autosave', xml: xml() }));
  // localStorage.fakeInitDelay (ms) holds back init, to see the loader's stages in e2e.
  const delay = Number(localStorage.getItem('fakeInitDelay')) || 0;
  setTimeout(() => { document.body.dataset.inited = '1'; post({ event: 'init' }); }, delay);
</script></body></html>`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

/** Serve dist/ like nginx does: real file, else the SPA shell. */
export function distStatic(path) {
  const p = normalize(join(DIST, decodeURIComponent(path)));
  const file = p.startsWith(DIST) && existsSync(p) && statSync(p).isFile() ? p : join(DIST, 'index.html');
  return { status: 200, headers: { 'content-type': MIME[extname(file)] || 'application/octet-stream' }, body: readFileSync(file) };
}

const jsonRes = (obj) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(obj)) });

/** One request in, one response out: `{status, headers, body: Buffer}`. */
export async function handle(method, rawUrl, headers = {}, body, staticHandler = distStatic) {
  const url = new URL(rawUrl, 'http://stub.local');
  if (url.pathname.startsWith('/api/draw')) {
    const r = await callWorker(worker, env, url.pathname + url.search, {
      method,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      headers: { 'content-type': headers['content-type'] || headers['Content-Type'] || '' },
    });
    const h = {};
    r.headers.forEach((v, k) => (h[k] = v));
    return { status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) };
  }
  if (url.pathname === '/drawio/' || url.pathname === '/drawio/index.html') {
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: Buffer.from(FAKE_DRAWIO) };
  }
  if (url.pathname === '/__stub/dump') {
    return jsonRes(
      [...env.BACKUPS.objects].map(([key, o]) => {
        let parsed;
        try {
          parsed = JSON.parse(o.body);
        } catch {
          parsed = o.body;
        }
        return { key, customMetadata: o.customMetadata, body: parsed };
      }),
    );
  }
  if (url.pathname === '/__stub/seed' && method === 'POST') {
    const { count = 0, folder = 'filler' } = JSON.parse(body ? Buffer.from(body).toString() : '{}');
    for (let i = 0; i < count; i++) {
      const name = `filler-${String(i).padStart(4, '0')}`;
      const title = `Filler ${i}`;
      await env.BACKUPS.put(`draws/${folder}/${name}.pandadraw`, JSON.stringify({ kind: 'drawio', version: 1, name, title, xml: '<mxfile/>', updatedAt: new Date(0).toISOString() }), { customMetadata: { title } });
    }
    return jsonRes({ ok: true, total: env.BACKUPS.objects.size });
  }
  if (url.pathname === '/__stub/reset' && method === 'POST') {
    env.BACKUPS.objects.clear();
    return jsonRes({ ok: true });
  }
  return staticHandler(url.pathname + url.search);
}
