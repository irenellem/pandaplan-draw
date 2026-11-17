/* PandaPlan Draw service worker.
 * Rules mirror src/lib/swRoutes.ts; test/offline.test.mjs pins both.
 * The shell and the editor's own files are kept so a dropped connection never costs a reload.
 * Nothing under /api/draw/ is ever cached or replayed: a save is queued by the app itself
 * (src/lib/offlineQueue.ts) so the newest edit is the one that goes up.
 */
const VERSION = 'v1';
const SHELL = 'pandadraw-shell-' + VERSION;
const EDITOR = 'pandadraw-editor-' + VERSION;
const PRECACHE = ['/', '/index.html', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isApi = (p) => p.indexOf('/api/') === 0;
const isAssets = (p) => p.indexOf('/assets/') === 0;
const isEditor = (p) => p.indexOf('/drawio/') === 0;
const isShell = (p) => p === '/' || p === '/index.html' || p.indexOf('/f/') === 0;

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await net) || new Response('Offline', { status: 503 });
}

/* Cache first for the shell: the screen paints with no connection, and the newer copy lands for next time. */
async function shellFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = (await cache.match(req, { ignoreSearch: true })) || (await cache.match('/index.html'));
  const net = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put('/index.html', res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) {
    net.catch(() => null);
    return hit;
  }
  return (await net) || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // a save or a delete is never cached and never replayed from here
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url.pathname)) return; // network only
  if (isAssets(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }
  if (isEditor(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, EDITOR));
    return;
  }
  if (isShell(url.pathname)) {
    event.respondWith(shellFirst(req));
  }
});
