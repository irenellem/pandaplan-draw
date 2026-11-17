import type { DEdge, Diagram, DNode, EdgeStyle, NodeStyle, ShapeKind, Side, Viewport } from '../types';
import { uid } from '../lib/ids';
import { createNode } from '../lib/shapeCatalog';
import { history } from './history';
import type { GetDoc, SetDoc } from './docStore';
import { useSession } from './sessionStore';

export interface DiagramActions {
  /** x/y are the world-space centre for the new shape. */
  addNode: (kind: ShapeKind, x: number, y: number) => string | null;
  /** Push the current diagram onto the undo stack before a compound edit (drag, resize). */
  snapshot: () => void;
  patchNodes: (ids: string[], patch: Partial<Omit<DNode, 'id'>>, record?: boolean) => void;
  patchStyle: (ids: string[], patch: Partial<NodeStyle>, record?: boolean) => void;
  removeNodes: (ids: string[]) => void;
  addEdge: (source: string, sourceSide: Side, target: string, targetSide: Side) => string | null;
  patchEdges: (ids: string[], patch: Partial<Omit<DEdge, 'id'>>, record?: boolean) => void;
  removeEdges: (ids: string[]) => void;
  setDiagramNote: (note: string) => void;
  setNodeNote: (id: string, note: string) => void;
  setViewport: (vp: Viewport) => void;
  setDefaultEdgeStyle: (style: EdgeStyle) => void;
  copySelection: () => number;
  pasteClipboard: () => void;
  duplicateSelection: () => void;
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  align: (mode: 'left' | 'centerH' | 'right' | 'top' | 'middleV' | 'bottom') => void;
  nudge: (ids: string[], dx: number, dy: number) => void;
  undo: () => void;
  redo: () => void;
  clearDiagram: () => void;
}

function clampSize(v: number): number {
  return Math.max(20, Math.round(v));
}

export function diagramActions(set: SetDoc, get: GetDoc): DiagramActions {
  const current = (): Diagram | null => {
    const s = get();
    return s.activePageId ? (s.diagrams[s.activePageId] ?? null) : null;
  };

  /** Apply a change to the active diagram, optionally recording an undo snapshot first. */
  const mutate = (fn: (d: Diagram) => Diagram, record = true) => {
    const s = get();
    const id = s.activePageId;
    const d = id ? s.diagrams[id] : null;
    if (!d || !id) return;
    if (record) history.push(id, { nodes: d.nodes, edges: d.edges });
    const next = { ...fn(d), updatedAt: Date.now() };
    set({ diagrams: { ...s.diagrams, [id]: next } });
  };

  const maxZ = (d: Diagram) => d.nodes.reduce((m, n) => Math.max(m, n.z), 0);

  return {
    addNode(kind, x, y) {
      const d = current();
      if (!d) return null;
      const node = createNode(kind, x, y, maxZ(d) + 1);
      mutate((cur) => ({ ...cur, nodes: [...cur.nodes, node] }));
      useSession.getState().select([node.id]);
      return node.id;
    },

    snapshot() {
      const d = current();
      if (d && get().activePageId) history.push(get().activePageId as string, { nodes: d.nodes, edges: d.edges });
    },

    patchNodes(ids, patch, record = true) {
      const set_ = new Set(ids);
      mutate(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) => {
            if (!set_.has(n.id)) return n;
            const next: DNode = { ...n, ...patch };
            if (patch.w !== undefined) next.w = clampSize(patch.w);
            if (patch.h !== undefined) next.h = clampSize(patch.h);
            return next;
          }),
        }),
        record,
      );
    },

    patchStyle(ids, patch, record = true) {
      const set_ = new Set(ids);
      mutate(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) => (set_.has(n.id) ? { ...n, style: { ...n.style, ...patch } } : n)),
        }),
        record,
      );
    },

    removeNodes(ids) {
      const doomed = new Set(ids);
      mutate((d) => ({
        ...d,
        nodes: d.nodes.filter((n) => !doomed.has(n.id)),
        edges: d.edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)),
      }));
      useSession.getState().clearSelection();
    },

    addEdge(source, sourceSide, target, targetSide) {
      const d = current();
      if (!d || source === target) return null;
      if (d.edges.some((e) => e.source === source && e.target === target)) {
        useSession.getState().toast('Those two shapes are already connected.', 'error');
        return null;
      }
      const edge: DEdge = {
        id: uid('e'),
        source,
        sourceSide,
        target,
        targetSide,
        style: d.defaultEdgeStyle,
        label: '',
        stroke: '#64748b',
        strokeWidth: 1.5,
      };
      mutate((cur) => ({ ...cur, edges: [...cur.edges, edge] }));
      useSession.getState().select([], [edge.id]);
      return edge.id;
    },

    patchEdges(ids, patch, record = true) {
      const set_ = new Set(ids);
      mutate((d) => ({ ...d, edges: d.edges.map((e) => (set_.has(e.id) ? { ...e, ...patch } : e)) }), record);
    },

    removeEdges(ids) {
      const doomed = new Set(ids);
      mutate((d) => ({ ...d, edges: d.edges.filter((e) => !doomed.has(e.id)) }));
      useSession.getState().clearSelection();
    },

    setDiagramNote(note) {
      mutate((d) => ({ ...d, note }), false);
    },

    setNodeNote(id, note) {
      mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, note } : n)) }), false);
    },

    setViewport(vp) {
      const s = get();
      const id = s.activePageId;
      const d = id ? s.diagrams[id] : null;
      if (!d || !id) return;
      set({ diagrams: { ...s.diagrams, [id]: { ...d, viewport: vp } } });
    },

    setDefaultEdgeStyle(style) {
      mutate((d) => ({ ...d, defaultEdgeStyle: style }), false);
    },

    copySelection() {
      const d = current();
      const { selectedNodes, selectedEdges } = useSession.getState();
      if (!d) return 0;
      const nodes = d.nodes.filter((n) => selectedNodes.includes(n.id));
      const ids = new Set(nodes.map((n) => n.id));
      const edges = d.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
      if (!nodes.length) return 0;
      useSession.setState({ clipboard: { nodes, edges } });
      const extra = selectedEdges.filter((id) => !edges.some((e) => e.id === id)).length;
      return nodes.length + edges.length + extra;
    },

    pasteClipboard() {
      const d = current();
      const clip = useSession.getState().clipboard;
      if (!d || !clip || !clip.nodes.length) return;
      const map = new Map<string, string>();
      const topZ = maxZ(d);
      const nodes = clip.nodes.map((n, i) => {
        const id = uid('n');
        map.set(n.id, id);
        return { ...n, id, x: n.x + 24, y: n.y + 24, z: topZ + 1 + i, style: { ...n.style } };
      });
      const edges = clip.edges.map((e) => ({
        ...e,
        id: uid('e'),
        source: map.get(e.source) ?? e.source,
        target: map.get(e.target) ?? e.target,
      }));
      mutate((cur) => ({ ...cur, nodes: [...cur.nodes, ...nodes], edges: [...cur.edges, ...edges] }));
      useSession.getState().select(nodes.map((n) => n.id));
      useSession.getState().toast(`Pasted ${nodes.length} shape${nodes.length === 1 ? '' : 's'}.`);
    },

    duplicateSelection() {
      if (this.copySelection()) this.pasteClipboard();
    },

    bringToFront(ids) {
      const d = current();
      if (!d) return;
      let z = maxZ(d);
      const set_ = new Set(ids);
      mutate((cur) => ({ ...cur, nodes: cur.nodes.map((n) => (set_.has(n.id) ? { ...n, z: ++z } : n)) }));
    },

    sendToBack(ids) {
      const d = current();
      if (!d) return;
      const min = d.nodes.reduce((m, n) => Math.min(m, n.z), 0);
      let z = min;
      const set_ = new Set(ids);
      mutate((cur) => ({ ...cur, nodes: cur.nodes.map((n) => (set_.has(n.id) ? { ...n, z: --z } : n)) }));
    },

    align(mode) {
      const d = current();
      const ids = useSession.getState().selectedNodes;
      if (!d || ids.length < 2) return;
      const picked = d.nodes.filter((n) => ids.includes(n.id));
      const left = Math.min(...picked.map((n) => n.x));
      const right = Math.max(...picked.map((n) => n.x + n.w));
      const top = Math.min(...picked.map((n) => n.y));
      const bottom = Math.max(...picked.map((n) => n.y + n.h));
      const patch = new Map<string, { x?: number; y?: number }>();
      for (const n of picked) {
        if (mode === 'left') patch.set(n.id, { x: left });
        else if (mode === 'right') patch.set(n.id, { x: right - n.w });
        else if (mode === 'centerH') patch.set(n.id, { x: (left + right) / 2 - n.w / 2 });
        else if (mode === 'top') patch.set(n.id, { y: top });
        else if (mode === 'bottom') patch.set(n.id, { y: bottom - n.h });
        else patch.set(n.id, { y: (top + bottom) / 2 - n.h / 2 });
      }
      mutate((cur) => ({ ...cur, nodes: cur.nodes.map((n) => (patch.has(n.id) ? { ...n, ...patch.get(n.id) } : n)) }));
    },

    nudge(ids, dx, dy) {
      const set_ = new Set(ids);
      mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (set_.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }));
    },

    undo() {
      const s = get();
      const id = s.activePageId;
      const d = id ? s.diagrams[id] : null;
      if (!d || !id) return;
      const snap = history.undo(id, { nodes: d.nodes, edges: d.edges });
      if (!snap) return;
      set({ diagrams: { ...s.diagrams, [id]: { ...d, nodes: snap.nodes, edges: snap.edges, updatedAt: Date.now() } } });
      useSession.getState().clearSelection();
    },

    redo() {
      const s = get();
      const id = s.activePageId;
      const d = id ? s.diagrams[id] : null;
      if (!d || !id) return;
      const snap = history.redo(id, { nodes: d.nodes, edges: d.edges });
      if (!snap) return;
      set({ diagrams: { ...s.diagrams, [id]: { ...d, nodes: snap.nodes, edges: snap.edges, updatedAt: Date.now() } } });
      useSession.getState().clearSelection();
    },

    clearDiagram() {
      mutate((d) => ({ ...d, nodes: [], edges: [] }));
      useSession.getState().clearSelection();
    },
  };
}
