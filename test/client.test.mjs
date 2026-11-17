// node --test test/client.test.mjs
// The app's own src/ modules (bundled with the esbuild vite already ships), with `fetch` routed to the
// real Worker over an in-memory R2 (test/stub.mjs). No browser: the React panel is rendered to HTML.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { env, handle } from './stub.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outfile = `${root}test/out/client-bundle.mjs`;
mkdirSync(`${root}test/out`, { recursive: true });
await build({
  stdin: {
    contents: `
      export * from './src/lib/savedWork';
      export { slugify, makeFile } from './src/lib/drawioFile';
      export { titleFilename } from './src/lib/download';
      export { runSelfTest } from './src/lib/selftest';
      export { nextSlot, newSpare } from './src/lib/editorSlot';
      export { connectDrawio } from './src/lib/drawioProtocol';
      export { prefetchUrls, warmupAllowed } from './src/lib/warmup';
      export { SavedWorkPanel } from './src/components/SavedWorkPanel';
      export { createElement } from 'react';
      export { renderToStaticMarkup } from 'react-dom/server';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  packages: 'external', // react, react-dom, lucide-react from node_modules
  outfile,
  logLevel: 'error',
});

// Browser globals the modules touch.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const requests = [];
globalThis.fetch = async (url, init = {}) => {
  requests.push({ method: init.method || 'GET', url: String(url) });
  const r = await handle(init.method || 'GET', String(url), init.headers || {}, init.body === undefined ? undefined : Buffer.from(init.body));
  return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
};

const m = await import(pathToFileURL(outfile).href);
const TITLE = 'PR# 123 – QC Report';
const xml = '<mxfile host="t"><diagram id="d" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

test('before: the old display path turned the typed name into "Pr 123 qc report"', () => {
  // HEAD rendered pretty(slug) for every name; slugify/pretty are unchanged, so this is that output.
  assert.equal(m.pretty(m.slugify(TITLE)), 'Pr 123 qc report');
});

test('saveXml sends &title= and the payload carries it; a fresh list (a reload) shows it exactly', async () => {
  env.BACKUPS.objects.clear();
  const name = m.uniqueSlug(TITLE, []);
  await m.saveXml(name, '', xml, TITLE);
  const put = requests.findLast((r) => r.method === 'PUT');
  assert.ok(put.url.includes(`&title=${encodeURIComponent(TITLE)}`), put.url);
  const [stored] = [...env.BACKUPS.objects.values()];
  assert.equal(JSON.parse(stored.body).title, TITLE);
  assert.equal(stored.customMetadata.title, TITLE);
  const { entries, error } = await m.listEntries();
  assert.equal(error, null);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, TITLE);
  assert.equal(entries[0].folder, '');
  assert.equal(m.titleOf(entries[0]), TITLE);
  assert.equal(await m.readXml(entries[0]), xml);
});

test('a copy gets "<title> copy" and its own key', async () => {
  const { entries } = await m.listEntries();
  const title = m.clampTitle(`${m.titleOf(entries[0])} copy`);
  const name = m.uniqueSlug(title, entries.map((e) => e.name));
  await m.saveXml(name, entries[0].folder, await m.readXml(entries[0]), title);
  const after = (await m.listEntries()).entries;
  assert.deepEqual(after.map((e) => e.title).sort(), [TITLE, `${TITLE} copy`].sort());
  assert.equal(new Set(after.map((e) => e.key)).size, 2);
});

test('deleteEntry for an unfiled file never touches the same name in a folder', async () => {
  env.BACKUPS.objects.clear();
  await m.saveXml('plan', '', xml, 'Plan');
  await m.saveXml('plan', 'team', xml, 'Plan (team)');
  await m.deleteEntry('plan', '');
  assert.ok(requests.findLast((r) => r.method === 'DELETE').url.includes('&folder='));
  assert.deepEqual([...env.BACKUPS.objects.keys()], ['draws/team/plan.pandadraw']);
});

test('a list cut at 400 is reported as truncated', async () => {
  env.BACKUPS.objects.clear();
  await handle('POST', '/__stub/seed', {}, Buffer.from(JSON.stringify({ count: 420 })));
  const r = await m.listEntries();
  assert.deepEqual(r.truncated, { shown: 400, total: 420 });
});

test('old files without a title fall back to pretty(slug)', async () => {
  env.BACKUPS.objects.clear();
  await env.BACKUPS.put('draws/2026-01-02/q4-roadmap.pandadraw', JSON.stringify({ kind: 'drawio', version: 1, name: 'q4-roadmap', xml, updatedAt: '' }));
  const [e] = (await m.listEntries()).entries;
  assert.equal(e.title, '');
  assert.equal(m.titleOf(e), 'Q4 roadmap');
});

test('the panel renders titles exactly, the Duplicate action and the truncation notice', () => {
  const entry = (name, title, folder = '') => ({ id: folder ? `${folder}/${name}` : name, name, title, folder, source: 'cloud', key: `draws/x/${name}.pandadraw`, size: 900, updated: new Date().toISOString(), versions: 1 });
  const html = m.renderToStaticMarkup(
    m.createElement(m.SavedWorkPanel, {
      entries: [entry('pr-123-qc-report', TITLE), entry('pr-123-qc-report-copy', `${TITLE} copy`), entry('q4-roadmap', '')],
      loading: false, error: null, activeId: null, save: { state: 'idle' }, folders: [], theme: 'light',
      truncated: { shown: 400, total: 431 },
      onTheme() {}, onOpen() {}, onNew: async () => '', onRename: async () => null, onDuplicate: async () => null, onDelete: () => false,
      onMove: async () => null, onNewFolder: () => '', onRenameFolder: async () => null, onDeleteFolder: () => false,
      onRefresh() {}, onPrint() {}, onDownload() {},
    }),
  );
  const rows = [...html.matchAll(/<span class="sw-name"><strong>([^<]*)<\/strong>/g)].map((x) => x[1]);
  assert.deepEqual(rows, [TITLE, `${TITLE} copy`, 'Q4 roadmap']);
  assert.match(html, /aria-label="Duplicate selected"/);
  assert.match(html, /aria-label="Duplicate PR# 123 – QC Report"/);
  assert.match(html, /Showing 400 of 431 saved copies/);
});

test('?selftest=1 diagnostics are all ok and JSON-serialisable', () => {
  const r = JSON.parse(JSON.stringify(m.runSelfTest('0.1.0', '/')));
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.ok(r.checks.length >= 11, `${r.checks.length} checks`);
  assert.ok('timings' in r && 'shell' in r.timings && 'lastOpen' in r.timings);
});

test('editor frames: a spare is adopted once, a frame never changes file', () => {
  const spare = m.newSpare();
  const a = m.nextSlot(spare, { token: 1 });
  assert.deepEqual(a, { key: spare.key, token: 1 }, 'first open adopts the spare (same key = same iframe)');
  assert.equal(m.nextSlot(a, { token: 1 }), a, 'rename/move of the open file keeps its frame');
  const b = m.nextSlot(a, { token: 2 });
  assert.notEqual(b.key, a.key, 'switching file A → B gets a new frame, never reuses A\'s');
  assert.equal(b.token, 2);
  assert.equal(m.nextSlot(b, null), null, 'closing drops that file\'s frame');
  assert.equal(m.nextSlot(spare, null), spare, 'a spare survives with nothing open');
  assert.equal(m.nextSlot(null, { token: 3 }).token, 3, 'no spare: a fresh frame, as before');
});

test('draw.io protocol: a spare defers its single load until a file is assigned', () => {
  const ORIGIN = 'http://stub.local';
  const win = new EventTarget();
  win.location = { origin: ORIGIN };
  const prevWindow = globalThis.window;
  globalThis.window = win;
  try {
    const sent = [];
    const child = { postMessage: (data) => sent.push(JSON.parse(data)) };
    const frame = { contentWindow: child };
    let file = null;
    let loaded = 0;
    const link = m.connectDrawio(frame, { onInit: () => file, onLoaded: () => loaded++, onSave() {}, onAutosave() {}, onExit() {}, title: () => 'T' });
    const post = (msg, source = child) => {
      const ev = new Event('message');
      Object.assign(ev, { data: JSON.stringify(msg), origin: ORIGIN, source });
      win.dispatchEvent(ev);
    };
    assert.equal(link.load('<early/>'), false, 'no load before init');
    post({ event: 'init' });
    assert.equal(link.ready, true);
    assert.deepEqual(sent, [], 'a spare sends nothing at init');
    file = '<mxfile/>';
    assert.equal(link.load(file), true);
    assert.equal(link.load('<again/>'), false, 'a frame gets one load only');
    assert.deepEqual(sent, [{ action: 'load', xml: '<mxfile/>', autosave: 1, title: 'T' }]);
    post({ event: 'load' }, {}); // wrong source: ignored
    assert.equal(loaded, 0);
    post({ event: 'load' });
    assert.equal(loaded, 1, 'draw.io\'s load event = editor usable');
    link.dispose();

    // A fresh frame (file known at init) still loads straight away, as before.
    const sent2 = [];
    const child2 = { postMessage: (d) => sent2.push(JSON.parse(d)) };
    const l2 = m.connectDrawio({ contentWindow: child2 }, { onInit: () => '<x/>', onSave() {}, onAutosave() {}, onExit() {} });
    const ev = new Event('message');
    Object.assign(ev, { data: JSON.stringify({ event: 'init' }), origin: ORIGIN, source: child2 });
    win.dispatchEvent(ev);
    assert.deepEqual(sent2, [{ action: 'load', xml: '<x/>', autosave: 1, title: '' }]);
    assert.equal(l2.loadSent, true);
    l2.dispose();
  } finally {
    globalThis.window = prevWindow;
  }
});

test('warm-up: Save-Data skips it; prefetch stays on /drawio/ and skips the no-store page', () => {
  assert.equal(m.warmupAllowed({ connection: { saveData: true } }), false);
  assert.equal(m.warmupAllowed({ connection: { saveData: false } }), true);
  const u = m.prefetchUrls();
  assert.ok(u.includes('/drawio/js/app.min.js'));
  assert.ok(u.every((x) => x.startsWith('/drawio/') && !x.endsWith('index.html') && !x.endsWith('/')));
});
