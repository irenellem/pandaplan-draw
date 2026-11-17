/**
 * HTTP front for test/stub.mjs, for manual use where binding a port is allowed:
 *   npx vite preview --port 4188 &  node test/stub-server.mjs 4190 http://127.0.0.1:4188
 * /api/draw and /drawio/ are answered here; everything else is proxied to vite preview
 * (or served from dist/ when no upstream is given).
 */
import http from 'node:http';
import { distStatic, handle } from './stub.mjs';

const PORT = Number(process.argv[2] || 4190);
const UPSTREAM = process.argv[3];

async function proxy(path) {
  const r = await fetch(UPSTREAM + path);
  const headers = {};
  // fetch() already decoded the body: drop the upstream encoding/length headers.
  r.headers.forEach((v, k) => {
    if (!/^(content-encoding|content-length|transfer-encoding)$/.test(k)) headers[k] = v;
  });
  return { status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) };
}

http
  .createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await handle(req.method, req.url, req.headers, chunks.length ? Buffer.concat(chunks) : undefined, UPSTREAM ? proxy : distStatic);
      res.writeHead(r.status, r.headers);
      res.end(r.body);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`stub error: ${e?.stack ?? e}`);
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`stub on http://127.0.0.1:${PORT}${UPSTREAM ? ` -> ${UPSTREAM}` : ' (dist/)'}`));
