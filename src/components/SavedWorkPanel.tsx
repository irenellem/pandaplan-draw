import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Moon,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Sun,
  SunMoon,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { pretty, titleOf, type Entry, type Truncated } from '../lib/savedWork';
import type { ThemeChoice } from '../lib/theme';

export type SaveState = { state: 'idle' | 'pending' | 'saving' | 'saved' | 'queued' | 'error'; at?: string; error?: string };

interface Props {
  entries: Entry[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  save: SaveState;
  /** Folder slugs, sorted. */
  folders: string[];
  theme: ThemeChoice;
  onTheme(): void;
  onOpen(e: Entry): void;
  /** Resolves to the new file's id. `folder` "" = no folder. */
  onNew(name: string, folder?: string): Promise<string>;
  /** `text` is the new title exactly as typed. Resolves to the file's id afterwards, or null when it failed (the app reports why). */
  onRename(e: Entry, text: string): Promise<string | null>;
  /** Resolves to the copy's id, or null when it failed (the app reports why). */
  onDuplicate(e: Entry): Promise<string | null>;
  /** The Worker listed only the newest `shown` of `total` saved copies. */
  truncated: Truncated;
  onDelete(e: Entry): boolean;
  /** Resolves to the file's new id, or null when it failed. `folder` "" = no folder. */
  onMove(e: Entry, folder: string): Promise<string | null>;
  /** Returns the new folder's slug. */
  onNewFolder(name: string): string;
  onRenameFolder(folder: string, name: string): Promise<string | null>;
  onDeleteFolder(folder: string): boolean;
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

export function when(iso: string, timeOnly = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const today = timeOnly || groupOf(iso) === 'today';
  return today
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function size(b: number): string {
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

/** The save line, shared by the folder footer and the phone top bar. */
export function saveStatusText(s: SaveState): string {
  if (s.state === 'queued')
    return 'No connection - this copy is on this device and goes up by itself when the network returns.';
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

const NONE = ':none'; // "No folder" in the Move menu (a slug can never contain ':')

const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const THEME_NEXT: Record<ThemeChoice, string> = { light: 'Dark', dark: 'System (follows this device)', system: 'Light' };

/** "Move to…" menu: a native select (the phone's own picker) over a button-looking label. */
export function MoveSelect(p: {
  folders: string[];
  current: string;
  onPick(folder: string): void;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`sw-move${p.label ? ' btn sm' : ' iconbtn'}${p.className ? ` ${p.className}` : ''}${p.disabled ? ' disabled' : ''}`}
      title="Move to a folder"
      onClick={(ev) => ev.stopPropagation()}
      onDoubleClick={(ev) => ev.stopPropagation()}
    >
      <FolderInput size={14} aria-hidden />
      {p.label && <span>{p.label}</span>}
      <select
        aria-label="Move to folder"
        value=""
        disabled={p.disabled}
        onKeyDown={(ev) => ev.stopPropagation()}
        onChange={(ev) => {
          const v = ev.target.value;
          if (v) p.onPick(v === NONE ? '' : v);
        }}
      >
        <option value="" disabled>
          Move to…
        </option>
        <option value={NONE} disabled={p.current === ''}>
          No folder{p.current === '' ? ' (it is here)' : ''}
        </option>
        {p.folders.map((f) => (
          <option key={f} value={f} disabled={f === p.current}>
            {pretty(f)}
            {f === p.current ? ' (it is here)' : ''}
          </option>
        ))}
        {!p.folders.length && (
          <option value="" disabled>
            (No folders yet: press “New folder” first)
          </option>
        )}
      </select>
    </label>
  );
}

type Row =
  | { kind: 'folder'; folder: string; count: number }
  | { kind: 'hint'; folder: string }
  | { kind: 'group'; id: GroupId; label: string; count: number }
  | { kind: 'file'; entry: Entry };

/** Saved-work folder: a keyboard-driven tree of saved diagrams grouped by date. */
export function SavedWorkPanel(p: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | 'file' | 'folder'>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const searchRef = useRef<HTMLInputElement>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const newFolderBtnRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => s.toLowerCase().includes(q) || pretty(s).toLowerCase().includes(q);
    const hits = p.entries.filter((e) => !q || match(e.name) || titleOf(e).toLowerCase().includes(q));
    const out: Row[] = [];
    // Folders first, each with its own diagrams (newest first).
    for (const f of p.folders) {
      const all = p.entries.filter((e) => e.folder === f);
      const items = q && match(f) ? all : hits.filter((e) => e.folder === f);
      if (q && !items.length && !match(f)) continue;
      out.push({ kind: 'folder', folder: f, count: all.length });
      if (collapsed[`d:${f}`] && !q) continue;
      items.forEach((entry) => out.push({ kind: 'file', entry }));
      if (!all.length && !q) out.push({ kind: 'hint', folder: f });
    }
    // Then everything not in a folder, by date as before.
    const loose = hits.filter((e) => !e.folder);
    for (const g of GROUPS) {
      const items = loose.filter((e) => groupOf(e.updated) === g.id);
      if (!items.length) continue;
      out.push({ kind: 'group', id: g.id, label: g.label, count: items.length });
      if (!collapsed[g.id] || q) items.forEach((entry) => out.push({ kind: 'file', entry }));
    }
    return out;
  }, [p.entries, p.folders, query, collapsed]);

  const rowId = (r: Row) =>
    r.kind === 'group' ? `g:${r.id}` : r.kind === 'folder' ? `d:${r.folder}` : r.kind === 'hint' ? `h:${r.folder}` : `f:${r.entry.id}`;
  const foldKey = (r: Row) => (r.kind === 'group' ? r.id : r.kind === 'folder' ? `d:${r.folder}` : null);
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
  const renameFrom = useRef('');
  /** `id` is the row id: `f:<entry id>` or `d:<folder>`. `label` is what the input starts with. */
  const startRename = (id: string, label: string) => {
    renameDone.current = false;
    renameFrom.current = label;
    setDraft(label);
    setRenaming(id);
  };

  /** Files take free text: the app keeps it as the title (capitals, punctuation) and derives the slug. */
  const commitRename = async (e: Entry) => {
    if (renameDone.current) return; // Enter then blur-on-unmount must not commit twice
    renameDone.current = true;
    const text = draft;
    setRenaming(null);
    if (!text.trim() || text === renameFrom.current) return focusRow(`f:${e.id}`);
    setBusy(true);
    try {
      const id = await p.onRename(e, text);
      focusRow(`f:${id ?? e.id}`);
    } finally {
      setBusy(false);
    }
  };

  const commitFolderRename = async (folder: string) => {
    if (renameDone.current) return;
    renameDone.current = true;
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === pretty(folder)) return focusRow(`d:${folder}`);
    setBusy(true);
    try {
      const f = await p.onRenameFolder(folder, name);
      focusRow(`d:${f ?? folder}`);
    } finally {
      setBusy(false);
    }
  };

  const focusedRow = rows[rows.findIndex((r) => rowId(r) === focusId)];
  /** New diagrams go into the selected folder (or the selected diagram's folder). */
  const targetFolder =
    focusedRow?.kind === 'folder' ? focusedRow.folder : focusedRow?.kind === 'file' ? focusedRow.entry.folder : '';

  const commitNew = async () => {
    const name = draft.trim();
    const kind = creating;
    setCreating(null);
    if (!name) return (kind === 'folder' ? newFolderBtnRef : newBtnRef).current?.focus();
    if (kind === 'folder') {
      const f = p.onNewFolder(name);
      setCollapsed((c) => ({ ...c, [`d:${f}`]: false }));
      return focusRow(`d:${f}`);
    }
    setBusy(true);
    try {
      focusRow(`f:${await p.onNew(name, targetFolder)}`);
    } finally {
      setBusy(false);
    }
  };

  /** Delete, then keep keyboard focus in the tree on the neighbouring row. */
  const deleteAt = (i: number, row: Row) => {
    if (row.kind === 'file' ? !p.onDelete(row.entry) : row.kind === 'folder' ? !p.onDeleteFolder(row.folder) : true) return;
    const next = rows[i + 1] ?? rows[i - 1];
    if (next) focusRow(rowId(next));
    else searchRef.current?.focus();
  };

  /** Duplicate, then select the copy (it is not opened). */
  const duplicateEntry = async (e: Entry) => {
    setBusy(true);
    try {
      const id = await p.onDuplicate(e);
      if (id) {
        if (e.folder) setCollapsed((c) => ({ ...c, [`d:${e.folder}`]: false }));
        focusRow(`f:${id}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onTreeKey = (ev: KeyboardEvent<HTMLUListElement>) => {
    if (renaming || /^(INPUT|SELECT)$/.test((ev.target as HTMLElement).tagName)) return;
    const i = Math.max(0, current);
    const row = rows[i];
    if (!row) return;
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'd') {
      ev.preventDefault(); // the browser's "bookmark this page"
      if (row.kind === 'file' && !busy) void duplicateEntry(row.entry);
      return;
    }
    const move = (n: number) => {
      ev.preventDefault();
      // Hint rows ("Empty…") are text, not stops: step over them in the direction of travel.
      const dir = n < i ? -1 : 1;
      let j = Math.min(rows.length - 1, Math.max(0, n));
      while (rows[j]?.kind === 'hint') j += dir;
      const next = rows[j] ?? rows[i];
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
      case 'ArrowRight': {
        const k = foldKey(row);
        if (k && collapsed[k]) {
          ev.preventDefault();
          setCollapsed((c) => ({ ...c, [k]: false }));
        } else if (k) move(i + 1);
        return;
      }
      case 'ArrowLeft': {
        const k = foldKey(row);
        if (k) {
          ev.preventDefault();
          setCollapsed((c) => ({ ...c, [k]: true }));
        } else {
          for (let j = i; j >= 0; j--) if (foldKey(rows[j])) return move(j);
        }
        return;
      }
      case 'Enter':
      case ' ': {
        ev.preventDefault();
        const k = foldKey(row);
        if (k) setCollapsed((c) => ({ ...c, [k]: !c[k] }));
        else if (row.kind === 'file') p.onOpen(row.entry);
        return;
      }
      case 'F2':
        if (row.kind === 'file' || row.kind === 'folder') {
          ev.preventDefault();
          if (row.kind === 'file') startRename(rowId(row), titleOf(row.entry));
          else startRename(rowId(row), pretty(row.folder));
        }
        return;
      case 'Delete':
      case 'Backspace':
        if (row.kind === 'file' || row.kind === 'folder') {
          ev.preventDefault();
          deleteAt(i, row);
        }
        return;
    }
  };

  const status = saveStatusText(p.save);

  const focusedFile = focusedRow?.kind === 'file' ? focusedRow.entry : null;
  const focusedFolder = focusedRow?.kind === 'folder' ? focusedRow.folder : null;
  const ThemeIcon = p.theme === 'light' ? Sun : p.theme === 'dark' ? Moon : SunMoon;

  const moveTo = async (e: Entry, folder: string) => {
    setBusy(true);
    try {
      const id = await p.onMove(e, folder);
      if (folder) setCollapsed((c) => ({ ...c, [`d:${folder}`]: false }));
      focusRow(`f:${id ?? e.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="sw-panel" aria-label="Saved work">
      <header className="sw-head">
        <h1>Saved work</h1>
        <button
          type="button"
          className="btn sm sw-theme"
          onClick={p.onTheme}
          title={`Light or dark screen. Now: ${THEME_LABEL[p.theme]}. Press for ${THEME_NEXT[p.theme]}.`}
          aria-label={`Screen theme: ${THEME_LABEL[p.theme]}. Press to switch to ${THEME_NEXT[p.theme]}.`}
        >
          <ThemeIcon size={14} aria-hidden /> {THEME_LABEL[p.theme]}
        </button>
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
            setCreating('file');
          }}
        >
          <Plus size={14} /> New diagram
        </button>
        <button
          ref={newFolderBtnRef}
          type="button"
          className="btn sm"
          disabled={busy}
          onClick={() => {
            setDraft('');
            setCreating('folder');
          }}
        >
          <FolderPlus size={14} /> New folder
        </button>
        <button type="button" className="btn sm" disabled={!focusedFile || busy} onClick={() => focusedFile && p.onOpen(focusedFile)}>
          Open
        </button>
        <MoveSelect
          folders={p.folders}
          current={focusedFile?.folder ?? ''}
          disabled={!focusedFile || busy}
          onPick={(f) => focusedFile && void moveTo(focusedFile, f)}
        />
        <button
          type="button"
          className="iconbtn"
          title="Rename selected (F2)"
          aria-label="Rename selected"
          disabled={(!focusedFile && !focusedFolder) || busy}
          onClick={() => focusedRow && (focusedFile ? startRename(rowId(focusedRow), titleOf(focusedFile)) : focusedFolder && startRename(rowId(focusedRow), pretty(focusedFolder)))}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="iconbtn"
          title="Duplicate selected (Ctrl+D / ⌘D)"
          aria-label="Duplicate selected"
          disabled={!focusedFile || busy}
          onClick={() => focusedFile && void duplicateEntry(focusedFile)}
        >
          <Copy size={14} />
        </button>
        <button
          type="button"
          className="iconbtn"
          title="Delete selected (Del)"
          aria-label="Delete selected"
          disabled={(!focusedFile && !focusedFolder) || busy}
          onClick={() => focusedRow && deleteAt(current, focusedRow)}
        >
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
            aria-label={creating === 'folder' ? 'New folder name' : 'New diagram name'}
            placeholder={creating === 'folder' ? 'Folder name, then Enter' : 'Diagram name, then Enter'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                const kind = creating;
                setCreating(null);
                (kind === 'folder' ? newFolderBtnRef : newBtnRef).current?.focus();
              }
            }}
            onBlur={() => setCreating(null)}
          />
          {creating === 'file' && (
            <small className="sw-new-where">
              {targetFolder ? (
                <>
                  <FolderOpen size={12} aria-hidden /> Goes in folder {pretty(targetFolder)}
                </>
              ) : (
                'Goes in no folder (select a folder first to put it there)'
              )}
            </small>
          )}
        </form>
      )}

      {p.truncated && (
        <p className="sw-truncated" role="status">
          Showing {p.truncated.shown} of {p.truncated.total} saved copies, newest first. Older ones are not listed; search finds only listed ones.
        </p>
      )}

      {p.error && (
        <p className="sw-error" role="alert">
          Could not load your saved diagrams. {p.error}
        </p>
      )}

      <ul className="sw-tree" role="tree" aria-label="Saved diagrams" onKeyDown={onTreeKey}>
        {!rows.length && (
          <li className="sw-empty" role="none">
            {p.loading ? 'Loading saved diagrams…' : query ? 'No match.' : 'Nothing saved yet. Press “New diagram” or “New folder”.'}
          </li>
        )}
        {rows.map((r) => {
          const id = rowId(r);
          const refCb = (el: HTMLLIElement | null) => {
            if (el) rowRefs.current.set(id, el);
            else rowRefs.current.delete(id);
          };
          if (r.kind === 'hint') {
            return (
              <li key={id} role="none" className="sw-hint">
                Empty. Select a diagram and use “Move to…”, or select this folder and press “New diagram”.
              </li>
            );
          }
          if (r.kind === 'folder') {
            const open = !collapsed[id] || !!query.trim();
            if (renaming === id) {
              return (
                <li key={id} ref={refCb} role="treeitem" aria-level={1} aria-expanded={open} tabIndex={-1} className="sw-folder">
                  <Folder size={14} aria-hidden />
                  <input
                    className="sw-rename"
                    autoFocus
                    aria-label={`Rename folder ${pretty(r.folder)}`}
                    value={draft}
                    onChange={(ev) => setDraft(ev.target.value)}
                    onKeyDown={(ev) => {
                      ev.stopPropagation();
                      if (ev.key === 'Enter') void commitFolderRename(r.folder);
                      if (ev.key === 'Escape') {
                        renameDone.current = true;
                        setRenaming(null);
                        focusRow(id);
                      }
                    }}
                    onBlur={() => void commitFolderRename(r.folder)}
                  />
                </li>
              );
            }
            return (
              <li
                key={id}
                ref={refCb}
                role="treeitem"
                aria-level={1}
                aria-expanded={open}
                aria-selected={focusId === id}
                tabIndex={tabStop === id ? 0 : -1}
                className={`sw-folder${focusId === id ? ' selected' : ''}`}
                onFocus={() => setFocusId(id)}
                onClick={() => {
                  setFocusId(id);
                  setCollapsed((c) => ({ ...c, [id]: !c[id] }));
                }}
              >
                {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                {open ? <FolderOpen size={14} aria-hidden /> : <Folder size={14} aria-hidden />}
                <span className="sw-folder-name">{pretty(r.folder)}</span>
                <span className="sw-count">{r.count}</span>
              </li>
            );
          }
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
                <CalendarDays size={14} aria-hidden />
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
              className={`sw-file${active ? ' active' : ''}${focusId === id ? ' selected' : ''}`}
              onFocus={() => setFocusId(id)}
              onClick={() => {
                setFocusId(id);
                // One click opens, as in Docmost. The row still focuses, so F2 / Delete / Ctrl+D work.
                if (renaming !== id) p.onOpen(e);
              }}
              onDoubleClick={() => p.onOpen(e)}
            >
              <FileText size={14} aria-hidden />
              {renaming === id ? (
                <input
                  className="sw-rename"
                  autoFocus
                  aria-label={`Rename ${titleOf(e)}`}
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
                <>
                  <span className="sw-name">
                    <strong>{titleOf(e)}</strong>
                    <small>
                      {when(e.updated)} · {size(e.size)}
                      {e.source === 'browser' ? ' · this browser' : e.versions > 1 ? ` · ${e.versions} versions` : ''}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="iconbtn plain sw-row-move sw-row-dup"
                    title="Duplicate (Ctrl+D / ⌘D)"
                    aria-label={`Duplicate ${titleOf(e)}`}
                    disabled={busy}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void duplicateEntry(e);
                    }}
                    onDoubleClick={(ev) => ev.stopPropagation()}
                  >
                    <Copy size={13} aria-hidden />
                  </button>
                  <MoveSelect className="sw-row-move" folders={p.folders} current={e.folder} disabled={busy} onPick={(f) => void moveTo(e, f)} />
                </>
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
          <a className="btn sm" href="/manual/" target="_blank" rel="noreferrer" title="User manual (opens in a new tab)">
            <BookOpen size={14} /> Manual
          </a>
        </div>
        <p className="sw-keys">↑↓ select · Enter open · F2 rename · Ctrl/⌘+D duplicate · Del delete · ←→ fold</p>
      </footer>
    </aside>
  );
}
