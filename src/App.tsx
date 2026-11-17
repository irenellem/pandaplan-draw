import { FilePlus2, FolderOpen } from 'lucide-react';
import { useEffect } from 'react';
import { useDoc } from './store/docStore';
import { firstDiagram } from './lib/tree';
import { Canvas } from './components/Canvas';
import { Modals } from './components/Modals';
import { NotesDrawer } from './components/NotesDrawer';
import { ShapeLibrary } from './components/ShapeLibrary';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';

/** Workspace shell: sidebar | (top bar / library | canvas | notes drawer), plus toasts and modals. */
export function App() {
  const theme = useDoc((s) => s.prefs.theme);
  const drawerOpen = useDoc((s) => s.prefs.drawerOpen);
  const activeId = useDoc((s) => s.activePageId);
  const active = useDoc((s) => (s.activePageId ? s.pages[s.activePageId] : undefined));
  const hasDiagram = useDoc((s) => !!(s.activePageId && s.diagrams[s.activePageId]));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Deep link: ?d=<pageId>. Relative URL only, so it works under any base path.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('d');
    const s = useDoc.getState();
    if (want && s.diagrams[want]) s.setActivePage(want);
    else if (!s.activePageId || !s.diagrams[s.activePageId]) s.setActivePage(firstDiagram(s.pages)?.id ?? null);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeId && hasDiagram) url.searchParams.set('d', activeId);
    else url.searchParams.delete('d');
    if (url.href !== window.location.href) window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    document.title = active ? `${active.title} · PandaPlan Draw` : 'PandaPlan Draw';
  }, [activeId, hasDiagram, active]);

  const st = useDoc.getState();

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TopBar />
        <div className="body">
          {hasDiagram ? (
            <>
              <ShapeLibrary />
              <Canvas />
              {drawerOpen && <NotesDrawer />}
            </>
          ) : (
            <div className="canvas-wrap">
              <div className="empty-canvas" style={{ pointerEvents: 'auto' }}>
                <FolderOpen size={28} aria-hidden />
                <strong>{active ? `"${active.title}" is a folder` : 'No diagram open'}</strong>
                <span>Pick a diagram in the sidebar, or start a new one.</span>
                <button type="button" className="btn primary" onClick={() => st.createPage('diagram', active?.kind === 'folder' ? active.id : null)}>
                  <FilePlus2 size={15} /> New diagram
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      <Toasts />
      <Modals />
    </div>
  );
}
