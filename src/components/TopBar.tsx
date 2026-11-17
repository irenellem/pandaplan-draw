import {
  Download,
  FileJson,
  Grid3x3,
  HelpCircle,
  Image,
  Maximize,
  Moon,
  NotebookPen,
  PanelLeft,
  Redo2,
  Shapes,
  Sun,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PandaDrawEnvelope } from '../types';
import { activeDiagram, useActiveDiagram, useDoc } from '../store/docStore';
import { history } from '../store/history';
import { saveStatus } from '../store/persistStorage';
import { useSession } from '../store/sessionStore';
import { buildEnvelope, validateEnvelope } from '../lib/pandadraw';
import { diagramToSvg } from '../lib/svgExport';
import { exportPng } from '../lib/pngExport';
import { downloadDataUrl, downloadText, safeFilename } from '../lib/download';
import { ancestors } from '../lib/tree';
import { canvasApi } from './Canvas';

function timeAgo(t: number | null): string {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

function SaveChip() {
  const status = useSyncExternalStore(saveStatus.subscribe, saveStatus.get, saveStatus.get);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 15000);
    return () => window.clearInterval(t);
  }, []);
  const text =
    status.state === 'pending' ? 'Saving…' : status.state === 'error' ? 'Not saved' : status.state === 'saved' ? `Saved ${timeAgo(status.savedAt)}` : 'Saved locally';
  return (
    <span className="savechip" role="status" aria-live="polite" title={status.error ?? 'Changes are saved to this browser automatically.'}>
      <span className={`dot ${status.state === 'idle' ? 'saved' : status.state}`} />
      {text}
    </span>
  );
}

type Pending = { name: string; env: PandaDrawEnvelope };

export function TopBar() {
  const pageId = useDoc((s) => s.activePageId);
  const page = useDoc((s) => (s.activePageId ? s.pages[s.activePageId] : undefined));
  const pages = useDoc((s) => s.pages);
  const prefs = useDoc((s) => s.prefs);
  const diagram = useActiveDiagram();
  useSyncExternalStore(history.subscribe, history.version, history.version);
  const st = useDoc.getState();
  const toast = useSession((s) => s.toast);

  const [title, setTitle] = useState(page?.title ?? '');
  const [exportOpen, setExportOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => setTitle(page?.title ?? ''), [page?.id, page?.title]);

  useEffect(() => {
    if (!exportOpen) return;
    exportRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [exportOpen]);

  const crumb = page ? ancestors(pages, page.id).map((a) => a.title).join(' / ') : '';
  const base = safeFilename(page?.title ?? 'diagram');

  const exportWorkspace = () => {
    const s = useDoc.getState();
    downloadText(JSON.stringify(buildEnvelope(s), null, 2), `${safeFilename(s.workspace.name, 'workspace')}.pandadraw`, 'application/json');
    toast('Workspace exported.');
  };
  const exportDiagramFile = () => {
    const s = useDoc.getState();
    if (!s.activePageId) return;
    downloadText(JSON.stringify(buildEnvelope(s, s.activePageId), null, 2), `${base}.pandadraw`, 'application/json');
    toast('Diagram exported.');
  };
  const exportSvg = () => {
    const d = activeDiagram(useDoc.getState());
    if (!d || !d.nodes.length) return toast('Nothing to export: the diagram is empty.', 'error');
    downloadText(diagramToSvg(d.nodes, d.edges, { background: prefs.pngBackground === 'white' ? '#ffffff' : 'transparent' }), `${base}.svg`, 'image/svg+xml');
    toast('SVG exported.');
  };
  const exportPngFile = async () => {
    const d = activeDiagram(useDoc.getState());
    const layer = canvasApi.layer();
    if (!d || !layer) return;
    useSession.getState().setEditing(null);
    try {
      const url = await exportPng(layer, d.nodes, prefs.pngBackground);
      await downloadDataUrl(url, `${base}.png`);
      toast('PNG exported.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'PNG export failed.', 'error');
    }
  };

  const onFile = async (file: File) => {
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return toast(`${file.name} is not valid JSON.`, 'error');
    }
    const err = validateEnvelope(raw);
    if (err) return toast(`Cannot import ${file.name}: ${err}`, 'error');
    setPending({ name: file.name, env: raw as PandaDrawEnvelope });
  };

  const runImport = (mode: 'merge' | 'replace') => {
    if (!pending) return;
    if (mode === 'replace') {
      const s = useDoc.getState();
      Object.keys(s.pages).forEach((id) => history.drop(id));
      useSession.getState().clearSelection();
      useDoc.setState({ pages: {}, diagrams: {}, activePageId: null });
    }
    const report = st.importEnvelope(pending.env);
    setPending(null);
    useSession.setState({ importReport: report });
    useSession.getState().openModal('import-report');
  };

  const run = (fn: () => void | Promise<void>) => () => {
    setExportOpen(false);
    void fn();
  };

  const zoom = diagram?.viewport.zoom ?? 1;

  return (
    <header className="topbar">
      <button
        type="button"
        className={`iconbtn plain${prefs.sidebarCollapsed ? '' : ' on'}`}
        title="Toggle sidebar"
        aria-pressed={!prefs.sidebarCollapsed}
        onClick={() => st.setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })}
      >
        <PanelLeft size={16} />
      </button>
      <button
        type="button"
        className={`iconbtn plain${prefs.libraryCollapsed ? '' : ' on'}`}
        title="Toggle shape library"
        aria-pressed={!prefs.libraryCollapsed}
        disabled={!diagram}
        onClick={() => st.setPrefs({ libraryCollapsed: !prefs.libraryCollapsed })}
      >
        <Shapes size={16} />
      </button>

      <div className="title-wrap">
        {crumb && <span className="crumb">{crumb}</span>}
        {page ? (
          <input
            className="title-input"
            aria-label="Page title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => (title.trim() ? st.renamePage(page.id, title) : setTitle(page.title))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setTitle(page.title);
                requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
              }
            }}
          />
        ) : (
          <strong style={{ padding: '1px 4px' }}>PandaPlan Draw</strong>
        )}
      </div>

      <SaveChip />
      <span className="sep" />

      <button type="button" className="iconbtn plain" title="Undo (⌘/Ctrl+Z)" aria-label="Undo" disabled={!history.canUndo(pageId)} onClick={() => st.undo()}>
        <Undo2 size={16} />
      </button>
      <button type="button" className="iconbtn plain" title="Redo (⌘/Ctrl+Shift+Z)" aria-label="Redo" disabled={!history.canRedo(pageId)} onClick={() => st.redo()}>
        <Redo2 size={16} />
      </button>
      <span className="sep" />

      <button type="button" className="iconbtn plain" title="Zoom out (−)" aria-label="Zoom out" disabled={!diagram} onClick={() => canvasApi.zoomBy(1 / 1.2)}>
        <ZoomOut size={16} />
      </button>
      <button type="button" className="btn ghost sm zoomval" title="Reset to 100% (0)" aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to 100%`} disabled={!diagram} onClick={() => canvasApi.zoomTo(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className="iconbtn plain" title="Zoom in (+)" aria-label="Zoom in" disabled={!diagram} onClick={() => canvasApi.zoomBy(1.2)}>
        <ZoomIn size={16} />
      </button>
      <button type="button" className="iconbtn plain" title="Fit to content (1)" aria-label="Fit to content" disabled={!diagram} onClick={() => canvasApi.fit()}>
        <Maximize size={16} />
      </button>
      <button
        type="button"
        className={`iconbtn plain${prefs.snapToGrid ? ' on' : ''}`}
        title="Snap to grid (hold Alt while dragging to bypass)"
        aria-pressed={prefs.snapToGrid}
        onClick={() => st.setPrefs({ snapToGrid: !prefs.snapToGrid })}
      >
        <Grid3x3 size={16} />
      </button>
      <span className="sep" />

      <div style={{ position: 'relative' }} ref={exportRef}>
        <button type="button" className="btn sm" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}>
          <Download size={14} /> Export
        </button>
        {exportOpen && (
          <div
            role="menu"
            aria-label="Export"
            className="modal"
            style={{ position: 'absolute', right: 0, top: 34, width: 250, zIndex: 50, padding: 4, display: 'grid', gap: 1 }}
            onKeyDown={(e) => {
              const items = Array.from(exportRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
              const i = items.indexOf(document.activeElement as HTMLElement);
              if (e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault();
                setExportOpen(false);
                exportRef.current?.querySelector<HTMLElement>('button')?.focus();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                items[(i + 1) % items.length]?.focus();
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                items[(i - 1 + items.length) % items.length]?.focus();
              }
            }}
          >
            {(
              [
                ['This diagram (.pandadraw)', FileJson, exportDiagramFile, !page],
                ['Whole workspace (.pandadraw)', FileJson, exportWorkspace, false],
                ['SVG image', Image, exportSvg, !diagram],
                ['PNG image (2×)', Image, exportPngFile, !diagram],
              ] as const
            ).map(([label, Icon, fn, disabled]) => (
              <button key={label} type="button" role="menuitem" className="btn ghost sm" style={{ justifyContent: 'flex-start' }} disabled={disabled} onClick={run(fn)}>
                <Icon size={14} /> {label}
              </button>
            ))}
            <label className="btn ghost sm" style={{ justifyContent: 'flex-start', gap: 6 }}>
              <input
                type="checkbox"
                checked={prefs.pngBackground === 'white'}
                onChange={(e) => st.setPrefs({ pngBackground: e.target.checked ? 'white' : 'transparent' })}
              />
              White background for images
            </label>
          </div>
        )}
      </div>
      <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
        <Upload size={14} /> Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".pandadraw,application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onFile(f);
        }}
      />
      <span className="sep" />

      <button
        type="button"
        className={`iconbtn plain${prefs.drawerOpen ? ' on' : ''}`}
        title="Notes drawer"
        aria-pressed={prefs.drawerOpen}
        disabled={!diagram}
        onClick={() => st.setPrefs({ drawerOpen: !prefs.drawerOpen })}
      >
        <NotebookPen size={16} />
      </button>
      <button
        type="button"
        className="iconbtn plain"
        title={prefs.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label="Toggle theme"
        onClick={() => st.setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}
      >
        {prefs.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button type="button" className="iconbtn plain" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => useSession.getState().openModal('shortcuts')}>
        <HelpCircle size={16} />
      </button>

      {pending && (
        <div className="scrim" onClick={() => setPending(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setPending(null)}
          >
            <header>
              <strong id="import-title">Import {pending.name}</strong>
            </header>
            <div className="body-pad" style={{ display: 'grid', gap: 12 }}>
              <span style={{ color: 'var(--ink-2)' }}>
                {pending.env.pages.length} page{pending.env.pages.length === 1 ? '' : 's'}, {pending.env.diagrams.length} diagram
                {pending.env.diagrams.length === 1 ? '' : 's'}.
              </span>
              <span>
                <b>Merge</b> adds everything under a new "Imported" folder and keeps your pages. <b>Replace</b> removes every current page first.
              </span>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => setPending(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => window.confirm('Replace deletes every current page in this browser. Continue?') && runImport('replace')}
                >
                  Replace
                </button>
                <button type="button" className="btn primary" autoFocus onClick={() => runImport('merge')}>
                  Merge
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
