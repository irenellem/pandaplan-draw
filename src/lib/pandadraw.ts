import type { DEdge, Diagram, DNode, DocState, EdgeStyle, PandaDrawEnvelope, Page, Side, Workspace } from '../types';
import { uid } from './ids';
import { defaultStyle, isShapeKind } from './shapeCatalog';
import { nextPosition } from './tree';

export const FORMAT = 'pandadraw';
export const FORMAT_VERSION = 1;

export function buildEnvelope(state: Pick<DocState, 'workspace' | 'pages' | 'diagrams'>, onlyPageId?: string): PandaDrawEnvelope {
  const pages = onlyPageId
    ? [{ ...state.pages[onlyPageId], parentId: null }].filter((p) => p.id)
    : Object.values(state.pages);
  const ids = new Set(pages.map((p) => p.id));
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    workspace: state.workspace,
    pages,
    diagrams: Object.values(state.diagrams).filter((d) => ids.has(d.id)),
    exportedAt: new Date().toISOString(),
  };
}

export interface ImportReport {
  folders: number;
  diagrams: number;
  nodes: number;
  edges: number;
  notes: number;
  coerced: number;
  danglingEdges: number;
  recovered: number;
  warnings: string[];
  rootFolderId: string;
  firstDiagramId: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const side = (v: unknown, d: Side): Side => (v === 'n' || v === 'e' || v === 's' || v === 'w' ? v : d);
const edgeStyle = (v: unknown): EdgeStyle => (v === 'straight' || v === 'bezier' ? v : 'orthogonal');

/** Structural validation of an envelope. Returns the error message or null. */
export function validateEnvelope(raw: unknown): string | null {
  if (!isObj(raw)) return 'File is not a JSON object.';
  if (raw.format !== FORMAT) return `Unknown format "${str(raw.format, 'missing')}" (expected "pandadraw").`;
  if (raw.version !== FORMAT_VERSION) return `Unsupported version ${str(raw.version, 'missing')} (this app reads version 1).`;
  if (!Array.isArray(raw.pages)) return '"pages" must be an array.';
  if (!Array.isArray(raw.diagrams)) return '"diagrams" must be an array.';
  for (const [i, p] of raw.pages.entries()) if (!isObj(p) || typeof p.id !== 'string') return `pages[${i}] has no string id.`;
  for (const [i, d] of raw.diagrams.entries()) if (!isObj(d) || typeof d.id !== 'string') return `diagrams[${i}] has no string id.`;
  return null;
}

function normNode(raw: unknown, counters: { coerced: number }): DNode {
  const o = isObj(raw) ? raw : {};
  let kind = o.kind;
  if (!isShapeKind(kind)) {
    counters.coerced++;
    kind = 'rect';
  }
  const k = isShapeKind(kind) ? kind : 'rect';
  const st = isObj(o.style) ? o.style : {};
  const def = defaultStyle(k);
  const n: DNode = {
    id: str(o.id) || uid('n'),
    kind: k,
    x: num(o.x, 0),
    y: num(o.y, 0),
    w: Math.max(8, num(o.w, 120)),
    h: Math.max(8, num(o.h, 60)),
    z: num(o.z, 0),
    label: str(o.label),
    style: {
      fill: str(st.fill, def.fill),
      stroke: str(st.stroke, def.stroke),
      strokeWidth: num(st.strokeWidth, def.strokeWidth),
      fontSize: num(st.fontSize, def.fontSize),
      bold: typeof st.bold === 'boolean' ? st.bold : def.bold,
      align: st.align === 'left' || st.align === 'right' ? st.align : st.align === 'center' ? 'center' : def.align,
    },
  };
  if (typeof o.note === 'string' && o.note) n.note = o.note;
  if (o.start !== undefined) n.start = str(o.start);
  if (o.end !== undefined) n.end = str(o.end);
  return n;
}

/** Merge an already-validated envelope into the state as new pages under a fresh folder. Never drops data. */
export function mergeEnvelope(
  state: Pick<DocState, 'pages' | 'diagrams'>,
  env: { workspace?: unknown; pages: unknown[]; diagrams: unknown[] },
): { pages: Record<string, Page>; diagrams: Record<string, Diagram>; report: ImportReport } {
  const now = Date.now();
  const pages = { ...state.pages };
  const diagrams = { ...state.diagrams };
  const ws: Partial<Workspace> = isObj(env.workspace) ? (env.workspace as Partial<Workspace>) : {};
  const root: Page = {
    id: uid('p'),
    parentId: null,
    kind: 'folder',
    title: `Imported – ${str(ws.name, 'workspace')}`,
    position: nextPosition(pages, null),
    createdAt: now,
    updatedAt: now,
  };
  pages[root.id] = root;
  const report: ImportReport = {
    folders: 0, diagrams: 0, nodes: 0, edges: 0, notes: 0, coerced: 0, danglingEdges: 0, recovered: 0,
    warnings: [], rootFolderId: root.id, firstDiagramId: null,
  };

  const rawPages = env.pages.filter(isObj);
  const rawDiagrams = env.diagrams.filter(isObj);
  const idMap = new Map<string, string>();
  for (const p of rawPages) idMap.set(str(p.id), uid('p'));
  const kinds = new Map(rawPages.map((p) => [str(p.id), p.kind === 'folder' ? 'folder' : 'diagram']));
  const diagramById = new Map(rawDiagrams.map((d) => [str(d.id), d]));

  // Diagrams without a page are kept by giving them a page.
  for (const d of rawDiagrams) {
    const id = str(d.id);
    if (!idMap.has(id)) {
      idMap.set(id, uid('p'));
      kinds.set(id, 'diagram');
      rawPages.push({ id, parentId: null, kind: 'diagram', title: 'Recovered diagram', position: 1e6 });
      report.recovered++;
    }
  }

  for (const p of rawPages) {
    const oldId = str(p.id);
    const id = idMap.get(oldId) as string;
    const kind = kinds.get(oldId) === 'folder' ? 'folder' : 'diagram';
    const oldParent = typeof p.parentId === 'string' ? p.parentId : null;
    let parentId = root.id;
    if (oldParent && idMap.has(oldParent)) {
      if (kinds.get(oldParent) === 'folder') parentId = idMap.get(oldParent) as string;
      else report.warnings.push(`"${str(p.title, oldId)}" was nested under a diagram; placed in the import folder.`);
    }
    pages[id] = {
      id, parentId, kind,
      title: str(p.title, 'Untitled') || 'Untitled',
      position: num(p.position, 0),
      createdAt: num(p.createdAt, now),
      updatedAt: now,
    };
    if (kind === 'folder') {
      report.folders++;
      continue;
    }
    report.diagrams++;
    report.firstDiagramId ??= id;
    const raw = diagramById.get(oldId) ?? {};
    const counters = { coerced: 0 };
    const nodeMap = new Map<string, string>();
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map((rn) => {
      const n = normNode(rn, counters);
      const fresh = uid('n');
      nodeMap.set(n.id, fresh);
      if (n.note) report.notes++;
      return { ...n, id: fresh };
    });
    const edges: DEdge[] = (Array.isArray(raw.edges) ? raw.edges : []).filter(isObj).map((re) => {
      const s = str(re.source);
      const t = str(re.target);
      if (!nodeMap.has(s) || !nodeMap.has(t)) report.danglingEdges++;
      return {
        id: uid('e'),
        source: nodeMap.get(s) ?? s,
        target: nodeMap.get(t) ?? t,
        sourceSide: side(re.sourceSide, 'e'),
        targetSide: side(re.targetSide, 'w'),
        style: edgeStyle(re.style),
        label: str(re.label),
        stroke: str(re.stroke, '#64748b'),
        strokeWidth: num(re.strokeWidth, 1.5),
      };
    });
    report.coerced += counters.coerced;
    report.nodes += nodes.length;
    report.edges += edges.length;
    const note = str(raw.note);
    if (note) report.notes++;
    const vp = isObj(raw.viewport) ? raw.viewport : {};
    diagrams[id] = {
      id, nodes, edges, note,
      defaultEdgeStyle: edgeStyle(raw.defaultEdgeStyle),
      viewport: { x: num(vp.x, 0), y: num(vp.y, 0), zoom: num(vp.zoom, 1) },
      updatedAt: now,
    };
  }
  if (report.coerced) report.warnings.push(`${report.coerced} node(s) had an unknown shape type and became rectangles.`);
  if (report.danglingEdges) report.warnings.push(`${report.danglingEdges} connector(s) point at missing nodes; kept but hidden.`);
  if (report.recovered) report.warnings.push(`${report.recovered} diagram(s) had no page entry; added as "Recovered diagram".`);
  return { pages, diagrams, report };
}
