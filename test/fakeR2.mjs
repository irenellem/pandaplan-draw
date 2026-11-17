/**
 * In-memory stand-in for an R2 bucket binding, enough for worker/pandaplan-draw-api.mjs.
 * Mirrors the documented R2 behaviour that matters here: `list()` returns `customMetadata` only when
 * the caller passes `include: ['customMetadata']`, and pages are `limit` long with a cursor.
 */
export function fakeR2() {
  const objects = new Map(); // key -> { body, size, uploaded, customMetadata }
  let clock = Date.now();
  return {
    objects,
    async put(key, body, opts = {}) {
      const text = typeof body === 'string' ? body : await new Response(body).text();
      // Strictly increasing timestamps so "newest" is deterministic in fast tests.
      clock = Math.max(clock + 1, Date.now());
      objects.set(key, { body: text, size: Buffer.byteLength(text), uploaded: new Date(clock), customMetadata: { ...(opts.customMetadata || {}) } });
      return { key };
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { key, body: o.body, size: o.size, uploaded: o.uploaded, customMetadata: o.customMetadata } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async list({ prefix = '', cursor, limit = 1000, include = [] } = {}) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + limit);
      const withMeta = include.includes('customMetadata');
      return {
        objects: slice.map((k) => {
          const o = objects.get(k);
          return { key: k, size: o.size, uploaded: o.uploaded, ...(withMeta ? { customMetadata: o.customMetadata } : {}) };
        }),
        truncated: start + limit < keys.length,
        cursor: start + limit < keys.length ? String(start + limit) : undefined,
      };
    },
  };
}

/** Call the Worker the way Cloudflare would, behind Access (session cookie present). */
export function callWorker(worker, env, url, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('cookie')) headers.set('cookie', 'CF_Authorization=test-session');
  return worker.fetch(new Request(new URL(url, 'https://draw.test'), { ...init, headers }), env);
}
