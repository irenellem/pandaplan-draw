import type { DEdge, DNode } from '../types';
import { textOn } from './color';
import { boundsOf } from './geometry';
import { escapeHtml } from './markdown';
import { routeEdge } from './route';
import { labelBox, shapePrims, type Paint } from './shapes';

/** Hand-written SVG serializer. It works from the graph itself (no DOM snapshot), so the output is real vectors. */
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const r = (n: number) => Math.round(n * 100) / 100;

function paintAttrs(p: Paint, n: DNode): string {
  const { fill, stroke, strokeWidth } = n.style;
  const f = fill === 'transparent' ? 'none' : fill;
  switch (p) {
    case 'body':
      return `fill="${escapeHtml(f)}" stroke="${escapeHtml(stroke)}" stroke-width="${strokeWidth}" stroke-linejoin="round"`;
    case 'line':
      return `fill="none" stroke="${escapeHtml(stroke)}" stroke-width="${strokeWidth}" stroke-linecap="round"`;
    case 'solid':
      return `fill="${escapeHtml(stroke)}" stroke="none"`;
    case 'shade':
      return `fill="${escapeHtml(stroke)}" fill-opacity="0.18" stroke="none"`;
  }
}

/** Greedy word wrap using an average glyph width; good enough for labels. */
export function wrapText(text: string, maxWidth: number, fontSize: number, bold: boolean): string[] {
  const charW = fontSize * (bold ? 0.6 : 0.55);
  const maxChars = Math.max(1, Math.floor(maxWidth / charW));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (next.length <= maxChars) line = next;
      else {
        if (line) out.push(line);
        line = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w;
      }
    }
    out.push(line);
  }
  return out;
}

function nodeText(n: DNode): string {
  const box = labelBox(n.kind, n.w, n.h);
  const { fontSize, bold, align, fill } = n.style;
  const color = n.kind === 'server' || n.kind === 'database' || n.kind === 'network' || n.kind === 'queue' || n.kind === 'user'
    ? '#0f172a'
    : textOn(fill);
  const parts: string[] = [];
  if (n.label) {
    const lines = wrapText(n.label, box.w, fontSize, bold);
    const lh = fontSize * 1.25;
    const total = lines.length * lh;
    const top = box.valign === 'top' ? box.y : box.y + (box.h - total) / 2;
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w : box.x + box.w / 2;
    const spans = lines
      .map((l, i) => `<tspan x="${r(x)}" y="${r(top + lh * i + fontSize)}">${escapeHtml(l)}</tspan>`)
      .join('');
    parts.push(
      `<text font-family="${FONT}" font-size="${fontSize}" font-weight="${bold ? 700 : 400}" fill="${color}" text-anchor="${anchor}">${spans}</text>`,
    );
  }
  if (n.kind === 'gantt') {
    const y = n.h - 4;
    if (n.start) parts.push(`<text font-family="${FONT}" font-size="11" fill="#64748b" x="0" y="${y}">${escapeHtml(n.start)}</text>`);
    if (n.end)
      parts.push(`<text font-family="${FONT}" font-size="11" fill="#64748b" x="${n.w}" y="${y}" text-anchor="end">${escapeHtml(n.end)}</text>`);
  }
  return parts.join('');
}

function edgeSvg(e: DEdge, nodes: Map<string, DNode>): string {
  const s = nodes.get(e.source);
  const t = nodes.get(e.target);
  if (!s || !t) return '';
  const route = routeEdge(e, s, t);
  const stroke = escapeHtml(e.stroke);
  let out = `<path d="${route.d}" fill="none" stroke="${stroke}" stroke-width="${e.strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`;
  out += `<path d="${route.arrow}" fill="${stroke}" stroke="none"/>`;
  if (e.label) {
    const fs = 12;
    const w = e.label.length * fs * 0.58 + 12;
    out +=
      `<rect x="${r(route.label.x - w / 2)}" y="${r(route.label.y - 10)}" width="${r(w)}" height="20" rx="4" fill="#ffffff" stroke="#e2e8f0"/>` +
      `<text x="${r(route.label.x)}" y="${r(route.label.y + 4)}" font-family="${FONT}" font-size="${fs}" fill="#334155" text-anchor="middle">${escapeHtml(e.label)}</text>`;
  }
  return out;
}

export function diagramToSvg(nodes: DNode[], edges: DEdge[], opts: { background?: string; padding?: number } = {}): string {
  const pad = opts.padding ?? 32;
  const b = boundsOf(nodes) ?? { x: 0, y: 0, w: 200, h: 120 };
  // Captions on infra nodes extend 20px past each side; include that.
  const vb = { x: b.x - pad - 20, y: b.y - pad, w: b.w + pad * 2 + 40, h: b.h + pad * 2 };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sorted = [...nodes].sort((a, c) => a.z - c.z);
  const body = [
    opts.background && opts.background !== 'transparent'
      ? `<rect x="${r(vb.x)}" y="${r(vb.y)}" width="${r(vb.w)}" height="${r(vb.h)}" fill="${escapeHtml(opts.background)}"/>`
      : '',
    `<g class="edges">${edges.map((e) => edgeSvg(e, byId)).join('')}</g>`,
    `<g class="nodes">${sorted
      .map((n) => {
        const prims = shapePrims(n.kind, n.w, n.h)
          .map((p) => `<path d="${p.d}" ${paintAttrs(p.paint, n)}/>`)
          .join('');
        return `<g transform="translate(${r(n.x)} ${r(n.y)})" data-kind="${n.kind}">${prims}${nodeText(n)}</g>`;
      })
      .join('')}</g>`,
  ].join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r(vb.w)}" height="${r(vb.h)}" viewBox="${r(vb.x)} ${r(vb.y)} ${r(vb.w)} ${r(vb.h)}">` +
    body +
    `</svg>`
  );
}
