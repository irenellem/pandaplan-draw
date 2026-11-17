import type { DEdge, Diagram, DNode, Page, ShapeKind, Side } from '../types';

/** What we store in R2 for every saved diagram. */
export interface DrawioFile {
  kind: 'drawio';
  version: 1;
  name: string;
  xml: string;
  updatedAt: string;
}

export function slugify(input: string, fallback = 'untitled'): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;');

let seq = 0;
const cellId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function blankXml(page = 'Page-1'): string {
  return (
    `<mxfile host="pandaplan-draw"><diagram id="${cellId('d')}" name="${esc(page)}">` +
    `<mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`
  );
}

export function makeFile(name: string, xml: string): DrawioFile {
  return { kind: 'drawio', version: 1, name, xml, updatedAt: new Date().toISOString() };
}

/* ------------------------------------------------------------- legacy .pandadraw -> mxfile */

const SHAPE_STYLE: Record<ShapeKind, string> = {
  process: 'rounded=0;',
  rect: 'rounded=0;',
  rounded: 'rounded=1;',
  decision: 'rhombus;',
  diamond: 'rhombus;',
  terminator: 'rounded=1;arcSize=50;',
  data: 'shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;',
  parallelogram: 'shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;',
  document: 'shape=document;boundedLbl=1;',
  cylinder: 'shape=cylinder3;boundedLbl=1;size=12;',
  database: 'shape=cylinder3;boundedLbl=1;size=12;',
  ellipse: 'ellipse;',
  hexagon: 'shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;',
  server: 'rounded=1;',
  network: 'ellipse;',
  queue: 'shape=process;backgroundOutline=1;',
  user: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;',
  cloud: 'ellipse;shape=cloud;',
  sticky: 'shape=note;size=15;',
  gantt: 'rounded=1;',
};

const SIDE_XY: Record<Side, [number, number]> = { n: [0.5, 0], e: [1, 0.5], s: [0.5, 1], w: [0, 0.5] };

function nodeCell(n: DNode): string {
  const st = n.style ?? { fill: '#ffffff', stroke: '#334155', strokeWidth: 1.5, fontSize: 14, bold: false, align: 'center' };
  const style =
    (SHAPE_STYLE[n.kind] ?? 'rounded=0;') +
    `whiteSpace=wrap;html=1;fillColor=${st.fill === 'transparent' ? 'none' : st.fill};strokeColor=${st.stroke};` +
    `strokeWidth=${st.strokeWidth};fontSize=${st.fontSize};align=${st.align};` +
    (st.bold ? 'fontStyle=1;' : '');
  const label = n.kind === 'gantt' && (n.start || n.end) ? `${n.label}\n${n.start ?? ''} – ${n.end ?? ''}` : n.label;
  const geo = `<mxGeometry x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" as="geometry"/>`;
  if (n.note) {
    return (
      `<UserObject label="${esc(label)}" tooltip="${esc(n.note)}" id="${esc(n.id)}">` +
      `<mxCell style="${esc(style)}" vertex="1" parent="1">${geo}</mxCell></UserObject>`
    );
  }
  return `<mxCell id="${esc(n.id)}" value="${esc(label)}" style="${esc(style)}" vertex="1" parent="1">${geo}</mxCell>`;
}

function edgeCell(e: DEdge): string {
  const route = e.style === 'straight' ? 'edgeStyle=none;' : e.style === 'bezier' ? 'curved=1;' : 'edgeStyle=orthogonalEdgeStyle;rounded=1;';
  const [sx, sy] = SIDE_XY[e.sourceSide] ?? SIDE_XY.e;
  const [tx, ty] = SIDE_XY[e.targetSide] ?? SIDE_XY.w;
  const style =
    route +
    `html=1;strokeColor=${e.stroke};strokeWidth=${e.strokeWidth};exitX=${sx};exitY=${sy};exitDx=0;exitDy=0;entryX=${tx};entryY=${ty};entryDx=0;entryDy=0;`;
  return (
    `<mxCell id="${esc(e.id)}" value="${esc(e.label ?? '')}" style="${esc(style)}" edge="1" parent="1" ` +
    `source="${esc(e.source)}" target="${esc(e.target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`
  );
}

function diagramXml(title: string, d: Diagram): string {
  const nodes = [...(d.nodes ?? [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (d.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
  const cells = nodes.map(nodeCell).join('') + edges.map(edgeCell).join('');
  return (
    `<diagram id="${esc(d.id)}" name="${esc(title)}"><mxGraphModel grid="1" gridSize="10" guides="1" connect="1" arrows="1" page="1">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>`
  );
}

/** Legacy pandadraw diagrams -> one mxfile with a page per diagram. */
export function legacyToXml(pages: Page[], diagrams: Diagram[]): string {
  const titles = new Map(pages.map((p) => [p.id, p.title]));
  const body = diagrams.map((d, i) => diagramXml(titles.get(d.id) || `Page-${i + 1}`, d)).join('');
  return body ? `<mxfile host="pandaplan-draw">${body}</mxfile>` : blankXml();
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Accepts the current `{kind:"drawio"}` payload, a legacy `.pandadraw` envelope, or bare mxfile XML.
 * Returns the XML draw.io should load, or throws with a readable reason.
 */
export function toXml(raw: unknown): string {
  if (typeof raw === 'string' && raw.trimStart().startsWith('<')) return raw;
  if (!isObj(raw)) throw new Error('File is not a JSON object.');
  if (raw.kind === 'drawio') {
    if (typeof raw.xml !== 'string' || !raw.xml.trim()) throw new Error('drawio file has no xml.');
    return raw.xml;
  }
  if (raw.format === 'pandadraw') {
    if (!Array.isArray(raw.pages) || !Array.isArray(raw.diagrams)) throw new Error('pandadraw file is missing pages/diagrams.');
    return legacyToXml(raw.pages as Page[], (raw.diagrams as Diagram[]).filter((d) => isObj(d) && typeof d.id === 'string'));
  }
  throw new Error(`Unknown file shape (kind "${String(raw.kind ?? raw.format ?? 'missing')}").`);
}
