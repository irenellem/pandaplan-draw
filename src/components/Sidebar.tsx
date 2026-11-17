import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Page } from '../types';
import { useDoc } from '../store/docStore';
import { useSession } from '../store/sessionStore';
import { ancestors, childrenOf, descendants, moveTargets, pathLabel, searchVisible, treeProblems } from '../lib/tree';

interface Row {
  page: Page;
  depth: number;
  hasKids: boolean;
  open: boolean;
}

function confirmDelete(pages: Record<string, Page>, id: string): boolean {
  const p = pages[id];
  const n = descendants(pages, id).length;
  const what = p.kind === 'folder' ? `folder "${p.title}"${n ? ` and the ${n} page${n === 1 ? '' : 's'} inside it` : ''}` : `diagram "${p.title}"`;
  return window.confirm(`Delete ${what}? This cannot be undone.`);
}

/** Docmost-style nested page tree with search, inline rename, move-to menu and full keyboard control. */
export function Sidebar() {
  const pages = useDoc((s) => s.pages);
  const activeId = useDoc((s) => s.activePageId);
  const expanded = useDoc((s) => s.prefs.expanded);
  const collapsed = useDoc((s) => s.prefs.sidebarCollapsed);
  const width = useDoc((s) => s.prefs.sidebarWidth);
  const wsName = useDoc((s) => s.workspace.name);
  const search = useSession((s) => s.search);
  const st = useDoc.getState();

  const [focusId, setFocusId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; mode: 'actions' | 'move' } | null>(null);
  const [ws, setWs] = useState(wsName);
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => setWs(wsName), [wsName]);

  // Reveal the open page: expand every folder above it (once per page switch).
  useEffect(() => {
    if (!activeId) return;
    const s = useDoc.getState();
    for (const a of ancestors(s.pages, activeId)) if (!s.prefs.expanded[a.id]) s.toggleExpanded(a.id, true);
  }, [activeId]);

  const visible = useMemo(() => searchVisible(pages, search), [pages, search]);
  const problems = useMemo(() => treeProblems(pages), [pages]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const p of childrenOf(pages, parentId)) {
        if (visible && !visible.has(p.id)) continue;
        const kids = childrenOf(pages, p.id);
        const open = visible ? true : !!expanded[p.id];
        out.push({ page: p, depth, hasKids: kids.length > 0, open });
        if (p.kind === 'folder' && open) walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [pages, expanded, visible]);

  const current = focusId && rows.some((r) => r.page.id === focusId) ? focusId : (rows.find((r) => r.page.id === activeId)?.page.id ?? rows[0]?.page.id ?? null);

  const focusRow = (id: string | null) => {
    if (!id) return;
    setFocusId(id);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus());
  };

  const open = (p: Page) => {
    if (p.kind === 'diagram') st.setActivePage(p.id);
    else st.toggleExpanded(p.id);
  };

  const create = (kind: 'diagram' | 'folder', parentId: string | null) => {
    const id = st.createPage(kind, parentId);
    useSession.setState({ search: '' });
    setFocusId(id);
    setRenaming(id);
  };

  const remove = (id: string) => {
    if (!confirmDelete(pages, id)) return;
    const idx = rows.findIndex((r) => r.page.id === id);
    st.deletePage(id);
    setMenu(null);
    focusRow(rows[idx - 1]?.page.id ?? rows[idx + 1]?.page.id ?? null);
  };

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, row: Row) => {
    if (renaming) return;
    const p = row.page;
    const i = rows.findIndex((r) => r.page.id === p.id);
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      st.shiftPage(p.id, 1);
    } else if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault();
      st.shiftPage(p.id, -1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusRow(rows[i + 1]?.page.id ?? null);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusRow(rows[i - 1]?.page.id ?? null);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusRow(rows[0]?.page.id ?? null);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusRow(rows[rows.length - 1]?.page.id ?? null);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (p.kind === 'folder' && !row.open) st.toggleExpanded(p.id, true);
      else if (p.kind === 'folder' && row.hasKids) focusRow(rows[i + 1]?.page.id ?? null);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (p.kind === 'folder' && row.open && !visible) st.toggleExpanded(p.id, false);
      else if (p.parentId) focusRow(p.parentId);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(p);
    } else if (e.key === 'F2') {
      e.preventDefault();
      setRenaming(p.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(p.id);
    } else if (mod && e.key === ']') {
      e.preventDefault();
      if (!st.indentPage(p.id)) useSession.getState().toast('Indent needs a folder directly above this page.', 'error');
      focusRow(p.id);
    } else if (mod && e.key === '[') {
      e.preventDefault();
      st.outdentPage(p.id);
      focusRow(p.id);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      setMenu({ id: p.id, mode: 'actions' });
    }
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} style={{ width }} aria-label="Pages">
      <div className="sb-head">
        <div className="mark" aria-hidden>
          P
        </div>
        <input
          className="ws-name"
          aria-label="Workspace name"
          value={ws}
          onChange={(e) => setWs(e.target.value)}
          onBlur={() => (ws.trim() ? st.renameWorkspace(ws) : setWs(wsName))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setWs(wsName);
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
        />
      </div>

      <div className="sb-actions" style={{ gridTemplateColumns: '1fr auto' }}>
        <button type="button" className="btn primary" onClick={() => create('diagram', null)}>
          <FilePlus2 size={15} /> New diagram
        </button>
        <button type="button" className="iconbtn" title="New folder" aria-label="New folder" onClick={() => create('folder', null)}>
          <FolderPlus size={15} />
        </button>
      </div>

      <div className="search-wrap">
        <Search size={14} aria-hidden />
        <input
          className="search"
          type="search"
          placeholder="Search pages"
          aria-label="Search pages"
          value={search}
          onChange={(e) => useSession.setState({ search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') useSession.setState({ search: '' });
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusRow(rows[0]?.page.id ?? null);
            }
          }}
        />
        {search && (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={() => useSession.setState({ search: '' })}>
            <X size={13} />
          </button>
        )}
      </div>

      <div className="tree" role="tree" aria-label="Pages" ref={treeRef}>
        {rows.length === 0 && <div className="tree-empty">{search ? 'No pages match.' : 'No pages yet. Create a diagram to start.'}</div>}
        {rows.map((row) => {
          const p = row.page;
          const isActive = p.id === activeId;
          const Icon = p.kind === 'folder' ? (row.open ? FolderOpen : Folder) : Workflow;
          return (
            <div key={p.id} style={{ position: 'relative' }}>
              <div
                data-row={p.id}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={p.kind === 'folder' ? row.open : undefined}
                aria-selected={isActive}
                aria-label={pathLabel(pages, p.id)}
                tabIndex={p.id === current ? 0 : -1}
                className={`row${isActive ? ' active' : ''}`}
                style={{ paddingLeft: 4 + row.depth * 14 }}
                onClick={() => {
                  setFocusId(p.id);
                  open(p);
                }}
                onDoubleClick={() => setRenaming(p.id)}
                onKeyDown={(e) => onRowKey(e, row)}
                onFocus={() => setFocusId(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ id: p.id, mode: 'actions' });
                }}
              >
                {p.kind === 'folder' ? (
                  <button
                    type="button"
                    className="chev"
                    tabIndex={-1}
                    aria-hidden
                    onClick={(e) => {
                      e.stopPropagation();
                      st.toggleExpanded(p.id);
                    }}
                  >
                    {row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                ) : (
                  <span style={{ width: 18, flex: '0 0 auto' }} />
                )}
                <Icon size={15} aria-hidden style={{ flex: '0 0 auto' }} />
                {renaming === p.id ? (
                  <RenameInput
                    initial={p.title}
                    onDone={(v) => {
                      if (v !== null) st.renamePage(p.id, v);
                      setRenaming(null);
                      focusRow(p.id);
                    }}
                  />
                ) : (
                  <span className="grow label">{p.title}</span>
                )}
                {p.kind === 'folder' && renaming !== p.id && (
                  <button
                    type="button"
                    className="rowbtn"
                    tabIndex={-1}
                    title="New diagram in this folder"
                    aria-label={`New diagram in ${p.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      create('diagram', p.id);
                    }}
                  >
                    <Plus size={13} />
                  </button>
                )}
                {renaming !== p.id && (
                  <button
                    type="button"
                    className="rowbtn"
                    tabIndex={-1}
                    title="Page actions (Shift+F10)"
                    aria-label={`Actions for ${p.title}`}
                    aria-haspopup="menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu(menu?.id === p.id ? null : { id: p.id, mode: 'actions' });
                    }}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                )}
              </div>
              {menu?.id === p.id && (
                <RowMenu
                  page={p}
                  mode={menu.mode}
                  onMode={(mode) => setMenu({ id: p.id, mode })}
                  onClose={() => {
                    setMenu(null);
                    focusRow(p.id);
                  }}
                  onRename={() => {
                    setMenu(null);
                    setRenaming(p.id);
                  }}
                  onNew={(kind) => {
                    setMenu(null);
                    create(kind, p.id);
                  }}
                  onDelete={() => remove(p.id)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="sb-foot">
        {problems.length ? (
          <span title={problems.join('\n')} style={{ color: 'var(--warn)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <AlertTriangle size={13} /> {problems.length} tree problem{problems.length === 1 ? '' : 's'}
          </span>
        ) : (
          <span>
            {Object.values(pages).filter((p) => p.kind === 'diagram').length} diagrams · saved in this browser
          </span>
        )}
      </div>
    </aside>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      className="rename"
      aria-label="Page title"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(ref.current?.value ?? '');
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(ref.current?.value ?? '')}
    />
  );
}

function RowMenu(props: {
  page: Page;
  mode: 'actions' | 'move';
  onMode: (m: 'actions' | 'move') => void;
  onClose: () => void;
  onRename: () => void;
  onNew: (kind: 'diagram' | 'folder') => void;
  onDelete: () => void;
}) {
  const { page, mode } = props;
  const pages = useDoc((s) => s.pages);
  const st = useDoc.getState();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [mode]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      if (mode === 'move') props.onMode('actions');
      else props.onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      props.onClose();
    }
  };

  const item = (label: string, Icon: typeof Pencil, run: () => void, danger = false) => (
    <button key={label} type="button" role="menuitem" className={`btn ghost sm${danger ? ' danger' : ''}`} style={{ justifyContent: 'flex-start', width: '100%' }} onClick={run}>
      <Icon size={13} /> {label}
    </button>
  );

  const targets = moveTargets(pages, page.id).filter((t) => t.id !== page.parentId);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${page.title}`}
      onKeyDown={onKey}
      style={{
        position: 'absolute',
        right: 4,
        top: 28,
        zIndex: 40,
        minWidth: 190,
        maxHeight: 280,
        overflow: 'auto',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        boxShadow: 'var(--shadow)',
        padding: 4,
        display: 'grid',
        gap: 1,
      }}
    >
      {mode === 'actions' ? (
        <>
          {item('Rename', Pencil, props.onRename)}
          {page.kind === 'folder' && item('New diagram inside', FilePlus2, () => props.onNew('diagram'))}
          {page.kind === 'folder' && item('New folder inside', FolderPlus, () => props.onNew('folder'))}
          {item('Duplicate', Copy, () => {
            const id = st.duplicatePage(page.id);
            props.onClose();
            if (id && pages[page.id].kind === 'diagram') st.setActivePage(id);
          })}
          {item('Move to…', MoveRight, () => props.onMode('move'))}
          {item('Delete', Trash2, props.onDelete, true)}
        </>
      ) : (
        <>
          <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--ink-3)' }}>Move "{page.title}" to</div>
          {page.parentId !== null &&
            item('Top level', MoveRight, () => {
              st.movePage(page.id, null);
              props.onClose();
            })}
          {targets.map((t) =>
            item(pathLabel(pages, t.id), Folder, () => {
              st.movePage(page.id, t.id);
              props.onClose();
            }),
          )}
          {targets.length === 0 && page.parentId === null && <div style={{ padding: '4px 8px', color: 'var(--ink-3)' }}>No other folders.</div>}
          <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--ink-3)' }}>Esc to go back</div>
        </>
      )}
    </div>
  );
}
