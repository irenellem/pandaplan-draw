// node --test test/offline.test.mjs
// Offline behaviour, without a browser: the routing table the service worker follows, and the queue
// that holds an edit until the connection returns.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const outfile = `${root}test/out/offline-bundle.mjs`;
mkdirSync(`${root}test/out`, { recursive: true });
await build({
  stdin: {
    contents: `
      export { routeFor } from './src/lib/swRoutes';
      export { readQueue, enqueue, clearQueue, isOfflineError, drain } from './src/lib/offlineQueue';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile,
  logLevel: 'silent',
});
const { routeFor, readQueue, enqueue, clearQueue, isOfflineError, drain } = await import(pathToFileURL(outfile).href);

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

test('the save endpoint is never cached', () => {
  assert.equal(routeFor('/api/draw/entries'), 'api');
  assert.equal(routeFor('/api/draw/backup'), 'api');
});

test('the shell, build output and editor files each get their own policy', () => {
  assert.equal(routeFor('/'), 'shell');
  assert.equal(routeFor('/index.html'), 'shell');
  assert.equal(routeFor('/f/insect-light-trap'), 'shell');
  assert.equal(routeFor('/assets/index-abc123.js'), 'assets');
  assert.equal(routeFor('/drawio/index.html'), 'editor');
  assert.equal(routeFor('/favicon.svg'), 'bypass');
  assert.equal(routeFor('/manual/haccp-plan.html'), 'bypass');
});

test('a queued save keeps only the newest edit of one file', () => {
  const s = memStore();
  assert.equal(readQueue(s).length, 0);
  enqueue({ url: '/api/draw/backup?name=plan', body: 'one', at: 't1' }, s);
  const after = enqueue({ url: '/api/draw/backup?name=plan', body: 'two', at: 't2' }, s);
  assert.equal(after.length, 1);
  assert.equal(after[0].body, 'two');
  assert.equal(readQueue(s)[0].at, 't2');
});

test('two different files wait as two entries, oldest first', () => {
  const s = memStore();
  enqueue({ url: '/api/draw/backup?name=a', body: '1', at: 't1' }, s);
  enqueue({ url: '/api/draw/backup?name=b', body: '2', at: 't2' }, s);
  assert.deepEqual(readQueue(s).map((q) => q.body), ['1', '2']);
});

test('the queue sends in order and stops at the first failure', async () => {
  const s = memStore();
  enqueue({ url: '/api/draw/backup?name=a', body: '1', at: 't1' }, s);
  enqueue({ url: '/api/draw/backup?name=b', body: '2', at: 't2' }, s);
  const sent = [];
  const first = await drain(async (q) => {
    if (q.body === '2') throw new Error('still offline');
    sent.push(q.body);
  }, s);
  assert.deepEqual(sent, ['1']);
  assert.deepEqual(first, { sent: 1, left: 1 });
  assert.equal(readQueue(s)[0].body, '2');

  const second = await drain(async (q) => void sent.push(q.body), s);
  assert.deepEqual(second, { sent: 1, left: 0 });
  assert.deepEqual(sent, ['1', '2']);
  clearQueue(s);
  assert.equal(readQueue(s).length, 0);
});

test('only a dead network counts as offline, not a refusal from the Worker', () => {
  assert.equal(isOfflineError(new Error('Could not reach the cloud storage. Check your connection; if it keeps happening, reload the page.')), true);
  assert.equal(isOfflineError(new TypeError('Failed to fetch')), true);
  assert.equal(isOfflineError(new Error('Your sign-in has expired.')), false);
  assert.equal(isOfflineError(new Error('The cloud storage refused the request (error 507).')), false);
});

test('the service worker follows the same rules, and never caches a save', () => {
  const sw = readFileSync(`${root}public/sw.js`, 'utf8');
  assert.match(sw, /req\.method !== 'GET'/);
  assert.match(sw, /isApi\(url\.pathname\)\) return;/);
  assert.ok(sw.includes("'/drawio/'") || sw.includes('isEditor'), 'editor files have their own bucket');
  assert.match(sw, /caches\.delete/);
});
