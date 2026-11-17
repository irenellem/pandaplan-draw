/**
 * PandaPlan Draw - backup endpoint.
 * Runs behind Cloudflare Access on draw.pandaplan.work; every request must carry a valid
 * Cf-Access-Jwt-Assertion issued for the "PandaPlan Draw" application (aud 71022ebf...).
 * Snapshots are written to R2 bucket `backup` under `draws/YYYY-MM-DD/<name>.pandadraw`.
 * No secrets in the Worker: the R2 access is a binding, the identity is the Access JWT.
 */

const TEAM = "dtc-pandaplan.cloudflareaccess.com";
const AUD = "71022ebffcea68e7d620c9affa0a3fcd05014a116cdcb7dad825716246961d2e";
const PREFIX = "draws/";
const MAX_BYTES = 8 * 1024 * 1024;

let certCache = { at: 0, keys: [] };

async function accessKeys() {
  if (Date.now() - certCache.at < 3600_000 && certCache.keys.length) return certCache.keys;
  const res = await fetch(`https://${TEAM}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new Error("cert fetch failed " + res.status);
  const body = await res.json();
  const keys = (body.keys || []).map((k) => ({ kid: k.kid, alg: k.alg, jwk: k }));
  certCache = { at: Date.now(), keys };
  return keys;
}

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function whoami(request) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return null;
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) return null;
  let head, payload;
  try {
    head = JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/")));
    payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(AUD)) return null;
  if (payload.iss !== `https://${TEAM}` && !String(payload.iss).endsWith(TEAM)) return null;
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;

  const keys = await accessKeys();
  const key = keys.find((k) => k.kid === head.kid);
  if (!key) return null;
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: key.jwk.kty, n: key.jwk.n, e: key.jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    b64u(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  // Service tokens carry no email; their common_name is the token id. Mark them so the write
  // guard can tell an automated backup reader from a person.
  if (!ok) return null;
  if (payload.email) return payload.email;
  if (payload.common_name) return `service:${String(payload.common_name).slice(0, 10)}`;
  return "authenticated";
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** Slugs only (they become R2 key parts). A display title must never pass through here. */
const safeName = (s) =>
  (s || "workspace")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "workspace";

/**
 * Optional slug parameter: missing or empty means "no folder". safeName() alone turned a missing
 * folder into "workspace", so every unfiled save landed in draws/workspace/ and was listed as folder
 * "workspace" while the app treated it as unfiled.
 */
const optSlug = (s) => (s ? safeName(s) : "");

const TITLE_MAX = 120;
/** Display title: any UTF-8, trimmed, at most 120 characters (code points, so emoji never split). */
const clampTitle = (s) => Array.from(String(s || "").trim()).slice(0, TITLE_MAX).join("").trim();

const LIST_LIMIT = 400;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    if (!path.startsWith("/api/draw")) return new Response("Not found", { status: 404 });

    // Access already gates this host (an anonymous request never reaches the Worker). Prefer the
    // signed identity, but accept a service token or an Access session cookie as proof of the edge gate.
    let user = await whoami(request);
    if (!user) {
      const svc = request.headers.get("cf-access-client-id");
      const cookie = request.headers.get("cookie") || "";
      if (svc) user = `service:${svc.slice(0, 10)}`;
      else if (/CF_Authorization=/.test(cookie)) user = "access-session";
      if (!user) return json({ ok: false, error: "unauthenticated" }, 403);
    }

    // A service token exists for the backup job: it may read, never write or delete.
    const isService = !!request.headers.get("cf-access-client-id") || String(user).startsWith("service:");
    if (isService && request.method !== "GET") {
      return json({ ok: false, error: "this token is read-only" }, 403);
    }

    if (path === "/api/draw/health") return json({ ok: true, user, bucket: "backup" });

    if (path === "/api/draw/backups" && request.method === "GET") {
      const items = [];
      let cursor;
      do {
        // R2 leaves customMetadata out of list results unless it is asked for.
        const page = await env.BACKUPS.list({ prefix: PREFIX, cursor, limit: 500, include: ["customMetadata"] });
        for (const o of page.objects || []) {
          items.push({ key: o.key, size: o.size, uploaded: o.uploaded, title: o.customMetadata?.title || "" });
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      // A key is draws/<folder>/<file>. Date folders from the first design are reported as no folder.
      const shaped = items
        .map((o) => {
          const parts = o.key.slice(PREFIX.length).split("/");
          const folder = parts.length > 1 ? parts[0] : "";
          return { ...o, folder: /^\d{4}-\d{2}-\d{2}$/.test(folder) ? "" : folder };
        })
        .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
      // Newest first, cut at LIST_LIMIT. `count` is the full total so the app can say what is missing.
      return json({
        ok: true,
        count: shaped.length,
        limit: LIST_LIMIT,
        truncated: shaped.length > LIST_LIMIT,
        items: shaped.slice(0, LIST_LIMIT),
      });
    }

    if (path === "/api/draw/backup" && request.method === "GET") {
      const key = url.searchParams.get("key");
      const name = safeName(url.searchParams.get("name"));
      const folder = optSlug(url.searchParams.get("folder"));
      let target = key;
      if (!target && name) {
        target = folder ? `${PREFIX}${folder}/${name}.pandadraw` : "";
        if (!target) {
          let best = null, cursor;
          do {
            const page = await env.BACKUPS.list({ prefix: PREFIX, cursor, limit: 500 });
            for (const o of page.objects || []) {
              const file = o.key.slice(o.key.lastIndexOf("/") + 1).replace(/\.pandadraw$/, "");
              if (file === name && (!best || new Date(o.uploaded) > new Date(best.uploaded))) best = o;
            }
            cursor = page.truncated ? page.cursor : undefined;
          } while (cursor);
          target = best ? best.key : "";
        }
      }
      if (!target || !target.startsWith(PREFIX)) return json({ ok: false, error: "not found" }, 404);
      const obj = await env.BACKUPS.get(target);
      if (!obj) return json({ ok: false, error: "not found" }, 404);
      return new Response(obj.body, {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (path === "/api/draw/backup" && (request.method === "PUT" || request.method === "POST")) {
      const name = safeName(url.searchParams.get("name"));
      const body = await request.text();
      if (!body) return json({ ok: false, error: "empty body" }, 400);
      if (body.length > MAX_BYTES) return json({ ok: false, error: "too large", limit: MAX_BYTES }, 413);
      try {
        JSON.parse(body);
      } catch {
        return json({ ok: false, error: "body is not JSON" }, 400);
      }
      const folder = optSlug(url.searchParams.get("folder"));
      const title = clampTitle(url.searchParams.get("title"));
      const day = new Date().toISOString().slice(0, 10);
      const key = folder ? `${PREFIX}${folder}/${name}.pandadraw` : `${PREFIX}${day}/${name}.pandadraw`;
      await env.BACKUPS.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { savedBy: user, source: "pandaplan-draw", ...(title ? { title } : {}) },
      });
      return json({ ok: true, key, bytes: body.length, savedBy: user });
    }

    if (path === "/api/draw/backup" && request.method === "DELETE") {
      const name = safeName(url.searchParams.get("name"));
      const key = url.searchParams.get("key");
      let targets = [];
      if (key) {
        if (!key.startsWith(PREFIX)) return json({ ok: false, error: "bad key" }, 400);
        targets = [key];
      } else if (name) {
        // folder=<slug>: that folder only. folder= (present, empty): unfiled copies only (day folders).
        // No folder param at all: that name in every folder (the original contract, kept for old clients).
        const scoped = url.searchParams.has("folder");
        const folder = optSlug(url.searchParams.get("folder"));
        let cursor;
        do {
          const page = await env.BACKUPS.list({ prefix: PREFIX, cursor, limit: 500 });
          for (const o of page.objects || []) {
            const file = o.key.slice(o.key.lastIndexOf("/") + 1);
            const parts = o.key.slice(PREFIX.length).split("/");
            const raw = parts.length > 1 ? parts[0] : "";
            const inFolder = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? "" : raw;
            if (file.replace(/\.pandadraw$|\.drawio\.json$|\.json$/, "") === name && (!scoped || inFolder === folder)) targets.push(o.key);
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
      } else {
        return json({ ok: false, error: "name or key required" }, 400);
      }
      if (!targets.length) return json({ ok: false, error: "not found", name }, 404);
      for (const k of targets) await env.BACKUPS.delete(k);
      return json({ ok: true, name, deleted: targets.length, keys: targets });
    }

    return json({ ok: false, error: "unknown route", path }, 404);
  },
};
