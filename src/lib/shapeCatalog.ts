import type { DNode, NodeStyle, ShapeKind } from '../types';
import { uid } from './ids';

export interface ShapeDef {
  kind: ShapeKind;
  name: string;
  w: number;
  h: number;
  label: string;
}

export interface ShapeGroup {
  id: string;
  name: string;
  shapes: ShapeDef[];
}

export const SHAPE_GROUPS: ShapeGroup[] = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    shapes: [
      { kind: 'process', name: 'Process', w: 140, h: 64, label: 'Process' },
      { kind: 'decision', name: 'Decision', w: 140, h: 96, label: 'Decision?' },
      { kind: 'terminator', name: 'Terminator', w: 140, h: 52, label: 'Start' },
      { kind: 'data', name: 'Data (I/O)', w: 150, h: 64, label: 'Data' },
      { kind: 'document', name: 'Document', w: 140, h: 76, label: 'Document' },
      { kind: 'cylinder', name: 'Database', w: 110, h: 90, label: 'Database' },
    ],
  },
  {
    id: 'basic',
    name: 'Basic',
    shapes: [
      { kind: 'rect', name: 'Rectangle', w: 140, h: 72, label: '' },
      { kind: 'rounded', name: 'Rounded rectangle', w: 140, h: 72, label: '' },
      { kind: 'ellipse', name: 'Ellipse', w: 120, h: 80, label: '' },
      { kind: 'diamond', name: 'Diamond', w: 110, h: 110, label: '' },
      { kind: 'parallelogram', name: 'Parallelogram', w: 150, h: 64, label: '' },
      { kind: 'hexagon', name: 'Hexagon', w: 140, h: 72, label: '' },
    ],
  },
  {
    id: 'infra',
    name: 'Cloud / Infra',
    shapes: [
      { kind: 'server', name: 'Server', w: 96, h: 100, label: 'Server' },
      { kind: 'database', name: 'Database', w: 96, h: 100, label: 'DB' },
      { kind: 'network', name: 'Network', w: 96, h: 100, label: 'Network' },
      { kind: 'queue', name: 'Queue / workflow', w: 110, h: 90, label: 'Queue' },
      { kind: 'user', name: 'User', w: 80, h: 100, label: 'User' },
      { kind: 'cloud', name: 'Cloud', w: 160, h: 100, label: 'Cloud' },
    ],
  },
  {
    id: 'notes',
    name: 'Sticky note',
    shapes: [{ kind: 'sticky', name: 'Sticky note', w: 160, h: 140, label: 'Note' }],
  },
  {
    id: 'timeline',
    name: 'Gantt / timeline',
    shapes: [{ kind: 'gantt', name: 'Timeline bar', w: 240, h: 58, label: 'Task' }],
  },
];

export const SHAPE_DEFS: Record<ShapeKind, ShapeDef> = Object.fromEntries(
  SHAPE_GROUPS.flatMap((g) => g.shapes).map((s) => [s.kind, s]),
) as Record<ShapeKind, ShapeDef>;

export const ALL_KINDS = Object.keys(SHAPE_DEFS) as ShapeKind[];

export function isShapeKind(v: unknown): v is ShapeKind {
  return typeof v === 'string' && v in SHAPE_DEFS;
}

export function defaultStyle(kind: ShapeKind): NodeStyle {
  const base: NodeStyle = { fill: '#ffffff', stroke: '#334155', strokeWidth: 1.5, fontSize: 14, bold: false, align: 'center' };
  if (kind === 'sticky') return { ...base, fill: '#fde68a', stroke: '#d4a72c', strokeWidth: 1, align: 'left' };
  if (kind === 'gantt') return { ...base, fill: '#dbeafe', stroke: '#1877f2', fontSize: 13, bold: true, align: 'left' };
  if (kind === 'terminator') return { ...base, fill: '#dcfce7', stroke: '#16a34a' };
  if (kind === 'decision') return { ...base, fill: '#fef3c7', stroke: '#d97706' };
  if (kind === 'cloud') return { ...base, fill: '#f1f5f9' };
  return base;
}

export function createNode(kind: ShapeKind, cx: number, cy: number, z: number): DNode {
  const def = SHAPE_DEFS[kind];
  const node: DNode = {
    id: uid('n'),
    kind,
    x: Math.round(cx - def.w / 2),
    y: Math.round(cy - def.h / 2),
    w: def.w,
    h: def.h,
    z,
    label: def.label,
    style: defaultStyle(kind),
  };
  if (kind === 'gantt') {
    node.start = 'Mon';
    node.end = 'Fri';
  }
  return node;
}
