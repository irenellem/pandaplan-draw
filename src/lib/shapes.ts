import type { Rect, ShapeKind } from '../types';

/**
 * Shape geometry as plain path primitives. The canvas (React SVG) and the SVG exporter both render
 * from this, so exported vectors always match what is on screen.
 *
 * paint:
 *  - body  : fill = node fill, stroke = node stroke
 *  - line  : no fill, stroke = node stroke
 *  - solid : fill = node stroke, no stroke
 *  - shade : fill = node stroke at low opacity, no stroke
 */
export type Paint = 'body' | 'line' | 'solid' | 'shade';
export interface Prim {
  d: string;
  paint: Paint;
}

const f = (n: number) => Math.round(n * 100) / 100;

export function rectPath(x: number, y: number, w: number, h: number, r = 0): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
  return (
    `M${f(x + rr)} ${f(y)}H${f(x + w - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w)} ${f(y + rr)}` +
    `V${f(y + h - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w - rr)} ${f(y + h)}` +
    `H${f(x + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x)} ${f(y + h - rr)}` +
    `V${f(y + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr)} ${f(y)}Z`
  );
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return (
    `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}` +
    `A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`
  );
}

function poly(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + 'Z';
}

function cylinder(x: number, y: number, w: number, h: number): Prim[] {
  const ry = Math.min(h * 0.15, 14);
  const body =
    `M${f(x)} ${f(y + ry)}A${f(w / 2)} ${f(ry)} 0 0 1 ${f(x + w)} ${f(y + ry)}` +
    `V${f(y + h - ry)}A${f(w / 2)} ${f(ry)} 0 0 1 ${f(x)} ${f(y + h - ry)}Z`;
  const rim = `M${f(x)} ${f(y + ry)}A${f(w / 2)} ${f(ry)} 0 0 0 ${f(x + w)} ${f(y + ry)}`;
  return [
    { d: body, paint: 'body' },
    { d: rim, paint: 'line' },
  ];
}

function cloudPath(x: number, y: number, w: number, h: number): string {
  const p = (px: number, py: number) => `${f(x + px * w)} ${f(y + py * h)}`;
  return (
    `M${p(0.25, 0.9)}C${p(0.05, 0.9)} ${p(0.0, 0.62)} ${p(0.16, 0.54)}` +
    `C${p(0.1, 0.3)} ${p(0.34, 0.16)} ${p(0.46, 0.3)}` +
    `C${p(0.55, 0.06)} ${p(0.88, 0.12)} ${p(0.84, 0.42)}` +
    `C${p(1.0, 0.46)} ${p(1.0, 0.9)} ${p(0.78, 0.9)}Z`
  );
}

/** Infra glyphs sit in the box above a 24px caption row. */
export const CAPTION_H = 24;
const INFRA: ReadonlySet<ShapeKind> = new Set(['server', 'database', 'network', 'queue', 'user']);
export const isCaptioned = (kind: ShapeKind) => INFRA.has(kind);

function glyphBox(w: number, h: number): Rect {
  const gh = Math.max(16, h - CAPTION_H - 4);
  const gw = Math.min(w - 8, gh * 1.25);
  return { x: (w - gw) / 2, y: 2, w: gw, h: gh };
}

function infra(kind: ShapeKind, w: number, h: number): Prim[] {
  const g = glyphBox(w, h);
  switch (kind) {
    case 'server': {
      const sw = g.w * 0.72;
      const sx = g.x + (g.w - sw) / 2;
      const unit = g.h / 3;
      const prims: Prim[] = [{ d: rectPath(sx, g.y, sw, g.h, 4), paint: 'body' }];
      for (let i = 1; i < 3; i++) prims.push({ d: `M${f(sx)} ${f(g.y + unit * i)}H${f(sx + sw)}`, paint: 'line' });
      for (let i = 0; i < 3; i++) prims.push({ d: ellipsePath(sx + sw - 9, g.y + unit * i + unit / 2, 2.5, 2.5), paint: 'solid' });
      for (let i = 0; i < 3; i++)
        prims.push({ d: `M${f(sx + 7)} ${f(g.y + unit * i + unit / 2)}H${f(sx + sw * 0.5)}`, paint: 'line' });
      return prims;
    }
    case 'database':
      return cylinder(g.x + g.w * 0.12, g.y, g.w * 0.76, g.h);
    case 'network': {
      const cx = g.x + g.w / 2;
      const cy = g.y + g.h / 2;
      const r = Math.min(g.w, g.h) * 0.16;
      const sats: Array<[number, number]> = [
        [g.x + r, g.y + r],
        [g.x + g.w - r, g.y + r],
        [g.x + r, g.y + g.h - r],
        [g.x + g.w - r, g.y + g.h - r],
      ];
      const prims: Prim[] = sats.map(([sx, sy]) => ({ d: `M${f(cx)} ${f(cy)}L${f(sx)} ${f(sy)}`, paint: 'line' }));
      prims.push({ d: rectPath(cx - r * 1.3, cy - r * 0.9, r * 2.6, r * 1.8, 3), paint: 'body' });
      for (const [sx, sy] of sats) prims.push({ d: ellipsePath(sx, sy, r * 0.75, r * 0.75), paint: 'body' });
      return prims;
    }
    case 'queue': {
      const qh = g.h * 0.5;
      const qy = g.y + (g.h - qh) / 2;
      const prims: Prim[] = [{ d: rectPath(g.x, qy, g.w, qh, 4), paint: 'body' }];
      const cell = g.w / 5;
      for (let i = 1; i < 5; i++) prims.push({ d: `M${f(g.x + cell * i)} ${f(qy)}V${f(qy + qh)}`, paint: 'line' });
      for (let i = 0; i < 3; i++) prims.push({ d: rectPath(g.x + cell * i + 4, qy + 4, cell - 8, qh - 8, 2), paint: 'shade' });
      return prims;
    }
    case 'user': {
      const cx = g.x + g.w / 2;
      const hr = g.h * 0.2;
      const head = ellipsePath(cx, g.y + hr + 1, hr, hr);
      const bw = g.h * 0.42;
      const top = g.y + hr * 2 + 6;
      const bottom = g.y + g.h;
      const body =
        `M${f(cx - bw)} ${f(bottom)}V${f(top + bw * 0.6)}` +
        `C${f(cx - bw)} ${f(top)} ${f(cx + bw)} ${f(top)} ${f(cx + bw)} ${f(top + bw * 0.6)}V${f(bottom)}Z`;
      return [
        { d: body, paint: 'body' },
        { d: head, paint: 'body' },
      ];
    }
    default:
      return [];
  }
}

export function shapePrims(kind: ShapeKind, w: number, h: number): Prim[] {
  switch (kind) {
    case 'process':
      return [{ d: rectPath(0, 0, w, h, 2), paint: 'body' }];
    case 'rect':
      return [{ d: rectPath(0, 0, w, h, 0), paint: 'body' }];
    case 'rounded':
      return [{ d: rectPath(0, 0, w, h, Math.min(16, h / 4)), paint: 'body' }];
    case 'terminator':
      return [{ d: rectPath(0, 0, w, h, h / 2), paint: 'body' }];
    case 'decision':
    case 'diamond':
      return [{ d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), paint: 'body' }];
    case 'data':
    case 'parallelogram': {
      const s = Math.min(w * 0.2, h * 0.6);
      return [{ d: poly([[s, 0], [w, 0], [w - s, h], [0, h]]), paint: 'body' }];
    }
    case 'hexagon': {
      const i = Math.min(w * 0.25, h * 0.5);
      return [{ d: poly([[i, 0], [w - i, 0], [w, h / 2], [w - i, h], [i, h], [0, h / 2]]), paint: 'body' }];
    }
    case 'ellipse':
      return [{ d: ellipsePath(w / 2, h / 2, w / 2, h / 2), paint: 'body' }];
    case 'document': {
      const a = h * 0.12;
      const d =
        `M0 0H${f(w)}V${f(h - a)}` +
        `C${f(w * 0.72)} ${f(h - a * 2.6)} ${f(w * 0.36)} ${f(h + a * 0.9)} 0 ${f(h - a * 0.7)}Z`;
      return [{ d, paint: 'body' }];
    }
    case 'cylinder':
      return cylinder(0, 0, w, h);
    case 'cloud':
      return [{ d: cloudPath(0, 0, w, h), paint: 'body' }];
    case 'sticky': {
      const fold = Math.min(18, w * 0.2, h * 0.2);
      return [
        { d: poly([[0, 0], [w, 0], [w, h - fold], [w - fold, h], [0, h]]), paint: 'body' },
        { d: poly([[w, h - fold], [w - fold, h - fold], [w - fold, h]]), paint: 'shade' },
      ];
    }
    case 'gantt':
      return [
        { d: rectPath(0, 0, w, h - 18, 8), paint: 'body' },
        { d: rectPath(0, 0, 6, h - 18, 3), paint: 'solid' },
      ];
    default:
      return infra(kind, w, h);
  }
}

/** Where the label text goes, in node-local coordinates. */
export function labelBox(kind: ShapeKind, w: number, h: number): Rect & { valign: 'top' | 'middle' } {
  if (isCaptioned(kind)) return { x: -20, y: h - CAPTION_H, w: w + 40, h: CAPTION_H, valign: 'middle' };
  switch (kind) {
    case 'decision':
    case 'diamond':
      return { x: w * 0.18, y: h * 0.18, w: w * 0.64, h: h * 0.64, valign: 'middle' };
    case 'data':
    case 'parallelogram': {
      const s = Math.min(w * 0.2, h * 0.6);
      return { x: s * 0.7, y: 4, w: w - s * 1.4, h: h - 8, valign: 'middle' };
    }
    case 'hexagon': {
      const i = Math.min(w * 0.25, h * 0.5);
      return { x: i * 0.6, y: 4, w: w - i * 1.2, h: h - 8, valign: 'middle' };
    }
    case 'document':
      return { x: 8, y: 4, w: w - 16, h: h * 0.8, valign: 'middle' };
    case 'cylinder': {
      const ry = Math.min(h * 0.15, 14);
      return { x: 6, y: ry * 2, w: w - 12, h: h - ry * 3, valign: 'middle' };
    }
    case 'cloud':
      return { x: w * 0.15, y: h * 0.32, w: w * 0.7, h: h * 0.5, valign: 'middle' };
    case 'sticky':
      return { x: 12, y: 10, w: w - 24, h: h - 20, valign: 'top' };
    case 'gantt':
      return { x: 14, y: 0, w: w - 22, h: h - 18, valign: 'middle' };
    default:
      return { x: 8, y: 4, w: w - 16, h: h - 8, valign: 'middle' };
  }
}
