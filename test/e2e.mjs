/**
 * End-to-end check in headless Chrome over the DevTools protocol (Node 22 built-ins only).
 *
 *   npm run build && node test/e2e.mjs
 *
 * No port is opened (this machine's sandbox forbids listening): Chrome talks CDP over a pipe, and
 * every request the page makes to ORIGIN is intercepted (Fetch domain) and answered by
 * test/stub.mjs — dist/ files with SPA fallback (what `vite preview` serves), the real Worker
 * module over an in-memory R2 for /api/draw/*, and a fake draw.io embed page for /drawio/.
 * Where ports are allowed, `node test/e2e.mjs http://127.0.0.1:4190` drives test/stub-server.mjs instead.
 *
 * Every check is printed PASS/FAIL; the exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from './stub.mjs';

const LIVE = process.argv[2]; // an http stub-server, if given; else in-process interception
const BASE = LIVE || 'http://127.0.0.1:4188';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TITLE = 'PR# 123 – QC Report';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ chrome + CDP plumbing */

const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'pp-e2e-'));
const downloads = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'pp-dl-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];

let seq = 0;
let session; // the page's flat session id
const pending = new Map();
const listeners = [];
let inbuf = Buffer.alloc(0);
fromChrome.on('data', (chunk) => {
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
/** Browser-level when `sid` is null, else the page session. */
const send = (method, params = {}, sid = session) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    toChrome.write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0');
  });
const cdp = (method, params) => send(method, params);

async function connect() {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
  if (LIVE) return;
  // Answer every request for ORIGIN from the in-process stub.
  listeners.push(async (msg) => {
    if (msg.method !== 'Fetch.requestPaused' || msg.sessionId !== session) return;
    const { requestId, request } = msg.params;
    try {
      const body = request.postDataEntries?.length
        ? Buffer.concat(request.postDataEntries.map((e) => Buffer.from(e.bytes ?? '', 'base64')))
        : request.postData !== undefined
          ? Buffer.from(request.postData, 'utf8')
          : undefined;
      const r = await handle(request.method, request.url, request.headers, body);
      await cdp('Fetch.fulfillRequest', {
        requestId,
        responseCode: r.status,
        responseHeaders: Object.entries(r.headers).map(([name, value]) => ({ name, value: String(value) })),
        body: r.body.toString('base64'),
      });
    } catch (e) {
      await cdp('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => undefined);
      console.log(`stub error for ${request.method} ${request.url}: ${e.stack}`);
    }
  });
  await cdp('Fetch.enable', { patterns: [{ urlPattern: `${BASE}/*` }] });
}
const stub = async (path, method = 'GET', body) =>
  LIVE ? (await fetch(BASE + path, { method, body })).json() : JSON.parse((await handle(method, BASE + path, {}, body && Buffer.from(body))).body.toString());

/** Evaluate in the app page; `fn` is a function source, args are JSON. */
async function run(fn, ...args) {
  const r = await cdp('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(fn, what, ms = 8000, ...args) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await run(fn, ...args).catch((e) => `error: ${e.message}`);
    if (last && !(typeof last === 'string' && last.startsWith('error:'))) return last;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}
async function key(k, { ctrl = false, code, vk } = {}) {
  const base = { key: k, code: code ?? k, windowsVirtualKeyCode: vk ?? 0, modifiers: ctrl ? 2 : 0 };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(k === 'Enter' ? { text: '\r' } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
const ENTER = () => key('Enter', { code: 'Enter', vk: 13 });
const typeText = (text) => cdp('Input.insertText', { text });
async function goto(url) {
  await cdp('Page.navigate', { url });
  await waitFor(() => document.readyState === 'complete' && !!document.querySelector('.sw-tree'), 'page load');
}
const dump = () => stub('/__stub/dump');

/* --------------------------------------------------------------------------- page helpers */

const rowTitles = () => [...document.querySelectorAll('.sw-file .sw-name strong')].map((e) => e.textContent);
const clickButton = (label) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === label || x.getAttribute('aria-label') === label);
  if (!b) throw new Error(`no button ${label}`);
  if (b.disabled) throw new Error(`button ${label} is disabled`);
  b.click();
  return true;
};
const focusRow = (title) => {
  const li = [...document.querySelectorAll('.sw-file')].find((x) => x.querySelector('.sw-name strong')?.textContent === title);
  if (!li) throw new Error(`no row ${title}`);
  li.focus();
  return true;
};
const status = () => document.querySelector('.sw-status')?.textContent ?? '';

/* ------------------------------------------------------------------------------- checks */

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } catch (e) {
    results.push({ ok: false, name, detail: e.message });
    console.log(`FAIL  ${name}  — ${e.message}`);
  }
}
function eq(a, b, what) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

try {
  await connect();
  await stub('/__stub/reset', 'POST');
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }, null).catch((e) => console.log('downloads:', e.message));
  await goto(`${BASE}/`);
  await waitFor(() => !!document.querySelector('.sw-empty-main button'), 'editor mounted (fake /drawio/ probed)');

  await check(`create "${TITLE}" → tree row reads it exactly`, async () => {
    await run(clickButton, 'New diagram');
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === 'New diagram name', 'name input');
    await typeText(TITLE);
    await ENTER();
    const rows = await waitFor((t) => (document.querySelectorAll('.sw-file').length ? [...document.querySelectorAll('.sw-file .sw-name strong')].map((e) => e.textContent) : null), 'a row', 8000, TITLE);
    eq(rows, [TITLE], 'rows');
    return JSON.stringify(rows);
  });

  await check('file bar, document.title and editor title use the title', async () => {
    await waitFor(() => document.querySelector('iframe')?.contentDocument?.body?.dataset.loaded === '1', 'fake editor loaded');
    const got = await run(() => ({
      bar: document.querySelector('.sw-filebar-name strong')?.textContent,
      doc: document.title,
      editor: document.querySelector('iframe').contentDocument.getElementById('title').textContent,
      sheet: document.querySelector('.print-sheet h1')?.textContent,
    }));
    eq(got, { bar: TITLE, doc: `${TITLE} · PandaPlan Draw`, editor: TITLE, sheet: TITLE }, 'labels');
    return JSON.stringify(got);
  });

  await check('type in the canvas → autosave reaches "Saved HH:MM" and stores the edit', async () => {
    await waitFor(() => /^Saved /.test(document.querySelector('.sw-status')?.textContent ?? ''), 'first save of the new file');
    await run(() => {
      const f = document.querySelector('iframe');
      f.contentWindow.focus();
      f.contentDocument.getElementById('canvas').focus();
      return true;
    });
    await typeText('hello from e2e');
    await waitFor(() => (document.querySelector('.sw-status')?.textContent ?? '') === 'Unsaved changes…', '"Unsaved changes…"', 3000);
    const s = await waitFor(() => {
      const t = document.querySelector('.sw-status')?.textContent ?? '';
      return /^Saved \d{1,2}:\d{2}/.test(t) ? t : null;
    }, '"Saved HH:MM"', 6000);
    const d = await dump();
    const mine = d.find((o) => o.body?.title === TITLE);
    if (!mine || !mine.body.xml.includes('hello from e2e')) throw new Error(`stored payload lacks the edit: ${JSON.stringify(d.map((o) => o.key))}`);
    return `status "${s}", key ${mine.key}`;
  });

  await check('reload → title survives (from the stored payload and the list metadata)', async () => {
    await goto(`${BASE}/`);
    const rows = await waitFor(() => (document.querySelectorAll('.sw-file').length ? [...document.querySelectorAll('.sw-file .sw-name strong')].map((e) => e.textContent) : null), 'rows after reload');
    eq(rows, [TITLE], 'rows after reload');
    const d = await dump();
    eq(d.map((o) => [o.body.title, o.customMetadata.title]), [[TITLE, TITLE]], 'stored payload title / customMetadata.title');
    return `row ${JSON.stringify(rows[0])}, stored ${d[0].key}`;
  });

  await check(`Duplicate (Ctrl+D on the focused row) → "${TITLE} copy", separate key, selected, not opened`, async () => {
    await run(focusRow, TITLE);
    await key('d', { ctrl: true, code: 'KeyD', vk: 68 });
    const rows = await waitFor(() => (document.querySelectorAll('.sw-file').length === 2 ? [...document.querySelectorAll('.sw-file .sw-name strong')].map((e) => e.textContent) : null), 'two rows');
    eq([...rows].sort(), [TITLE, `${TITLE} copy`].sort(), 'rows');
    const d = await dump();
    const keys = d.map((o) => o.key);
    if (new Set(keys).size !== 2) throw new Error(`keys not distinct: ${keys}`);
    const copy = d.find((o) => o.body.title === `${TITLE} copy`);
    if (!copy?.body.xml.includes('hello from e2e')) throw new Error('copy lacks the source XML');
    const ui = await run(() => ({ selected: document.querySelector('.sw-file.selected .sw-name strong')?.textContent, open: document.querySelector('.sw-filebar-name strong')?.textContent ?? null }));
    eq(ui, { selected: `${TITLE} copy`, open: null }, 'selection / nothing opened');
    return `keys ${JSON.stringify(keys)}`;
  });

  await check('Duplicate button on an OPEN file copies the unsaved on-screen XML, not the stale cloud copy', async () => {
    await run(() => {
      const li = [...document.querySelectorAll('.sw-file')].find((x) => x.querySelector('.sw-name strong')?.textContent === 'PR# 123 – QC Report');
      li.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    });
    await waitFor(() => document.querySelector('iframe')?.contentDocument?.body?.dataset.loaded === '1', 'editor loaded');
    await run(() => {
      const f = document.querySelector('iframe');
      f.contentWindow.focus();
      f.contentDocument.getElementById('canvas').focus();
      return true;
    });
    await typeText(' +fresh');
    await run(focusRow, TITLE);
    await run(clickButton, 'Duplicate selected');
    const rows = await waitFor(() => (document.querySelectorAll('.sw-file').length === 3 ? [...document.querySelectorAll('.sw-file .sw-name strong')].map((e) => e.textContent) : null), 'three rows');
    const d = await dump();
    const c2 = d.find((o) => / copy( \d+)?$/.test(o.body.title ?? '') && o.body.xml.includes('+fresh'));
    if (!c2) throw new Error(`no copy carries the unsaved edit; rows ${JSON.stringify(rows)}`);
    return `${c2.key} ← rows ${JSON.stringify(rows)}`;
  });

  await check('rename keeps free text (capitals, punctuation); old key is gone, nothing left in another folder', async () => {
    const NEW = 'Q&A: Final — v2 (Draft)';
    await waitFor(() => /^Saved /.test(document.querySelector('.sw-status')?.textContent ?? ''), 'saves settled', 6000);
    const before = (await dump()).map((o) => o.key);
    await run(focusRow, TITLE);
    await key('F2', { code: 'F2', vk: 113 });
    await waitFor(() => document.activeElement?.classList.contains('sw-rename') && document.activeElement.value === 'PR# 123 – QC Report', 'rename input prefilled with the title');
    await run(() => document.activeElement.select());
    await typeText(NEW);
    await ENTER();
    await waitFor((n) => [...document.querySelectorAll('.sw-file .sw-name strong')].some((e) => e.textContent === n), 'renamed row', 8000, NEW);
    await sleep(300);
    const d = await dump();
    const renamed = d.find((o) => o.body.title === NEW);
    if (!renamed) throw new Error('renamed payload missing');
    const gone = before.find((k) => /\/pr-123-qc-report\.pandadraw$/.test(k));
    if (d.some((o) => o.key === gone)) throw new Error(`old key ${gone} still stored`);
    const bar = await run(() => document.querySelector('.sw-filebar-name strong')?.textContent);
    eq(bar, NEW, 'file bar after renaming the open file');
    return `${gone} → ${renamed.key}`;
  });

  await check('Download names the file <title>.drawio (filesystem-safe)', async () => {
    await run(clickButton, 'Download');
    const name = await (async () => {
      for (let i = 0; i < 50; i++) {
        const f = readdirSync(downloads).filter((x) => !x.endsWith('.crdownload'));
        if (f.length) return f[0];
        await sleep(100);
      }
      throw new Error('no download arrived');
    })();
    eq(name, 'Q&A Final — v2 (Draft).drawio', 'download name');
    if (!readFileSync(join(downloads, name), 'utf8').includes('<mxfile')) throw new Error('download is not draw.io XML');
    return name;
  });

  await check('print sheet: hidden on screen, prints the title on exactly one page (tall diagram)', async () => {
    await run(() => {
      document.querySelector('iframe').contentWindow.localStorage.setItem('fakeSvgHeight', '4000');
      return true;
    });
    await run(() => {
      window.print = () => undefined; // headless: the app's own print path, minus the dialog
      return true;
    });
    await run(clickButton, 'Print / PDF');
    await waitFor(() => !!document.querySelector('.print-sheet img')?.complete, 'print image');
    const shown = await run(() => getComputedStyle(document.querySelector('.print-sheet')).display);
    eq(shown, 'none', 'on-screen display');
    const pdf = Buffer.from((await cdp('Page.printToPDF', { preferCSSPageSize: true })).data, 'base64').toString('latin1');
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
    eq(pages, 1, 'PDF pages');
    return `display:${shown}, ${pages} page`;
  });

  /* ------------------------------------------------ fast open: warm-up, hand-off, loader */
  const OPENME = 'Q&A: Final — v2 (Draft)';
  const openRow = (title) => {
    const li = [...document.querySelectorAll('.sw-file')].find((x) => x.querySelector('.sw-name strong')?.textContent === title);
    if (!li) throw new Error(`no row ${title}`);
    li.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return true;
  };
  const settledThenReload = async () => {
    await waitFor(() => !/Unsaved|Saving/.test(document.querySelector('.sw-status')?.textContent ?? ''), 'saves settled', 8000);
    await goto(`${BASE}/`);
    await waitFor(() => document.querySelectorAll('.sw-file').length > 0, 'rows');
  };

  await check('warm-up: once the list shows, draw.io files are prefetched and a hidden editor boots behind the empty state', async () => {
    await settledThenReload();
    const got = await waitFor(() => {
      const f = document.querySelector('.sw-frame-wrap.spare iframe');
      if (!f || f.contentDocument?.body?.dataset.inited !== '1') return null;
      return {
        prefetch: [...document.querySelectorAll('link[rel=prefetch][data-drawio-prefetch]')].map((l) => new URL(l.href).pathname),
        hidden: getComputedStyle(f.parentElement).visibility,
        empty: !!document.querySelector('.sw-empty-main'),
        frames: document.querySelectorAll('iframe').length,
      };
    }, 'spare editor booted', 8000);
    if (!got.prefetch.includes('/drawio/js/app.min.js')) throw new Error(`prefetch: ${JSON.stringify(got.prefetch)}`);
    if (got.prefetch.some((x) => x.endsWith('index.html') || x.endsWith('/'))) throw new Error(`prefetched the no-store page: ${got.prefetch}`);
    eq({ hidden: got.hidden, empty: got.empty, frames: got.frames }, { hidden: 'hidden', empty: true, frames: 1 }, 'spare state');
    return `${got.prefetch.length} prefetches, spare hidden behind the empty state`;
  });

  await check('open a file → the warm editor is adopted (same iframe, not reloaded), file loads, skeleton gone', async () => {
    await run(() => {
      window.__warm = document.querySelector('iframe');
      window.__warm.contentWindow.__booted = 'yes'; // gone if the frame reloads
      return true;
    });
    await run(openRow, OPENME);
    await waitFor(() => document.querySelector('iframe')?.contentDocument?.body?.dataset.loaded === '1', 'file loaded into the editor');
    await waitFor(() => !document.querySelector('.sw-skeleton'), 'skeleton gone', 3000);
    const got = await run(() => {
      const f = document.querySelector('iframe');
      const rec = (window.__pandadrawPerf || []).at(-1) || null;
      return { same: f === window.__warm, booted: f.contentWindow.__booted ?? null, frames: document.querySelectorAll('iframe').length, spare: !!document.querySelector('.sw-frame-wrap.spare'), title: f.contentDocument.getElementById('title').textContent, rec };
    });
    eq({ same: got.same, booted: got.booted, frames: got.frames, spare: got.spare, title: got.title, path: got.rec?.path }, { same: true, booted: 'yes', frames: 1, spare: false, title: OPENME, path: 'warm-booted' }, 'adoption');
    return `advisory timing (fake editor, not a gate): click → usable ${got.rec.clickToUsableMs} ms`;
  });

  await check('loader: canvas skeleton with a stage line, "Still working…" after 8 s, never the old bullet text', async () => {
    await run(() => {
      localStorage.setItem('fakeInitDelay', '12000');
      return true;
    });
    try {
      await settledThenReload();
      await run(openRow, OPENME);
      const first = await waitFor(() => {
        const s = document.querySelector('.sw-skeleton .sw-skel-stage');
        return s ? { text: s.textContent, grid: !!document.querySelector('.sw-skeleton .sw-skel-canvas'), old: document.body.textContent.includes('Loading the drawing editor') } : null;
      }, 'skeleton', 4000);
      eq(first, { text: 'Preparing the editor…', grid: true, old: false }, 'first stage');
      const slow = await waitFor(() => document.querySelector('.sw-skel-stage span')?.textContent ?? null, '"Still working" line', 10000);
      eq(slow, 'Still working — the editor takes a few seconds on a fresh session.', 'slow line');
      await waitFor(() => !document.querySelector('.sw-skeleton') && document.querySelector('iframe')?.contentDocument?.body?.dataset.loaded === '1', 'editor usable after the slow boot', 8000);
      return `"${first.text}" → "${slow}"`;
    } finally {
      await run(() => {
        localStorage.removeItem('fakeInitDelay');
        return true;
      });
    }
  });

  await check('Save-Data: no prefetch and no spare editor; opening a file still works (fresh frame)', async () => {
    const { identifier } = await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(Navigator.prototype, 'connection', { configurable: true, get: () => ({ saveData: true }) });`,
    });
    try {
      await settledThenReload();
      await sleep(2500); // past any idle callback
      const before = await run(() => ({ prefetch: document.querySelectorAll('link[rel=prefetch]').length, frames: document.querySelectorAll('iframe').length }));
      eq(before, { prefetch: 0, frames: 0 }, 'nothing warmed');
      await run(openRow, OPENME);
      await waitFor(() => document.querySelector('iframe')?.contentDocument?.body?.dataset.loaded === '1', 'file loaded');
      const path = await waitFor(() => (window.__pandadrawPerf || []).at(-1)?.path ?? null, 'perf record');
      eq(path, 'fresh', 'open path');
      return 'nothing fetched ahead; open used a fresh frame';
    } finally {
      await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    }
  });

  await check('list cut at 400 → the panel says "Showing 400 of N"', async () => {
    await stub('/__stub/seed', 'POST', JSON.stringify({ count: 420 }));
    await run(clickButton, 'Refresh list');
    const note = await waitFor(() => document.querySelector('.sw-truncated')?.textContent ?? null, 'truncation notice', 5000);
    if (!/Showing 400 of 42\d/.test(note)) throw new Error(`notice: ${note}`);
    return note;
  });

  await check('?selftest=1 renders its JSON', async () => {
    await cdp('Page.navigate', { url: `${BASE}/?selftest=1` });
    const txt = await waitFor(() => document.getElementById('selftest-json')?.textContent ?? null, '#selftest-json', 5000);
    const j = JSON.parse(txt);
    if (j.ok !== true) throw new Error(txt);
    return `ok=${j.ok}, ${j.checks.length} checks: ${j.checks.map((c) => `${c.name}:${c.ok}`).join(', ')}`;
  });
} catch (e) {
  results.push({ ok: false, name: 'harness', detail: e.message });
  console.log(`FAIL  harness — ${e.message}`);
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  chrome.kill();
  process.exit(failed);
}
