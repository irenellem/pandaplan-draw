import type { Diagram, Page } from '../types';
import { legacyToXml, makeFile, slugify, toXml, type DrawioFile } from './drawioFile';

/**
 * Saved-work store. Cloud files live in R2 behind the Worker at /api/draw/* (same origin, Cloudflare
 * Access in front, so no auth code here). Diagrams the old hand-rolled canvas kept in this browser's
 * localStorage are listed too, read-only until first saved, so nothing saved earlier goes missing.
 */
export type Source = 'cloud' | 'browser';

export interface Entry {
  id: string; // cloud: slug; browser: "local:<pageId>"
  name: string;
  source: Source;
  key?: string; // newest R2 key for this slug
  size: number;
  updated: string; // ISO
  versions: number;
}

type Snapshot = { key: string; size: number; uploaded: string };

const API = '/api/draw';
const TOMBSTONES = 'pandadraw.drawio.tombstones';
const LEGACY_KEY = 'pandadraw.v1';

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

async function json<T>(r: Response): Promise<T> {
  const text = await r.text();
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(r.ok ? 'Backup service did not return JSON.' : `HTTP ${r.status}`);
  }
  const o = j as { ok?: boolean; error?: string };
  if (!r.ok || o.ok === false) throw new Error(o.error || `HTTP ${r.status}`);
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
    const r = await fetch(`${API}/backups`, { headers: { accept: 'application/json' } });
    const j = await json<{ items: Snapshot[] }>(r);
    for (const s of j.items ?? []) {
      const slug = slugFromKey(s.key);
      const prev = bySlug.get(slug);
      if (!prev || Date.parse(s.uploaded) > Date.parse(prev.updated)) {
        bySlug.set(slug, { id: slug, name: slug, source: 'cloud', key: s.key, size: s.size, updated: s.uploaded, versions: (prev?.versions ?? 0) + 1 });
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
  if (!e.key) throw new Error('No stored snapshot for this file yet.');
  const r = await fetch(`${API}/backup?key=${encodeURIComponent(e.key)}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  let raw: unknown = text;
  try {
    raw = JSON.parse(text);
  } catch {
    /* raw XML is accepted by toXml */
  }
  return toXml(raw);
}

/* ------------------------------------------------------------------------------- writing */

export interface SaveResult {
  key?: string;
  bytes: number;
  updatedAt: string;
}

/** PUT /api/draw/backup?name=<slug> with the drawio payload. `keepalive` for page-hide flushes. */
export async function saveXml(name: string, xml: string, keepalive = false): Promise<SaveResult> {
  const file: DrawioFile = makeFile(name, xml);
  const body = JSON.stringify(file);
  const r = await fetch(`${API}/backup?name=${encodeURIComponent(name)}`, {
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
