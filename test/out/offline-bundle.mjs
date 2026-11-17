// src/lib/swRoutes.ts
function routeFor(pathname) {
  if (pathname.startsWith("/api/")) return "api";
  if (pathname.startsWith("/assets/")) return "assets";
  if (pathname.startsWith("/drawio/")) return "editor";
  if (pathname === "/" || pathname === "/index.html" || pathname.startsWith("/f/")) return "shell";
  return "bypass";
}

// src/lib/offlineQueue.ts
var KEY = "pandadraw:offline-queue";
var memory = /* @__PURE__ */ new Map();
var fallback = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v)
};
function store() {
  const s = globalThis.localStorage;
  return s ?? fallback;
}
function readQueue(s = store()) {
  try {
    const raw = s.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((q) => q && typeof q.url === "string" && typeof q.body === "string") : [];
  } catch {
    return [];
  }
}
function enqueue(save, s = store()) {
  const list = readQueue(s).filter((q) => q.url !== save.url);
  list.push(save);
  try {
    s.setItem(KEY, JSON.stringify(list));
  } catch {
  }
  return list;
}
function clearQueue(s = store()) {
  try {
    s.setItem(KEY, "[]");
  } catch {
  }
}
function isOfflineError(e) {
  const m = e instanceof Error ? e.message : String(e);
  return /Could not reach the cloud storage|Failed to fetch|NetworkError|Load failed|The Internet connection appears to be offline/i.test(m);
}
async function drain(put, s = store()) {
  const list = readQueue(s);
  let sent = 0;
  for (const q of list) {
    try {
      await put(q);
      sent += 1;
      s.setItem(KEY, JSON.stringify(list.slice(sent)));
    } catch {
      break;
    }
  }
  return { sent, left: readQueue(s).length };
}
export {
  clearQueue,
  drain,
  enqueue,
  isOfflineError,
  readQueue,
  routeFor
};
