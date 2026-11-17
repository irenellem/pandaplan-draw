/**
 * How fast does a diagram open? Real Chrome, real draw.io, real HTTP cache. Node 22 built-ins only.
 *
 *   npm run build
 *   node test/stage-drawio.mjs <draw.war | draw.io.app/Contents/Resources/app.asar>   # once → test/.drawio/
 *   npm run test:perf                       # → table + test/out/perf-current.json
 *   node test/perf.mjs --label before --dist ../draw-before/dist   # an older build, same harness
 *
 * Serving: an HTTP server on 127.0.0.1 (ephemeral port) answers dist/ (or --dist), /api/draw/* (the
 * real Worker over an in-memory R2, via test/stub.mjs) and /drawio/* from DRAWIO_DIR, with the same
 * Cache-Control as deploy/nginx.conf and gzip on the wire (Cloudflare uses zstd; for these files the
 * two are within 3%). A real server is required: Chrome's HTTP cache and network throttling are what
 * is being measured. If listening is not allowed here, the harness says so and stops.
 *
 * Every number is measured from the page's own clock, from draw.io's own messages, so it works the
 * same against a build with or without the warm-up:
 *   shell DOM ready  navigation timing domContentLoadedEventEnd
 *   list shown       first saved-work row in the DOM
 *   click → frame    the draw.io iframe that shows the file exists (0 when a warm spare was adopted)
 *   click → usable   draw.io posts {event:"load"} for the clicked file
 *   draw.io bytes    bytes on the wire for /drawio/* during the run, and how many came from cache
 * Scenarios: cold (cache cleared) and warm (cache primed), each with "click as soon as the list
 * shows" and "click after reading the list for 3 s", on an unthrottled link and a 4G profile.
 * Medians of --runs (default 3). Timing results are advisory: the exit code only reports harness errors.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { handle } from './stub.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const LABEL = arg('label', 'current');
const DIST = resolve(arg('dist', join(ROOT, 'dist'))) + '/';
const DRAWIO = resolve(process.env.DRAWIO_DIR || join(ROOT, 'test/.drawio')) + '/';
const RUNS = Number(arg('runs', 3));
const THINK_MS = 3000;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILES = {
  // No throttling: the local machine. The floor for boot (parse + run draw.io), not download.
  local: null,
  // A phone on decent 4G: 9 Mbit/s down, 1.5 up, 170 ms RTT (Lighthouse's "slow 4G" is harsher).
  '4g': { offline: false, latency: 170, downloadThroughput: (9e6 / 8) | 0, uploadThroughput: (1.5e6 / 8) | 0 },
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`No build at ${DIST}. Run npm run build first.`);
  process.exit(2);
}
if (!existsSync(join(DRAWIO, 'js/app.min.js'))) {
  console.error(`No draw.io at ${DRAWIO}. Stage one: node test/stage-drawio.mjs <draw.war | app.asar> (or set DRAWIO_DIR).`);
  process.exit(2);
}

/* ------------------------------------------------------------------ server (mirrors nginx) */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.xml': 'application/xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const nginxCache = (path) => {
  if (path === '/' || path === '/index.html' || path === '/drawio/' || path === '/drawio/index.html') return 'no-store';
  if (path.startsWith('/assets/')) return 'public, max-age=2592000, immutable';
  if (path.startsWith('/drawio/')) return process.env.DRAWIO_CACHE || 'public, max-age=2592000, immutable';
  return null;
};
const gz = new Map();
function fileRes(file, path, acceptGzip) {
  const type = MIME[extname(file)] || 'application/octet-stream';
  let body = readFileSync(file);
  const headers = { 'content-type': type };
  const cc = nginxCache(path);
  if (cc) headers['cache-control'] = cc;
  if (acceptGzip && /^(text|application\/(json|xml)|image\/svg)/.test(type) && body.length > 1024) {
    if (!gz.has(file)) gz.set(file, gzipSync(body, { level: 6 }));
    body = gz.get(file);
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
  }
  return { status: 200, headers, body };
}
function serveStatic(root, rel, path, acceptGzip, spa) {
  const p = normalize(join(root, decodeURIComponent(rel)));
  if (p.startsWith(root) && existsSync(p) && statSync(p).isFile()) return fileRes(p, path, acceptGzip);
  if (p.startsWith(root) && existsSync(join(p, 'index.html'))) return fileRes(join(p, 'index.html'), path, acceptGzip);
  return spa ? fileRes(join(root, 'index.html'), '/index.html', acceptGzip) : { status: 404, headers: { 'content-type': 'text/plain' }, body: Buffer.from('not found') };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const acceptGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    let r;
    if (url.pathname.startsWith('/drawio/')) r = serveStatic(DRAWIO, url.pathname.slice('/drawio/'.length), url.pathname, acceptGzip, false);
    else if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__stub/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      r = await handle(req.method, req.url, req.headers, chunks.length ? Buffer.concat(chunks) : undefined);
    } else r = serveStatic(DIST, url.pathname, url.pathname, acceptGzip, true);
    res.writeHead(r.status, r.headers);
    res.end(r.body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e?.stack ?? e));
  }
});
const BASE = await new Promise((ok) => {
  server.once('error', (e) => {
    console.error(`Cannot listen on 127.0.0.1 (${e.code}). The perf run needs a real HTTP server: the HTTP cache and throttling are what it measures.`);
    console.error('If this is a sandbox, allow local binding (Claude Code: sandbox.network.allowLocalBinding: true) or run it in a normal terminal.');
    process.exit(2);
  });
  server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${server.address().port}`));
});

/* ------------------------------------------------------------------ sample diagram */

function sampleXml(n = 60) {
  let cells = '';
  for (let i = 0; i < n; i++) {
    const x = 40 + (i % 10) * 140;
    const y = 40 + Math.floor(i / 10) * 100;
    cells += `<mxCell id="v${i}" value="Step ${i + 1}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="120" height="60" as="geometry"/></mxCell>`;
    if (i > 0) cells += `<mxCell id="e${i}" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="v${i - 1}" target="v${i}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  }
  return `<mxfile><diagram id="d" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
}
const TITLE = 'Perf sample';
const xml = sampleXml();
const body = JSON.stringify({ kind: 'drawio', version: 1, name: 'perf-sample', title: TITLE, xml, updatedAt: new Date().toISOString() });
await handle('POST', '/__stub/reset');
const put = await handle('PUT', `/api/draw/backup?name=perf-sample&title=${encodeURIComponent(TITLE)}`, { 'content-type': 'application/json' }, Buffer.from(body));
if (put.status >= 300) throw new Error(`seed failed: ${put.status} ${put.body}`);

/* ------------------------------------------------------------------ chrome over a CDP pipe */

const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'pp-perf-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank'], {
  stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
});
let seq = 0;
let session;
const pending = new Map();
const listeners = [];
let inbuf = Buffer.alloc(0);
chrome.stdio[4].on('data', (chunk) => {
  inbuf = Buffer.concat([inbuf, chunk]);
  let i;
  while ((i = inbuf.indexOf(0)) >= 0) {
    const msg = JSON.parse(inbuf.subarray(0, i).toString('utf8'));
    inbuf = inbuf.subarray(i + 1);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  }
});
const send = (method, params = {}, sid = session) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0');
  });
async function run(fn, ...args) {
  const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(fn, what, ms, ...args) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await run(fn, ...args).catch(() => null);
    if (v) return v;
    await sleep(25);
  }
  throw new Error(`timed out (${ms} ms) waiting for ${what}`);
}

/** Runs in the top page before any app code: records when things happen, on the page's clock. */
const PROBE = `if (window.top === window) {
  const h = (window.__h = { listAt: null, frames: [], initAt: [], loadAt: [] });
  new MutationObserver(() => {
    if (h.listAt === null && document.querySelector('.sw-file')) h.listAt = performance.now();
    for (const f of document.querySelectorAll('iframe')) if (!f.__seen) { f.__seen = 1; h.frames.push({ at: performance.now(), el: f }); }
  }).observe(document, { childList: true, subtree: true });
  addEventListener('message', (e) => {
    if (typeof e.data !== 'string' || e.data[0] !== '{') return;
    try {
      const m = JSON.parse(e.data);
      if (m.event === 'init') h.initAt.push(performance.now());
      if (m.event === 'load') h.loadAt.push(performance.now());
    } catch {}
  });
}`;

let net = new Map(); // requestId -> {url, bytes, cached}
listeners.push((m) => {
  if (m.sessionId !== session) return;
  const p = m.params;
  if (m.method === 'Network.requestWillBeSent') net.set(p.requestId, { url: p.request.url, bytes: 0, cached: false, done: false });
  else if (m.method === 'Network.requestServedFromCache') net.get(p.requestId) && (net.get(p.requestId).cached = true);
  else if (m.method === 'Network.responseReceived') {
    const r = net.get(p.requestId);
    if (r && (p.response.fromDiskCache || p.response.fromPrefetchCache)) r.cached = true;
  } else if (m.method === 'Network.loadingFinished') {
    const r = net.get(p.requestId);
    if (r) Object.assign(r, { bytes: p.encodedDataLength, done: true });
  }
});

async function once({ cold, think, throttle }) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  if (cold) await send('Network.clearBrowserCache');
  await send('Network.emulateNetworkConditions', throttle ?? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  net = new Map();
  await send('Page.navigate', { url: `${BASE}/` });
  await waitFor(() => !!window.__h?.listAt, 'saved-work list', 60000);
  if (think) await sleep(think);
  const clickAt = await run((title) => {
    const li = [...document.querySelectorAll('.sw-file')].find((x) => x.querySelector('.sw-name strong')?.textContent === title);
    if (!li) throw new Error('no sample row');
    const t = performance.now();
    window.__h.clickAt = t;
    li.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return t;
  }, TITLE);
  const r = await waitFor(
    () => {
      const h = window.__h;
      const usable = h.loadAt.find((t) => t >= h.clickAt);
      if (usable === undefined) return null;
      const nav = performance.getEntriesByType('navigation')[0];
      const shown = document.querySelector('iframe');
      const frame = h.frames.find((f) => f.el === shown);
      return {
        domReady: Math.round(nav.domContentLoadedEventEnd),
        listShown: Math.round(h.listAt),
        clickToFrame: frame ? Math.max(0, Math.round(frame.at - h.clickAt)) : null,
        frameBeforeClick: frame ? frame.at < h.clickAt : null,
        clickToUsable: Math.round(usable - h.clickAt),
        app: (window.__pandadrawPerf || []).at(-1) || null,
      };
    },
    'draw.io load event',
    90000,
  );
  await sleep(300); // let in-flight loadingFinished events land
  const dio = [...net.values()].filter((x) => new URL(x.url).pathname.startsWith('/drawio/'));
  r.drawioRequests = dio.length;
  r.drawioFromCache = dio.filter((x) => x.cached).length;
  r.drawioBytes = dio.filter((x) => !x.cached).reduce((a, x) => a + x.bytes, 0);
  r.clickAt = Math.round(clickAt);
  return r;
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};

const results = [];
let failed = 0;
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });

  for (const [net_, throttle] of Object.entries(PROFILES)) {
    for (const cold of [true, false]) {
      for (const think of [0, THINK_MS]) {
        const runs = [];
        if (!cold) await once({ cold: false, think: 0, throttle }); // prime the cache with this build
        for (let i = 0; i < RUNS; i++) runs.push(await once({ cold, think, throttle }));
        const row = {
          network: net_,
          cache: cold ? 'cold' : 'warm',
          think,
          domReady: median(runs.map((r) => r.domReady)),
          listShown: median(runs.map((r) => r.listShown)),
          clickToFrame: median(runs.map((r) => r.clickToFrame)),
          spareAdopted: runs.filter((r) => r.frameBeforeClick).length + `/${runs.length}`,
          clickToUsable: median(runs.map((r) => r.clickToUsable)),
          drawioBytes: median(runs.map((r) => r.drawioBytes)),
          drawioRequests: median(runs.map((r) => r.drawioRequests)),
          drawioFromCache: median(runs.map((r) => r.drawioFromCache)),
          runs,
        };
        results.push(row);
        console.log(
          `${net_.padEnd(5)} ${row.cache} think=${String(think).padStart(4)}ms  dom ${row.domReady} ms · list ${row.listShown} ms · click→frame ${row.clickToFrame} ms (spare ${row.spareAdopted}) · click→usable ${row.clickToUsable} ms · draw.io ${(row.drawioBytes / 1e6).toFixed(2)} MB over ${row.drawioRequests - row.drawioFromCache} requests, ${row.drawioFromCache} from cache`,
        );
      }
    }
  }
  // Targets from TASK_SPEED.md: reported, never a gate.
  const pick = (n, c, t) => results.find((r) => r.network === n && r.cache === c && r.think === t)?.clickToUsable;
  const verdict = (v, max) => (v == null ? 'n/a' : `${v} ms ${v <= max ? '≤' : '>'} ${max} ms → ${v <= max ? 'met' : 'MISSED'}`);
  console.log(`\nadvisory targets (${LABEL}):`);
  console.log(`  warm click → usable (local, click at once): ${verdict(pick('local', 'warm', 0), 1500)}`);
  console.log(`  cold click → usable (4g, click at once):    ${verdict(pick('4g', 'cold', 0), 8000)}`);
  console.log(`  cold click → usable (4g, 3 s on the list):  ${verdict(pick('4g', 'cold', THINK_MS), 8000)}`);
} catch (e) {
  failed = 1;
  console.error(`perf harness error: ${e.stack || e.message}`);
} finally {
  mkdirSync(join(ROOT, 'test/out'), { recursive: true });
  const out = join(ROOT, `test/out/perf-${LABEL}.json`);
  writeFileSync(out, JSON.stringify({ label: LABEL, dist: DIST, drawio: DRAWIO, runs: RUNS, profiles: PROFILES, at: new Date().toISOString(), results }, null, 2));
  console.log(`\nwrote ${out}`);
  chrome.kill();
  server.close();
  process.exit(failed);
}
