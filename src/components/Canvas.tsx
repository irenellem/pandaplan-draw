import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as RKeyboardEvent,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
} from 'react';
import type { DNode, Point, Rect, ShapeKind, Side, Viewport } from '../types';
import { activeDiagram, useActiveDiagram, useDoc } from '../store/docStore';
import { useSession } from '../store/sessionStore';
import {
  GRID,
  SIDES,
  boundsOf,
  clampZoom,
  facingSide,
  fitViewport,
  intersects,
  nearestPort,
  normRect,
  portPoint,
  snap,
  toCanvas,
  zoomAt,
} from '../lib/geometry';
import { routeBetween, routeEdge } from '../lib/route';
import { isShapeKind } from '../lib/shapeCatalog';
import { NodeShape } from './NodeShape';
import { SelectionToolbar } from './SelectionToolbar';

/** Drag payload type used by the shape library. */
export const SHAPE_MIME = 'application/x-pandadraw-shape';

/** Imperative handle for the top bar and library (zoom, fit, insert, PNG layer). Filled in by the mounted canvas. */
export const canvasApi = {
  fit: () => {},
  zoomBy: (_f: number) => {},
  zoomTo: (_z: number) => {},
  insert: (_kind: ShapeKind) => {},
  layer: (): HTMLElement | null => null,
  focus: () => {},
};

type Handle = 'nw' | 'ne' | 'sw' | 'se';
const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se'];
const MIN_SIZE = 20;

type Gesture =
  | { t: 'pan'; sx: number; sy: number; vp: Viewport }
  | { t: 'drag'; start: Point; origins: Map<string, Point>; anchor: string; moved: boolean; collapseTo: string | null }
  | { t: 'resize'; id: string; handle: Handle; orig: Rect; start: Point; moved: boolean }
  | { t: 'marquee'; start: Point; base: string[]; baseEdges: string[]; moved: boolean }
  | { t: 'connect'; source: string; side: Side };

interface LinkPreview {
  from: Point;
  side: Side;
  to: Point;
  toSide: Side;
  target: string | null;
}

const center = (n: Rect): Point => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const opposite: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return !!t.closest('input, textarea, select, [contenteditable="true"]');
}

/** Keys pressed inside the sidebar, drawer or a modal belong to those panels, not the canvas. */
function isForeignScope(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest('.sidebar, .drawer, .modal, .scrim');
}

function nodeAt(nodes: DNode[], p: Point, exclude?: string, margin = 0): DNode | null {
  let best: DNode | null = null;
  for (const n of nodes) {
    if (n.id === exclude) continue;
    if (p.x >= n.x - margin && p.x <= n.x + n.w + margin && p.y >= n.y - margin && p.y <= n.y + n.h + margin) {
      if (!best || n.z >= best.z) best = n;
    }
  }
  return best;
}

export function Canvas() {
  const diagram = useActiveDiagram();
  const pageId = useDoc((s) => s.activePageId);
  const selectedNodes = useSession((s) => s.selectedNodes);
  const selectedEdges = useSession((s) => s.selectedEdges);
  const editing = useSession((s) => s.editing);

  const wrapRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const spaceHeld = useRef(false);
  const sizeRef = useRef({ w: 0, h: 0 });
  const fittedFor = useRef<string | null>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [panning, setPanning] = useState(false);
  const [spaceMode, setSpaceMode] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [link, setLink] = useState<LinkPreview | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const doc = useDoc;
  const vpNow = (): Viewport => activeDiagram(doc.getState())?.viewport ?? { x: 0, y: 0, zoom: 1 };
  const nodesNow = (): DNode[] => activeDiagram(doc.getState())?.nodes ?? [];
  const rel = (e: { clientX: number; clientY: number }): Point => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const world = (e: { clientX: number; clientY: number }) => toCanvas(vpNow(), rel(e));

  // ------------------------------------------------------------- viewport commands
  const fit = () => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    doc.getState().setViewport(fitViewport(boundsOf(nodesNow()), w, h));
  };
  const zoomTo = (z: number, at?: Point) => {
    const { w, h } = sizeRef.current;
    doc.getState().setViewport(zoomAt(vpNow(), clampZoom(z), at ?? { x: w / 2, y: h / 2 }));
  };
  const insertAtCenter = (kind: ShapeKind) => {
    const { w, h } = sizeRef.current;
    const c = toCanvas(vpNow(), { x: w / 2, y: h / 2 });
    const snapNow = doc.getState().prefs.snapToGrid;
    // Offset repeated inserts so they do not stack exactly on top of each other.
    const taken = nodesNow().filter((n) => Math.abs(center(n).x - c.x) < 8 && Math.abs(center(n).y - c.y) < 8).length;
    doc.getState().addNode(kind, snap(c.x + taken * GRID * 2, snapNow), snap(c.y + taken * GRID * 2, snapNow));
  };
  const ensureVisible = (n: Rect) => {
    const vp = vpNow();
    const { w, h } = sizeRef.current;
    const sx = n.x * vp.zoom + vp.x;
    const sy = n.y * vp.zoom + vp.y;
    const pad = 40;
    let { x, y } = vp;
    if (sx < pad) x += pad - sx;
    else if (sx + n.w * vp.zoom > w - pad) x -= sx + n.w * vp.zoom - (w - pad);
    if (sy < pad) y += pad - sy;
    else if (sy + n.h * vp.zoom > h - pad) y -= sy + n.h * vp.zoom - (h - pad);
    if (x !== vp.x || y !== vp.y) doc.getState().setViewport({ ...vp, x, y });
  };

  canvasApi.fit = fit;
  canvasApi.zoomBy = (f) => zoomTo(vpNow().zoom * f);
  canvasApi.zoomTo = (z) => zoomTo(z);
  canvasApi.insert = insertAtCenter;
  canvasApi.layer = () => layerRef.current;
  canvasApi.focus = () => wrapRef.current?.focus();

  // ------------------------------------------------------------- size + fit on load
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const next = { w: el.clientWidth, h: el.clientHeight };
      sizeRef.current = next;
      setSize(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!pageId || !size.w || !size.h || fittedFor.current === pageId) return;
    fittedFor.current = pageId;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, size.w, size.h]);

  // ------------------------------------------------------------- wheel: pan, ctrl/⌘/pinch zoom at cursor
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      const vp = vpNow();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        doc.getState().setViewport(zoomAt(vp, vp.zoom * factor, rel(e)));
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        doc.getState().setViewport({ ...vp, x: vp.x - dx * k, y: vp.y - dy * k });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || isForeignScope(e.target)) return;
      if (useSession.getState().modal) return;
      const st = doc.getState();
      const d = activeDiagram(st);
      if (!d) return;
      const ses = useSession.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      const onButton = e.target instanceof HTMLElement && !!e.target.closest('button, a, [role="button"]');

      if (key === ' ' && !onButton) {
        if (!spaceHeld.current) {
          spaceHeld.current = true;
          setSpaceMode(true);
        }
        e.preventDefault();
        return;
      }
      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && key.toLowerCase() === 'd') {
        e.preventDefault();
        st.duplicateSelection();
        return;
      }
      if (mod && key.toLowerCase() === 'a') {
        e.preventDefault();
        ses.select(d.nodes.map((n) => n.id), d.edges.map((x) => x.id));
        return;
      }
      if (mod && key.toLowerCase() === 'c') {
        if (st.copySelection()) e.preventDefault();
        return;
      }
      if (mod && key.toLowerCase() === 'x') {
        if (st.copySelection()) {
          e.preventDefault();
          st.removeNodes(ses.selectedNodes);
        }
        return;
      }
      if (mod && key.toLowerCase() === 'v') {
        if (ses.clipboard) {
          e.preventDefault();
          st.pasteClipboard();
        }
        return;
      }
      if (mod) return;

      if (key === 'Escape') {
        if (gesture.current?.t === 'connect' || gesture.current?.t === 'marquee') {
          gesture.current = null;
          setLink(null);
          setMarquee(null);
        }
        ses.clearSelection();
        return;
      }
      if (key === 'Delete' || key === 'Backspace') {
        if (!ses.selectedNodes.length && !ses.selectedEdges.length) return;
        e.preventDefault();
        const nodeSet = new Set(ses.selectedNodes);
        const looseEdges = ses.selectedEdges.filter((id) => {
          const x = d.edges.find((ed) => ed.id === id);
          return x && !nodeSet.has(x.source) && !nodeSet.has(x.target);
        });
        if (looseEdges.length) st.removeEdges(looseEdges);
        if (ses.selectedNodes.length) st.removeNodes(ses.selectedNodes);
        return;
      }
      if (key.startsWith('Arrow')) {
        e.preventDefault();
        const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
        const dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
        const ids = ses.selectedNodes;
        if (!ids.length) {
          const vp = vpNow();
          const step = e.shiftKey ? 200 : 50;
          st.setViewport({ ...vp, x: vp.x - dx * step, y: vp.y - dy * step });
          return;
        }
        const step = e.shiftKey ? GRID : 1;
        if (e.altKey) {
          // Alt+Arrow resizes the selection from its bottom-right corner.
          st.snapshot();
          for (const n of d.nodes.filter((x) => ids.includes(x.id))) {
            st.patchNodes([n.id], { w: Math.max(MIN_SIZE, n.w + dx * step), h: Math.max(MIN_SIZE, n.h + dy * step) }, false);
          }
          return;
        }
        st.nudge(ids, dx * step, dy * step);
        return;
      }
      if ((key === 'Enter' || key === 'F2') && !onButton) {
        if (ses.selectedNodes.length === 1) {
          e.preventDefault();
          ses.setEditing({ type: 'node', id: ses.selectedNodes[0] });
        } else if (ses.selectedEdges.length === 1 && !ses.selectedNodes.length) {
          e.preventDefault();
          ses.setEditing({ type: 'edge', id: ses.selectedEdges[0] });
        }
        return;
      }
      const cycle = key === ']' || key === '[' || (key === 'Tab' && ses.selectedNodes.length > 0 && document.activeElement === wrapRef.current);
      if (cycle && d.nodes.length) {
        e.preventDefault();
        const order = [...d.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
        const back = key === '[' || (key === 'Tab' && e.shiftKey);
        const cur = order.findIndex((n) => n.id === ses.selectedNodes[ses.selectedNodes.length - 1]);
        const next = cur < 0 ? (back ? order.length - 1 : 0) : (cur + (back ? -1 : 1) + order.length) % order.length;
        ses.select([order[next].id]);
        ensureVisible(order[next]);
        return;
      }
      if (key.toLowerCase() === 'c' && ses.selectedNodes.length === 2) {
        const [a, b] = ses.selectedNodes.map((id) => d.nodes.find((n) => n.id === id));
        if (a && b) st.addEdge(a.id, facingSide(a, center(b)), b.id, facingSide(b, center(a)));
        return;
      }
      if (key === '+' || key === '=') return canvasApi.zoomBy(1.2);
      if (key === '-' || key === '_') return canvasApi.zoomBy(1 / 1.2);
      if (key === '0') return zoomTo(1);
      if (key === '1' || key === '!') return fit();
      if (key === '?') ses.openModal('shortcuts');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceHeld.current = false;
        setSpaceMode(false);
      }
    };
    const onBlur = () => {
      spaceHeld.current = false;
      setSpaceMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------- pointer gestures
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (editing && e.target instanceof HTMLElement && e.target.closest('.node-edit, .edge-edit, .seltools')) return;
    if (e.target instanceof HTMLElement && e.target.closest('.seltools')) return;
    const d = activeDiagram(doc.getState());
    if (!d) return;
    wrapRef.current?.focus({ preventScroll: true });
    const ses = useSession.getState();
    const el = e.target as Element;

    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      e.preventDefault();
      gesture.current = { t: 'pan', sx: e.clientX, sy: e.clientY, vp: vpNow() };
      setPanning(true);
      wrapRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (ses.editing) ses.setEditing(null);
    const p = world(e);

    const port = el.closest('[data-port]');
    if (port) {
      const source = port.getAttribute('data-node-id') as string;
      const side = port.getAttribute('data-port') as Side;
      const src = d.nodes.find((n) => n.id === source);
      if (!src) return;
      gesture.current = { t: 'connect', source, side };
      setLink({ from: portPoint(src, side), side, to: p, toSide: opposite[side], target: null });
      wrapRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const handle = el.closest('[data-handle]');
    if (handle) {
      const id = handle.getAttribute('data-node-id') as string;
      const n = d.nodes.find((x) => x.id === id);
      if (!n) return;
      gesture.current = { t: 'resize', id, handle: handle.getAttribute('data-handle') as Handle, orig: { x: n.x, y: n.y, w: n.w, h: n.h }, start: p, moved: false };
      wrapRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const nodeEl = el.closest('[data-node]');
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-node') as string;
      let sel = ses.selectedNodes;
      let collapseTo: string | null = null;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
        ses.select(sel, ses.selectedEdges);
        if (!sel.includes(id)) return;
      } else if (!sel.includes(id)) {
        sel = [id];
        ses.select(sel);
      } else if (sel.length > 1) {
        collapseTo = id;
      }
      const origins = new Map<string, Point>();
      for (const n of d.nodes) if (sel.includes(n.id)) origins.set(n.id, { x: n.x, y: n.y });
      gesture.current = { t: 'drag', start: p, origins, anchor: id, moved: false, collapseTo };
      wrapRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const edgeEl = el.closest('[data-edge]');
    if (edgeEl) {
      const id = edgeEl.getAttribute('data-edge') as string;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const es = ses.selectedEdges.includes(id) ? ses.selectedEdges.filter((x) => x !== id) : [...ses.selectedEdges, id];
        ses.select(ses.selectedNodes, es);
      } else ses.select([], [id]);
      return;
    }

    // Empty canvas → box select.
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) ses.clearSelection();
    gesture.current = {
      t: 'marquee',
      start: p,
      base: additive ? ses.selectedNodes : [],
      baseEdges: additive ? ses.selectedEdges : [],
      moved: false,
    };
    wrapRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) {
      if (e.pointerType === 'mouse') {
        const nodeEl = (e.target as Element).closest('[data-node], [data-node-id]');
        const id = nodeEl ? nodeEl.getAttribute('data-node') ?? nodeEl.getAttribute('data-node-id') : null;
        if (id !== hoverId) setHoverId(id);
      }
      return;
    }
    const st = doc.getState();
    const d = activeDiagram(st);
    if (!d) return;
    const vp = vpNow();

    if (g.t === 'pan') {
      st.setViewport({ ...g.vp, x: g.vp.x + e.clientX - g.sx, y: g.vp.y + e.clientY - g.sy });
      return;
    }
    const p = world(e);
    const snapping = st.prefs.snapToGrid && !e.altKey;

    if (g.t === 'drag') {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved) {
        if (Math.hypot(dx * vp.zoom, dy * vp.zoom) < 3) return;
        st.snapshot();
        g.moved = true;
      }
      const a = g.origins.get(g.anchor);
      if (!a) return;
      const ddx = snap(a.x + dx, snapping) - a.x;
      const ddy = snap(a.y + dy, snapping) - a.y;
      for (const [id, o] of g.origins) st.patchNodes([id], { x: o.x + ddx, y: o.y + ddy }, false);
      return;
    }

    if (g.t === 'resize') {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved) {
        if (Math.hypot(dx * vp.zoom, dy * vp.zoom) < 2) return;
        st.snapshot();
        g.moved = true;
      }
      const o = g.orig;
      let left = o.x;
      let top = o.y;
      let right = o.x + o.w;
      let bottom = o.y + o.h;
      if (g.handle.includes('w')) left = Math.min(snap(o.x + dx, snapping), right - MIN_SIZE);
      if (g.handle.includes('e')) right = Math.max(snap(right + dx, snapping), left + MIN_SIZE);
      if (g.handle.includes('n')) top = Math.min(snap(o.y + dy, snapping), bottom - MIN_SIZE);
      if (g.handle.includes('s')) bottom = Math.max(snap(bottom + dy, snapping), top + MIN_SIZE);
      st.patchNodes([g.id], { x: left, y: top, w: right - left, h: bottom - top }, false);
      return;
    }

    if (g.t === 'marquee') {
      const r = normRect(g.start, p);
      if (!g.moved && Math.hypot(r.w * vp.zoom, r.h * vp.zoom) < 4) return;
      g.moved = true;
      setMarquee(r);
      const hits = d.nodes.filter((n) => intersects(n, r)).map((n) => n.id);
      const nodes = Array.from(new Set([...g.base, ...hits]));
      const set = new Set(nodes);
      const edges = Array.from(new Set([...g.baseEdges, ...d.edges.filter((x) => set.has(x.source) && set.has(x.target)).map((x) => x.id)]));
      useSession.getState().select(nodes, edges);
      return;
    }

    if (g.t === 'connect') {
      const src = d.nodes.find((n) => n.id === g.source);
      if (!src) return;
      const from = portPoint(src, g.side);
      const target = nodeAt(d.nodes, p, g.source, 8 / vp.zoom);
      if (target) {
        const np = nearestPort(target, p);
        const toSide = np.dist <= 18 / vp.zoom ? np.side : facingSide(target, from);
        setLink({ from, side: g.side, to: portPoint(target, toSide), toSide, target: target.id });
      } else {
        setLink({ from, side: g.side, to: p, toSide: opposite[facingSide({ x: p.x, y: p.y, w: 0, h: 0 }, from)], target: null });
      }
    }
  };

  const endGesture = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (wrapRef.current?.hasPointerCapture(e.pointerId)) wrapRef.current.releasePointerCapture(e.pointerId);
    if (!g) return;
    if (g.t === 'pan') setPanning(false);
    if (g.t === 'drag' && !g.moved && g.collapseTo) useSession.getState().select([g.collapseTo]);
    if (g.t === 'marquee') setMarquee(null);
    if (g.t === 'connect') {
      const l = link;
      setLink(null);
      if (e.type === 'pointerup' && l?.target) doc.getState().addEdge(g.source, g.side, l.target, l.toSide);
    }
  };

  const onDoubleClick = (e: RMouseEvent<HTMLDivElement>) => {
    const el = e.target as Element;
    const nodeEl = el.closest('[data-node]');
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-node') as string;
      useSession.getState().select([id]);
      useSession.getState().setEditing({ type: 'node', id });
      return;
    }
    const edgeEl = el.closest('[data-edge]');
    if (edgeEl) {
      const id = edgeEl.getAttribute('data-edge') as string;
      useSession.getState().select([], [id]);
      useSession.getState().setEditing({ type: 'edge', id });
    }
  };

  // ------------------------------------------------------------- library drop
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(SHAPE_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const kind = e.dataTransfer.getData(SHAPE_MIME);
    if (!isShapeKind(kind)) return;
    e.preventDefault();
    const p = world(e);
    const s = doc.getState().prefs.snapToGrid;
    doc.getState().addNode(kind, snap(p.x, s), snap(p.y, s));
    wrapRef.current?.focus({ preventScroll: true });
  };

  if (!diagram) return null;
  const vp = diagram.viewport;
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const sortedNodes = [...diagram.nodes].sort((a, b) => a.z - b.z);
  const selSet = new Set(selectedNodes);
  const edgeSel = new Set(selectedEdges);
  const single = selectedNodes.length === 1 ? byId.get(selectedNodes[0]) : undefined;
  const portNodes = new Set<string>(selectedNodes.length <= 4 ? selectedNodes : []);
  if (hoverId && byId.has(hoverId)) portNodes.add(hoverId);
  if (link?.target) portNodes.add(link.target);
  const inv = 1 / vp.zoom;
  const gridPx = GRID * vp.zoom;
  const editNode = editing?.type === 'node' ? byId.get(editing.id) : undefined;
  const editEdge = editing?.type === 'edge' ? diagram.edges.find((x) => x.id === editing.id) : undefined;
  const editEdgeRoute = editEdge && byId.get(editEdge.source) && byId.get(editEdge.target)
    ? routeEdge(editEdge, byId.get(editEdge.source) as DNode, byId.get(editEdge.target) as DNode)
    : null;

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap${panning ? ' panning' : ''}`}
      style={spaceMode && !panning ? { cursor: 'grab' } : undefined}
      tabIndex={0}
      role="application"
      aria-label="Diagram canvas. Press question mark for keyboard shortcuts."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerLeave={() => !gesture.current && hoverId && setHoverId(null)}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onAuxClick={(e) => e.button === 1 && e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="grid"
        style={{
          backgroundSize: `${gridPx}px ${gridPx}px`,
          backgroundPosition: `${vp.x - gridPx / 2}px ${vp.y - gridPx / 2}px`,
          opacity: gridPx < 6 ? 0 : 1,
        }}
      />
      <div
        ref={layerRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg width={1} height={1} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
          <g className="edges">
            {diagram.edges.map((ed) => {
              const s = byId.get(ed.source);
              const t = byId.get(ed.target);
              if (!s || !t) return null;
              const r = routeEdge(ed, s, t);
              const on = edgeSel.has(ed.id);
              const stroke = on ? 'var(--accent)' : ed.stroke;
              const lw = ed.label.length * 12 * 0.58 + 12;
              return (
                <g key={ed.id} data-edge={ed.id}>
                  <path className="edge-hit pd-ui" d={r.d} style={{ strokeWidth: 14 * Math.max(1, inv) }} />
                  <path className="edge-line" d={r.d} stroke={stroke} strokeWidth={on ? ed.strokeWidth + 1 : ed.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
                  <path d={r.arrow} fill={stroke} style={{ pointerEvents: 'none' }} />
                  {ed.label && editEdge?.id !== ed.id && (
                    <g style={{ cursor: 'pointer' }}>
                      <rect x={r.label.x - lw / 2} y={r.label.y - 10} width={lw} height={20} rx={4} fill="#ffffff" stroke={on ? 'var(--accent)' : '#e2e8f0'} />
                      <text x={r.label.x} y={r.label.y + 4} fontSize={12} fill="#334155" textAnchor="middle" style={{ userSelect: 'none' }}>
                        {ed.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
          <g className="nodes">
            {sortedNodes.map((n) => (
              <g key={n.id} className="nodebox" data-node={n.id} style={editNode?.id === n.id ? { opacity: 0.35 } : undefined}>
                <rect className="hit" x={n.x} y={n.y} width={n.w} height={n.h} />
                <NodeShape node={n} />
              </g>
            ))}
          </g>
          <g className="pd-ui">
            {sortedNodes
              .filter((n) => selSet.has(n.id))
              .map((n) => (
                <rect key={n.id} className="sel-ring" x={n.x - 4 * inv} y={n.y - 4 * inv} width={n.w + 8 * inv} height={n.h + 8 * inv} rx={4 * inv} style={{ strokeWidth: 1.5 * inv }} />
              ))}
            {sortedNodes
              .filter((n) => portNodes.has(n.id) && editNode?.id !== n.id)
              .map((n) =>
                SIDES.map((side) => {
                  const q = portPoint(n, side);
                  const hot = link?.target === n.id && link.toSide === side;
                  return (
                    <g key={`${n.id}-${side}`} data-port={side} data-node-id={n.id}>
                      <circle className="port-halo" cx={q.x} cy={q.y} r={10 * inv} />
                      <circle className="port" cx={q.x} cy={q.y} r={(hot ? 6 : 4.5) * inv} style={{ strokeWidth: 1.5 * inv, fill: hot ? 'var(--accent)' : undefined }} />
                    </g>
                  );
                }),
              )}
            {single && !editNode &&
              HANDLES.map((h) => {
                const x = h.includes('w') ? single.x : single.x + single.w;
                const y = h.includes('n') ? single.y : single.y + single.h;
                const s = 8 * inv;
                return (
                  <rect
                    key={h}
                    data-handle={h}
                    data-node-id={single.id}
                    className="resize-handle"
                    x={x - s / 2}
                    y={y - s / 2}
                    width={s}
                    height={s}
                    rx={1.5 * inv}
                    style={{ strokeWidth: 1.5 * inv, cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize' }}
                  />
                );
              })}
            {link && (
              <path
                className="link-preview"
                d={routeBetween(diagram.defaultEdgeStyle, link.from, link.side, link.to, link.toSide, 1.5).d}
                style={{ strokeWidth: 1.5 * inv }}
              />
            )}
            {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} style={{ strokeWidth: inv }} />}
          </g>
        </svg>
      </div>

      {diagram.nodes.length === 0 && (
        <div className="empty-canvas">
          <strong>This diagram is empty</strong>
          <span>Drag a shape from the library, or click one to insert it here.</span>
        </div>
      )}

      {(selectedNodes.length > 0 || selectedEdges.length > 0) && !editing && <SelectionToolbar />}

      {editNode && (
        <LabelEditor
          key={editNode.id}
          className="node-edit"
          multiline
          initial={editNode.label}
          style={{
            left: editNode.x * vp.zoom + vp.x,
            top: editNode.y * vp.zoom + vp.y,
            width: Math.max(80, editNode.w * vp.zoom),
            height: Math.max(32, editNode.h * vp.zoom),
            fontSize: editNode.style.fontSize * vp.zoom,
            textAlign: editNode.style.align,
            fontWeight: editNode.style.bold ? 700 : 500,
          }}
          onDone={(value) => {
            if (value !== null && value !== editNode.label) doc.getState().patchNodes([editNode.id], { label: value });
            useSession.getState().setEditing(null);
            wrapRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {editEdge && editEdgeRoute && (
        <LabelEditor
          key={editEdge.id}
          className="edge-edit"
          initial={editEdge.label}
          style={{ left: editEdgeRoute.label.x * vp.zoom + vp.x - 75, top: editEdgeRoute.label.y * vp.zoom + vp.y - 13 }}
          onDone={(value) => {
            if (value !== null && value !== editEdge.label) doc.getState().patchEdges([editEdge.id], { label: value.trim() });
            useSession.getState().setEditing(null);
            wrapRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}

/** Inline text editor. Enter commits (Shift+Enter = newline when multiline), Escape cancels, blur commits. */
function LabelEditor(props: {
  className: string;
  initial: string;
  multiline?: boolean;
  style: CSSProperties;
  onDone: (value: string | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(v);
  };
  const onKeyDown = (e: RKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(null);
    } else if (e.key === 'Enter' && (!props.multiline || !e.shiftKey)) {
      e.preventDefault();
      finish(ref.current?.value ?? '');
    }
  };
  const common = {
    ref,
    className: props.className,
    defaultValue: props.initial,
    style: props.style,
    onKeyDown,
    onBlur: () => finish(ref.current?.value ?? ''),
    onPointerDown: (e: RPointerEvent) => e.stopPropagation(),
    'aria-label': 'Edit label',
  };
  return props.multiline ? <textarea {...common} /> : <input {...common} />;
}
