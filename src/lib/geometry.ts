import type { DNode, Point, Rect, Side, Viewport } from '../types';

export const GRID = 16;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const SIDES: Side[] = ['n', 'e', 's', 'w'];

export const SIDE_DIR: Record<Side, Point> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

export function portPoint(n: Pick<DNode, 'x' | 'y' | 'w' | 'h'>, side: Side): Point {
  switch (side) {
    case 'n':
      return { x: n.x + n.w / 2, y: n.y };
    case 'e':
      return { x: n.x + n.w, y: n.y + n.h / 2 };
    case 's':
      return { x: n.x + n.w / 2, y: n.y + n.h };
    case 'w':
      return { x: n.x, y: n.y + n.h / 2 };
  }
}

/** Side of `n` that faces point p (used when a connector is dropped on a node body). */
export function facingSide(n: Rect, p: Point): Side {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = (p.x - cx) / Math.max(n.w, 1);
  const dy = (p.y - cy) / Math.max(n.h, 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'e' : 'w';
  return dy > 0 ? 's' : 'n';
}

/** Nearest port of `n` to p, and its distance. */
export function nearestPort(n: DNode, p: Point): { side: Side; dist: number } {
  let best: { side: Side; dist: number } = { side: 'n', dist: Infinity };
  for (const side of SIDES) {
    const q = portPoint(n, side);
    const dist = Math.hypot(q.x - p.x, q.y - p.y);
    if (dist < best.dist) best = { side, dist };
  }
  return best;
}

export function snap(v: number, on: boolean, grid = GRID): number {
  return on ? Math.round(v / grid) * grid : Math.round(v);
}

export function boundsOf(nodes: Rect[]): Rect | null {
  if (nodes.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of nodes) {
    x1 = Math.min(x1, n.x);
    y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + n.w);
    y2 = Math.max(y2, n.y + n.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Screen (container-relative) → canvas coordinates. */
export function toCanvas(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}

/** Zoom keeping the container-relative point `at` fixed. */
export function zoomAt(vp: Viewport, nextZoom: number, at: Point): Viewport {
  const zoom = clampZoom(nextZoom);
  const c = toCanvas(vp, at);
  return { zoom, x: at.x - c.x * zoom, y: at.y - c.y * zoom };
}

/** Viewport that fits `b` inside a container of size w×h. */
export function fitViewport(b: Rect | null, w: number, h: number, pad = 64): Viewport {
  if (!b || w <= 0 || h <= 0) return { x: w / 2, y: h / 2, zoom: 1 };
  const zoom = clampZoom(Math.min((w - pad * 2) / Math.max(b.w, 1), (h - pad * 2) / Math.max(b.h, 1), 1.5));
  return { zoom, x: w / 2 - (b.x + b.w / 2) * zoom, y: h / 2 - (b.y + b.h / 2) * zoom };
}
