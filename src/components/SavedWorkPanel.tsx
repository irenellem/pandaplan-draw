import { ChevronDown, ChevronRight, FileText, Folder, Pencil, Plus, Printer, RefreshCw, Search, Trash2, Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Entry } from '../lib/savedWork';

export type SaveState = { state: 'idle' | 'pending' | 'saving' | 'saved' | 'error'; at?: string; error?: string };

interface Props {
  entries: Entry[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  save: SaveState;
  onOpen(e: Entry): void;
  /** Resolves to the new file's id. */
  onNew(name: string): Promise<string>;
  /** Resolves to the file's id after the rename, or null when it failed (the app reports why). */
  onRename(e: Entry, name: string): Promise<string | null>;
  onDelete(e: Entry): boolean;
  onRefresh(): void;
  onPrint(): void;
  onDownload(): void;
}

type GroupId = 'today' | 'week' | 'earlier';
const GROUPS: Array<{ id: GroupId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'earlier', label: 'Earlier' },
];

function groupOf(iso: string, now = new Date()): GroupId {
  const t = new Date(iso);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t.getTime() >= startToday) return 'today';
  if (t.getTime() >= startToday - 6 * 86_400_000) return 'week';
  return 'earlier';
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const today = groupOf(iso) === 'today';
  return today
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function size(b: number): string {
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

/** The save line, shared by the folder footer and the phone top bar. */
export function saveStatusText(s: SaveState): string {
  return s.state === 'pending'
    ? 'Unsaved changes…'
    : s.state === 'saving'
      ? 'Saving to cloud…'
      : s.state === 'saved'
        ? `Saved ${s.at ? when(s.at) : ''}`
        : s.state === 'error'
          ? (s.error ?? 'Something went wrong.')
          : '';
}

/** Phones have no double-click: a tap on a file opens it there. */
const touch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

type Row = { kind: 'group'; id: GroupId; label: string; count: number } | { kind: 'file'; entry: Entry };

/** Saved-work folder: a keyboard-driven tree of saved diagrams grouped by date. */
export function SavedWorkPanel(p: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const searchRef = useRef<HTMLInputElement>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const hits = p.entries.filter((e) => !q || e.name.toLowerCase().includes(q));
    const out: Row[] = [];
    for (const g of GROUPS) {
      const items = hits.filter((e) => groupOf(e.updated) === g.id);
      if (!items.length) continue;
      out.push({ kind: 'group', id: g.id, label: g.label, count: items.length });
      if (!collapsed[g.id] || q) items.forEach((entry) => out.push({ kind: 'file', entry }));
    }
    return out;
  }, [p.entries, query, collapsed]);

  const rowId = (r: Row) => (r.kind === 'group' ? `g:${r.id}` : `f:${r.entry.id}`);
  const current = rows.findIndex((r) => rowId(r) === focusId);
  const tabStop = current >= 0 ? focusId : rows.length ? rowId(rows.find((r) => r.kind === 'file') ?? rows[0]) : null;

  const focusRow = (id: string | null) => {
    setFocusId(id);
    if (id) requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  };

  // Keep a tab stop on the open file after it changes.
  useEffect(() => {
    if (p.activeId && !focusId) setFocusId(`f:${p.activeId}`);
  }, [p.activeId, focusId]);

  const renameDone = useRef(false);
  const startRename = (e: Entry) => {
    renameDone.current = false;
    setDraft(e.name);
    setRenaming(e.id);
  };

  const commitRename = async (e: Entry) => {
    if (renameDone.current) return; // Enter then blur-on-unmount must not commit twice
    renameDone.current = true;
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === e.name) return focusRow(`f:${e.id}`);
    setBusy(true);
    try {
      const id = await p.onRename(e, name);
      focusRow(`f:${id ?? e.id}`);
    } finally {
      setBusy(false);
    }
  };

  const commitNew = async () => {
    const name = draft.trim();
    setCreating(false);
    if (!name) return newBtnRef.current?.focus();
    setBusy(true);
    try {
      focusRow(`f:${await p.onNew(name)}`);
    } finally {
      setBusy(false);
    }
  };

  /** Delete, then keep keyboard focus in the tree on the neighbouring row. */
  const deleteAt = (i: number, e: Entry) => {
    if (!p.onDelete(e)) return;
    const next = rows[i + 1] ?? rows[i - 1];
    if (next) focusRow(rowId(next));
    else searchRef.current?.focus();
  };

  const onTreeKey = (ev: KeyboardEvent<HTMLUListElement>) => {
    if (renaming || (ev.target as HTMLElement).tagName === 'INPUT') return;
    const i = Math.max(0, current);
    const row = rows[i];
    if (!row) return;
    const move = (n: number) => {
      ev.preventDefault();
      const next = rows[Math.min(rows.length - 1, Math.max(0, n))];
      if (next) focusRow(rowId(next));
    };
    switch (ev.key) {
      case 'ArrowDown':
        return move(i + 1);
      case 'ArrowUp':
        if (i === 0) {
          ev.preventDefault();
          return searchRef.current?.focus();
        }
        return move(i - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(rows.length - 1);
      case 'ArrowRight':
        if (row.kind === 'group' && collapsed[row.id]) {
          ev.preventDefault();
          setCollapsed((c) => ({ ...c, [row.id]: false }));
        } else if (row.kind === 'group') move(i + 1);
        return;
      case 'ArrowLeft':
        if (row.kind === 'group') {
          ev.preventDefault();
          setCollapsed((c) => ({ ...c, [row.id]: true }));
        } else {
          for (let j = i; j >= 0; j--) if (rows[j].kind === 'group') return move(j);
        }
        return;
      case 'Enter':
      case ' ':
        ev.preventDefault();
        if (row.kind === 'group') setCollapsed((c) => ({ ...c, [row.id]: !c[row.id] }));
        else p.onOpen(row.entry);
        return;
      case 'F2':
        if (row.kind === 'file') {
          ev.preventDefault();
          startRename(row.entry);
        }
        return;
      case 'Delete':
      case 'Backspace':
        if (row.kind === 'file') {
          ev.preventDefault();
          deleteAt(i, row.entry);
        }
        return;
    }
  };

  const status = saveStatusText(p.save);

  const focusedFile = rows[current]?.kind === 'file' ? (rows[current] as { entry: Entry }).entry : null;

  return (
    <aside className="sw-panel" aria-label="Saved work">
      <header className="sw-head">
        <h1>Saved work</h1>
        <button type="button" className="iconbtn plain" title="Refresh list" aria-label="Refresh list" onClick={p.onRefresh}>
          <RefreshCw size={14} className={p.loading ? 'spin' : undefined} />
        </button>
      </header>

      <div className="sw-search">
        <Search size={14} aria-hidden />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search saved diagrams"
          aria-label="Search saved diagrams"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || (e.key === 'Enter' && rows.length)) {
              e.preventDefault();
              const first = rows.find((r) => r.kind === 'file') ?? rows[0];
              if (first) focusRow(rowId(first));
            } else if (e.key === 'Escape') setQuery('');
          }}
        />
      </div>

      <div className="sw-actions">
        <button
          ref={newBtnRef}
          type="button"
          className="btn primary sm"
          disabled={busy}
          onClick={() => {
            setDraft('');
            setCreating(true);
          }}
        >
          <Plus size={14} /> New diagram
        </button>
        <button type="button" className="btn sm" disabled={!focusedFile || busy} onClick={() => focusedFile && p.onOpen(focusedFile)}>
          Open
        </button>
        <button type="button" className="iconbtn" title="Rename (F2)" aria-label="Rename selected" disabled={!focusedFile || busy} onClick={() => focusedFile && startRename(focusedFile)}>
          <Pencil size={14} />
        </button>
        <button type="button" className="iconbtn" title="Delete (Del)" aria-label="Delete selected" disabled={!focusedFile || busy} onClick={() => focusedFile && deleteAt(current, focusedFile)}>
          <Trash2 size={14} />
        </button>
      </div>

      {creating && (
        <form
          className="sw-new"
          onSubmit={(e) => {
            e.preventDefault();
            void commitNew();
          }}
        >
          <input
            autoFocus
            aria-label="New diagram name"
            placeholder="Diagram name, then Enter"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setCreating(false);
                newBtnRef.current?.focus();
              }
            }}
            onBlur={() => setCreating(false)}
          />
        </form>
      )}

      {p.error && (
        <p className="sw-error" role="alert">
          Could not load your saved diagrams. {p.error}
        </p>
      )}

      <ul className="sw-tree" role="tree" aria-label="Saved diagrams" onKeyDown={onTreeKey}>
        {!rows.length && (
          <li className="sw-empty" role="none">
            {p.loading ? 'Loading saved diagrams…' : query ? 'No match.' : 'Nothing saved yet. Press “New diagram”.'}
          </li>
        )}
        {rows.map((r) => {
          const id = rowId(r);
          const refCb = (el: HTMLLIElement | null) => {
            if (el) rowRefs.current.set(id, el);
            else rowRefs.current.delete(id);
          };
          if (r.kind === 'group') {
            const open = !collapsed[r.id] || !!query.trim();
            return (
              <li
                key={id}
                ref={refCb}
                role="treeitem"
                aria-level={1}
                aria-expanded={open}
                tabIndex={tabStop === id ? 0 : -1}
                className="sw-group"
                onFocus={() => setFocusId(id)}
                onClick={() => setCollapsed((c) => ({ ...c, [r.id]: !c[r.id] }))}
              >
                {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                <Folder size={14} aria-hidden />
                <span>{r.label}</span>
                <span className="sw-count">{r.count}</span>
              </li>
            );
          }
          const e = r.entry;
          const active = e.id === p.activeId;
          return (
            <li
              key={id}
              ref={refCb}
              role="treeitem"
              aria-level={2}
              aria-selected={active}
              aria-current={active ? 'true' : undefined}
              tabIndex={tabStop === id ? 0 : -1}
              className={`sw-file${active ? ' active' : ''}`}
              onFocus={() => setFocusId(id)}
              onClick={() => {
                setFocusId(id);
                if (touch() && renaming !== e.id) p.onOpen(e);
              }}
              onDoubleClick={() => p.onOpen(e)}
            >
              <FileText size={14} aria-hidden />
              {renaming === e.id ? (
                <input
                  className="sw-rename"
                  autoFocus
                  aria-label={`Rename ${e.name}`}
                  value={draft}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onKeyDown={(ev) => {
                    ev.stopPropagation();
                    if (ev.key === 'Enter') void commitRename(e);
                    if (ev.key === 'Escape') {
                      renameDone.current = true;
                      setRenaming(null);
                      focusRow(id);
                    }
                  }}
                  onBlur={() => void commitRename(e)}
                />
              ) : (
                <span className="sw-name">
                  <strong>{e.name}</strong>
                  <small>
                    {when(e.updated)} · {size(e.size)}
                    {e.source === 'browser' ? ' · this browser' : e.versions > 1 ? ` · ${e.versions} versions` : ''}
                  </small>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="sw-foot">
        <div className="sw-status" role="status" aria-live="polite">
          {status}
        </div>
        <div className="sw-actions">
          <button type="button" className="btn sm" disabled={!p.activeId} onClick={p.onPrint} title="Print / PDF (Ctrl+P)">
            <Printer size={14} /> Print / PDF
          </button>
          <button type="button" className="btn sm" disabled={!p.activeId} onClick={p.onDownload} title="Download a copy to this device (opens in draw.io)">
            <Download size={14} /> Download
          </button>
        </div>
        <p className="sw-keys">↑↓ move · Enter open · F2 rename · Del delete · ←→ fold</p>
      </footer>
    </aside>
  );
}
