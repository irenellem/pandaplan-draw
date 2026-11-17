import { uid } from '../lib/ids';
import { mergeEnvelope, type ImportReport } from '../lib/pandadraw';
import { childrenOf, descendants, firstDiagram, nextPosition } from '../lib/tree';
import type { Diagram, Page, PageKind, PandaDrawEnvelope, Prefs } from '../types';
import type { GetDoc, SetDoc } from './docStore';
import { history } from './history';
import { emptyDiagram } from './seed';
import { useSession } from './sessionStore';

export interface PageActions {
  setActivePage: (id: string | null) => void;
  createPage: (kind: PageKind, parentId?: string | null, title?: string) => string;
  renamePage: (id: string, title: string) => void;
  duplicatePage: (id: string) => string | null;
  deletePage: (id: string) => void;
  movePage: (id: string, parentId: string | null) => void;
  shiftPage: (id: string, dir: -1 | 1) => void;
  indentPage: (id: string) => boolean;
  outdentPage: (id: string) => boolean;
  renameWorkspace: (name: string) => void;
  importEnvelope: (env: Pick<PandaDrawEnvelope, 'workspace' | 'pages' | 'diagrams'>) => ImportReport;
  setPrefs: (p: Partial<Prefs>) => void;
  toggleExpanded: (id: string, open?: boolean) => void;
}

/** Renumber siblings 0..n so positions stay small and unique. */
function renumber(pages: Record<string, Page>, parentId: string | null): Record<string, Page> {
  const out = { ...pages };
  childrenOf(out, parentId).forEach((p, i) => {
    if (p.position !== i) out[p.id] = { ...p, position: i };
  });
  return out;
}

export function pageActions(set: SetDoc, get: GetDoc): PageActions {
  const touch = (p: Page, patch: Partial<Page>): Page => ({ ...p, ...patch, updatedAt: Date.now() });

  return {
    setActivePage(id) {
      if (id === get().activePageId) return;
      useSession.getState().clearSelection();
      set({ activePageId: id });
    },

    createPage(kind, parentId = null, title) {
      const now = Date.now();
      const pages = get().pages;
      const parent = parentId && pages[parentId]?.kind === 'folder' ? parentId : null;
      const page: Page = {
        id: uid('p'),
        parentId: parent,
        kind,
        title: title ?? (kind === 'folder' ? 'New folder' : 'Untitled diagram'),
        position: nextPosition(pages, parent),
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({
        pages: { ...s.pages, [page.id]: page },
        diagrams: kind === 'diagram' ? { ...s.diagrams, [page.id]: emptyDiagram(page.id) } : s.diagrams,
        prefs: parent ? { ...s.prefs, expanded: { ...s.prefs.expanded, [parent]: true } } : s.prefs,
      }));
      if (kind === 'diagram') get().setActivePage(page.id);
      return page.id;
    },

    renamePage(id, title) {
      const t = title.trim();
      if (!t) return;
      set((s) => (s.pages[id] ? { pages: { ...s.pages, [id]: touch(s.pages[id], { title: t }) } } : s));
    },

    duplicatePage(id) {
      const s = get();
      const src = s.pages[id];
      if (!src) return null;
      const ids = [id, ...descendants(s.pages, id)];
      const map = new Map(ids.map((old) => [old, uid('p')]));
      const pages = { ...s.pages };
      const diagrams = { ...s.diagrams };
      const now = Date.now();
      for (const old of ids) {
        const p = s.pages[old];
        const nid = map.get(old) as string;
        pages[nid] = {
          ...p,
          id: nid,
          parentId: old === id ? p.parentId : (map.get(p.parentId as string) ?? p.parentId),
          title: old === id ? `${p.title} (copy)` : p.title,
          position: old === id ? p.position + 0.5 : p.position,
          createdAt: now,
          updatedAt: now,
        };
        const d = s.diagrams[old];
        if (d) diagrams[nid] = cloneDiagram(d, nid);
      }
      set({ pages: renumber(pages, src.parentId), diagrams });
      return map.get(id) ?? null;
    },

    deletePage(id) {
      const s = get();
      if (!s.pages[id]) return;
      const doomed = new Set([id, ...descendants(s.pages, id)]);
      const pages = Object.fromEntries(Object.entries(s.pages).filter(([k]) => !doomed.has(k)));
      const diagrams = Object.fromEntries(Object.entries(s.diagrams).filter(([k]) => !doomed.has(k)));
      doomed.forEach((d) => history.drop(d));
      const active = s.activePageId && doomed.has(s.activePageId) ? (firstDiagram(pages)?.id ?? null) : s.activePageId;
      if (active !== s.activePageId) useSession.getState().clearSelection();
      set({ pages: renumber(pages, s.pages[id].parentId), diagrams, activePageId: active });
    },

    movePage(id, parentId) {
      const s = get();
      const p = s.pages[id];
      if (!p || p.parentId === parentId) return;
      if (parentId && (parentId === id || descendants(s.pages, id).includes(parentId))) return;
      if (parentId && s.pages[parentId]?.kind !== 'folder') return;
      let pages = { ...s.pages, [id]: touch(p, { parentId, position: nextPosition(s.pages, parentId) }) };
      pages = renumber(renumber(pages, p.parentId), parentId);
      set((st) => ({ pages, prefs: parentId ? { ...st.prefs, expanded: { ...st.prefs.expanded, [parentId]: true } } : st.prefs }));
    },

    shiftPage(id, dir) {
      const s = get();
      const p = s.pages[id];
      if (!p) return;
      const sibs = childrenOf(s.pages, p.parentId);
      const i = sibs.findIndex((x) => x.id === id);
      const j = i + dir;
      if (j < 0 || j >= sibs.length) return;
      const other = sibs[j];
      set({ pages: { ...s.pages, [id]: { ...p, position: other.position }, [other.id]: { ...other, position: p.position } } });
    },

    indentPage(id) {
      const s = get();
      const p = s.pages[id];
      if (!p) return false;
      const sibs = childrenOf(s.pages, p.parentId);
      const prev = sibs[sibs.findIndex((x) => x.id === id) - 1];
      if (!prev || prev.kind !== 'folder') return false;
      get().movePage(id, prev.id);
      return true;
    },

    outdentPage(id) {
      const s = get();
      const p = s.pages[id];
      if (!p || !p.parentId) return false;
      const parent = s.pages[p.parentId];
      let pages = { ...s.pages, [id]: touch(p, { parentId: parent.parentId, position: parent.position + 0.5 }) };
      pages = renumber(renumber(pages, p.parentId), parent.parentId);
      set({ pages });
      return true;
    },

    renameWorkspace(name) {
      const n = name.trim();
      if (n) set((s) => ({ workspace: { ...s.workspace, name: n } }));
    },

    importEnvelope(env) {
      const s = get();
      const { pages, diagrams, report } = mergeEnvelope(s, env);
      set((st) => ({
        pages,
        diagrams,
        prefs: { ...st.prefs, expanded: { ...st.prefs.expanded, [report.rootFolderId]: true } },
      }));
      if (report.firstDiagramId) get().setActivePage(report.firstDiagramId);
      return report;
    },

    setPrefs(p) {
      set((s) => ({ prefs: { ...s.prefs, ...p } }));
    },

    toggleExpanded(id, open) {
      set((s) => ({ prefs: { ...s.prefs, expanded: { ...s.prefs.expanded, [id]: open ?? !s.prefs.expanded[id] } } }));
    },
  };
}

function cloneDiagram(d: Diagram, id: string): Diagram {
  const nodeMap = new Map(d.nodes.map((n) => [n.id, uid('n')]));
  return {
    ...d,
    id,
    nodes: d.nodes.map((n) => ({ ...n, id: nodeMap.get(n.id) as string, style: { ...n.style } })),
    edges: d.edges.map((e) => ({
      ...e,
      id: uid('e'),
      source: nodeMap.get(e.source) ?? e.source,
      target: nodeMap.get(e.target) ?? e.target,
    })),
    updatedAt: Date.now(),
  };
}
