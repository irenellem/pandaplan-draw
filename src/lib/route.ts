import type { DEdge, DNode, EdgeStyle, Point, Rect, Side } from '../types';
import { portPoint, SIDE_DIR } from './geometry';

/**
 * Edge router. Orthogonal routes leave and enter perpendicular to the port side through a short stub,
 * then join with one or two elbows; corners are rounded. Shared by the canvas and the SVG exporter.
 */
export interface Route {
  d: string;
  arrow: string;
  label: Point;
  points: Point[];
}

const STUB = 20;
const r2 = (n: number) => Math.round(n * 100) / 100;
const add = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const isH = (s: Side) => s === 'e' || s === 'w';

function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  // drop collinear middles
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) {
      out.splice(i, 1);
    }
  }
  return out;
}

export function orthogonalPoints(s: Point, sd: Side, t: Point, td: Side, sr?: Rect, tr?: Rect): Point[] {
  const a = add(s, SIDE_DIR[sd], STUB);
  const b = add(t, SIDE_DIR[td], STUB);
  let mid: Point[];
  if (isH(sd) && isH(td)) {
    if (sd === td) {
      const x = sd === 'e' ? Math.max(a.x, b.x) : Math.min(a.x, b.x);
      mid = [{ x, y: a.y }, { x, y: b.y }];
    } else if (dot(sub(b, a), SIDE_DIR[sd]) >= 0) {
      const mx = (a.x + b.x) / 2;
      mid = [{ x: mx, y: a.y }, { x: mx, y: b.y }];
    } else {
      let my = (a.y + b.y) / 2;
      if (sr && tr && Math.abs(a.y - b.y) < (sr.h + tr.h) / 2) my = Math.max(sr.y + sr.h, tr.y + tr.h) + STUB;
      mid = [{ x: a.x, y: my }, { x: b.x, y: my }];
    }
  } else if (!isH(sd) && !isH(td)) {
    if (sd === td) {
      const y = sd === 's' ? Math.max(a.y, b.y) : Math.min(a.y, b.y);
      mid = [{ x: a.x, y }, { x: b.x, y }];
    } else if (dot(sub(b, a), SIDE_DIR[sd]) >= 0) {
      const my = (a.y + b.y) / 2;
      mid = [{ x: a.x, y: my }, { x: b.x, y: my }];
    } else {
      let mx = (a.x + b.x) / 2;
      if (sr && tr && Math.abs(a.x - b.x) < (sr.w + tr.w) / 2) mx = Math.max(sr.x + sr.w, tr.x + tr.w) + STUB;
      mid = [{ x: mx, y: a.y }, { x: mx, y: b.y }];
    }
  } else {
    const corner = isH(sd) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    const ok = dot(sub(corner, a), SIDE_DIR[sd]) >= 0 && dot(sub(b, corner), SIDE_DIR[td]) <= 0;
    mid = ok ? [corner] : [isH(sd) ? { x: a.x, y: b.y } : { x: b.x, y: a.y }];
  }
  return simplify([s, a, ...mid, b, t]);
}

function roundedPolyline(pts: Point[], radius = 8): string {
  if (pts.length < 2) return '';
  let d = `M${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const prev = pts[i - 1];
    const next = pts[i + 1];
    const l1 = Math.hypot(p.x - prev.x, p.y - prev.y);
    const l2 = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const p1 = { x: p.x + ((prev.x - p.x) / (l1 || 1)) * r, y: p.y + ((prev.y - p.y) / (l1 || 1)) * r };
    const p2 = { x: p.x + ((next.x - p.x) / (l2 || 1)) * r, y: p.y + ((next.y - p.y) / (l2 || 1)) * r };
    d += `L${r2(p1.x)} ${r2(p1.y)}Q${r2(p.x)} ${r2(p.y)} ${r2(p2.x)} ${r2(p2.y)}`;
  }
  const last = pts[pts.length - 1];
  return d + `L${r2(last.x)} ${r2(last.y)}`;
}

function polylineMid(pts: Point[]): Point {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let half = lens.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (half <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? half / lens[i] : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    half -= lens[i];
  }
  return pts[0];
}

function arrowHead(tip: Point, from: Point, sw: number): { d: string; base: Point } {
  const len = 9 + sw * 2;
  const half = 4.5 + sw;
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const base = { x: tip.x - ux * len, y: tip.y - uy * len };
  const left = { x: base.x - uy * half, y: base.y + ux * half };
  const right = { x: base.x + uy * half, y: base.y - ux * half };
  return {
    d: `M${r2(tip.x)} ${r2(tip.y)}L${r2(left.x)} ${r2(left.y)}L${r2(right.x)} ${r2(right.y)}Z`,
    base: { x: tip.x - ux * len * 0.7, y: tip.y - uy * len * 0.7 },
  };
}

export function routeBetween(
  style: EdgeStyle,
  s: Point,
  sd: Side,
  t: Point,
  td: Side,
  strokeWidth: number,
  sr?: Rect,
  tr?: Rect,
): Route {
  if (style === 'bezier') {
    const k = Math.min(160, Math.max(30, Math.hypot(t.x - s.x, t.y - s.y) * 0.4));
    const c1 = add(s, SIDE_DIR[sd], k);
    const c2 = add(t, SIDE_DIR[td], k);
    const head = arrowHead(t, c2, strokeWidth);
    const e = head.base;
    const label = {
      x: 0.125 * s.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * t.x,
      y: 0.125 * s.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * t.y,
    };
    const d = `M${r2(s.x)} ${r2(s.y)}C${r2(c1.x)} ${r2(c1.y)} ${r2(c2.x)} ${r2(c2.y)} ${r2(e.x)} ${r2(e.y)}`;
    return { d, arrow: head.d, label, points: [s, c1, c2, t] };
  }
  const pts = style === 'straight' ? [s, t] : orthogonalPoints(s, sd, t, td, sr, tr);
  const head = arrowHead(t, pts[pts.length - 2] ?? s, strokeWidth);
  const drawn = [...pts.slice(0, -1), head.base];
  return { d: roundedPolyline(drawn), arrow: head.d, label: polylineMid(pts), points: pts };
}

export function routeEdge(e: DEdge, src: DNode, tgt: DNode): Route {
  return routeBetween(
    e.style,
    portPoint(src, e.sourceSide),
    e.sourceSide,
    portPoint(tgt, e.targetSide),
    e.targetSide,
    e.strokeWidth,
    src,
    tgt,
  );
}
