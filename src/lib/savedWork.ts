import type { Diagram, Page } from '../types';
import { legacyToXml, makeFile, slugify, toXml, type DrawioFile } from './drawioFile';

/**
 * Saved-work store. Cloud files live in R2 behind the Worker at /api/draw/* (same origin, Cloudflare
 * Access in front, so no auth code here). Diagrams the old hand-rolled canvas kept in this browser's
 * localStorage are listed too, read-only until first saved, so nothing saved earlier goes missing.
 */
export type Source = 'cloud' | 'browser';

export interface Entry {
  id: string; // cloud: "<folder>/<slug>" or "<slug>" when unfiled; browser: "local:<pageId>"
  name: string; // slug
  folder: string; // folder slug, "" = no folder
  source: Source;
  key?: string; // newest R2 key for this slug
  size: number;
  updated: string; // ISO
  versions: number;
}

type Snapshot = { key: string; size: number; uploaded: string; folder?: string };

const API = '/api/draw';
const TOMBSTONES = 'pandadraw.drawio.tombstones';
const LEGACY_KEY = 'pandadraw.v1';
const FOLDERS = 'pandadraw.folders';

/** Entry id for a cloud file: names are unique across folders, the folder keeps two stray copies apart. */
export const entryId = (name: string, folder: string) => (folder ? `${folder}/${name}` : name);

/** "q4-roadmap" -> "Q4 roadmap". Storage keeps slugs; people see this. */
export function pretty(slug: string): string {
  const s = slug.replace(/-+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : slug;
}

/* ------------------------------------------------------------------------- empty folders */

/**
 * R2 has no folder objects: a folder exists once a diagram is saved in it. A folder made here stays in
 * this browser's list until then, so "New folder" shows up at once and survives a reload.
 */
export function localFolders(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDERS) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];
  } catch {
    return [];
  }
}

export function setLocalFolders(list: string[]): void {
  try {
    localStorage.setItem(FOLDERS, JSON.stringify([...new Set(list)]));
  } catch {
    /* storage full: the folder still shows until reload */
  }
}

/** "2026-11-17/my-plan.drawio.json" -> "my-plan". */
export function slugFromKey(key: string): string {
  let base = key.split('/').pop() ?? key;
  for (let i = 0; i < 3; i++) base = base.replace(/\.(drawio|pandadraw|json)$/i, '');
  return base || 'untitled';
}

/* ----------------------------------------------------------------------------- tombstones */

function readTombstones(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(TOMBSTONES) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Client-side delete: hides the entry in this browser only. Any snapshot newer than the tombstone
 * (e.g. saved again later) shows up again.
 *
 * TODO(worker): R2 has no delete route yet. Add `DELETE /api/draw/backup?key=...` to the Worker
 * (behind the same Access gate), then call it here for every key of the slug and drop the tombstone.
 */
export function tombstone(id: string): void {
  const t = readTombstones();
  t[id] = new Date().toISOString();
  try {
    localStorage.setItem(TOMBSTONES, JSON.stringify(t));
  } catch {
    /* storage full: the entry just stays visible */
  }
}

/* ------------------------------------------------------------------------------- reading */

const TIMEOUT_MS = 20_000;
export const SIGNED_OUT =
  'Your sign-in has expired. Use Download to keep a copy of anything unsaved, then reload the page to sign in again.';

/** An Access login page (or any HTML page) where the Worker's JSON or the diagram file was expected. */
const looksHtml = (t: string) => /^\s*<(!doctype html|html|head|body)\b/i.test(t);

/** fetch with a time limit and messages a staff member can act on (no "HTTP 401", no "Failed to fetch"). */
async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error('The cloud storage took too long to answer. Check your connection and try again.');
    }
    throw new Error('Could not reach the cloud storage. Check your connection; if it keeps happening, reload the page.');
  }
}

function httpError(r: Response, text: string, serverMsg?: string): Error {
  if (r.status === 401 || r.status === 403 || looksHtml(text)) return new Error(SIGNED_OUT);
  if (r.status === 413) return new Error('This diagram is too large for cloud storage. Use Download to keep a copy.');
  if (r.status >= 500) return new Error('The cloud storage is having a problem right now. Try again in a minute.');
  return new Error(serverMsg || `The cloud storage refused the request (error ${r.status}).`);
}

async function json<T>(r: Response): Promise<T> {
  const text = await r.text();
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw r.ok && !looksHtml(text) ? new Error('The cloud storage sent an unexpected answer. Reload the page and try again.') : httpError(r, text);
  }
  const o = j as { ok?: boolean; error?: string };
  if (!r.ok || o.ok === false) throw httpError(r, text, o.error);
  return j as T;
}

function legacyLocal(): { entries: Entry[]; pages: Record<string, Page>; diagrams: Record<string, Diagram> } {
  const empty = { entries: [], pages: {}, diagrams: {} };
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return empty;
    const st = JSON.parse(raw)?.state;
    const pages = (st?.pages ?? {}) as Record<string, Page>;
    const diagrams = (st?.diagrams ?? {}) as Record<string, Diagram>;
    const entries = Object.values(pages)
      .filter((p) => p && p.kind === 'diagram' && diagrams[p.id])
      .map<Entry>((p) => ({
        id: `local:${p.id}`,
        name: slugify(p.title || 'untitled'),
        folder: '',
        source: 'browser',
        size: JSON.stringify(diagrams[p.id]).length,
        updated: new Date(diagrams[p.id].updatedAt || p.updatedAt || 0).toISOString(),
        versions: 1,
      }));
    return { entries, pages, diagrams };
  } catch {
    return empty;
  }
}

/** All visible entries, newest first. Cloud errors are returned, browser entries still listed. */
export async function listEntries(): Promise<{ entries: Entry[]; error: string | null }> {
  const tomb = readTombstones();
  const alive = (e: Entry) => !tomb[e.id] || Date.parse(e.updated) > Date.parse(tomb[e.id]);
  let error: string | null = null;
  const bySlug = new Map<string, Entry>();
  try {
    const r = await call(`${API}/backups`, { headers: { accept: 'application/json' } });
    const j = await json<{ items: Snapshot[] }>(r);
    for (const s of j.items ?? []) {
      const slug = slugFromKey(s.key);
      const folder = s.folder ?? '';
      const id = entryId(slug, folder);
      const prev = bySlug.get(id);
      if (!prev || Date.parse(s.uploaded) > Date.parse(prev.updated)) {
        bySlug.set(id, { id, name: slug, folder, source: 'cloud', key: s.key, size: s.size, updated: s.uploaded, versions: (prev?.versions ?? 0) + 1 });
      } else prev.versions += 1;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not reach the backup service.';
  }
  const local = legacyLocal().entries;
  const entries = [...bySlug.values(), ...local].filter(alive).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
  return { entries, error };
}

/** Fetch an entry and return the draw.io XML (drawio payload, legacy pandadraw or raw XML). */
export async function readXml(e: Entry): Promise<string> {
  if (e.source === 'browser') {
    const { pages, diagrams } = legacyLocal();
    const pid = e.id.slice('local:'.length);
    if (!pages[pid] || !diagrams[pid]) throw new Error('This browser no longer has that diagram.');
    return legacyToXml([pages[pid]], [diagrams[pid]]);
  }
  // Filed copies by name + folder (the Worker's folder contract). Unfiled ones by their exact key:
  // `?name=` without a folder means "newest in any folder", which could pick a different copy.
  const q = e.folder ? backupQuery(e.name, e.folder) : e.key ? `key=${encodeURIComponent(e.key)}` : null;
  if (!q) throw new Error('It has not finished saving yet. Press Refresh and try again.');
  const r = await call(`${API}/backup?${q}`, { headers: { accept: 'application/json' } });
  const text = await r.text();
  if (r.status === 404) throw new Error('It is no longer in cloud storage. Press Refresh to update the list.');
  // An expired Access session answers 200 with a login page: never hand that to draw.io as a diagram
  // (it would open blank, and the next autosave would bury the real drawing under an empty one).
  if (!r.ok || looksHtml(text)) throw httpError(r, text);
  let raw: unknown = text;
  try {
    raw = JSON.parse(text);
  } catch {
    /* raw XML is accepted by toXml */
  }
  try {
    return toXml(raw);
  } catch {
    throw new Error('The saved file is damaged or is not a diagram.');
  }
}

/* ------------------------------------------------------------------------------- writing */

export interface SaveResult {
  key?: string;
  bytes: number;
  updatedAt: string;
}

/** `name=<slug>[&folder=<slug>]`. No folder param for unfiled: that is how the Worker reads it. */
function backupQuery(name: string, folder: string): string {
  return `name=${encodeURIComponent(name)}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`;
}

/**
 * Delete the cloud copy of a diagram, every saved version of it. With a folder only that folder's copy
 * goes; without one (unfiled) the Worker deletes that name in every folder.
 */
export async function deleteEntry(name: string, folder = ''): Promise<{ deleted: number }> {
  const r = await call(`${API}/backup?${backupQuery(name, folder)}`, {
    method: 'DELETE',
    headers: { accept: 'application/json' },
  });
  if (r.status === 404) return { deleted: 0 };
  const j = await json<{ deleted?: number }>(r);
  return { deleted: j.deleted ?? 0 };
}

/** PUT /api/draw/backup?name=<slug>[&folder=<slug>] with the drawio payload. `keepalive` for page-hide flushes. */
export async function saveXml(name: string, folder: string, xml: string, keepalive = false): Promise<SaveResult> {
  const file: DrawioFile = makeFile(name, xml);
  const body = JSON.stringify(file);
  const r = await call(`${API}/backup?${backupQuery(name, folder)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: keepalive && body.length < 60_000,
  });
  const j = await json<{ key?: string; bytes?: number }>(r);
  return { key: j.key, bytes: j.bytes ?? body.length, updatedAt: file.updatedAt };
}

/** First free slug: "plan", "plan-2", "plan-3"... */
export function uniqueSlug(want: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const base = slugify(want);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}
