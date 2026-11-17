export type ShapeKind =
  // Flowchart
  | 'process'
  | 'decision'
  | 'terminator'
  | 'data'
  | 'document'
  | 'cylinder'
  // Basic
  | 'rect'
  | 'rounded'
  | 'ellipse'
  | 'diamond'
  | 'parallelogram'
  | 'hexagon'
  // Cloud / Infra
  | 'server'
  | 'database'
  | 'network'
  | 'queue'
  | 'user'
  | 'cloud'
  // Special
  | 'sticky'
  | 'gantt';

export type EdgeStyle = 'orthogonal' | 'straight' | 'bezier';
export type Side = 'n' | 'e' | 's' | 'w';
export type TextAlign = 'left' | 'center' | 'right';
export type ThemePref = 'light' | 'dark';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface NodeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fontSize: number;
  bold: boolean;
  align: TextAlign;
}

export interface DNode {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  label: string;
  style: NodeStyle;
  note?: string;
  start?: string;
  end?: string;
}

export interface DEdge {
  id: string;
  source: string;
  target: string;
  sourceSide: Side;
  targetSide: Side;
  style: EdgeStyle;
  label: string;
  stroke: string;
  strokeWidth: number;
}

export interface Diagram {
  id: string;
  nodes: DNode[];
  edges: DEdge[];
  note: string;
  defaultEdgeStyle: EdgeStyle;
  viewport: Viewport;
  updatedAt: number;
}

export type PageKind = 'folder' | 'diagram';

export interface Page {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface Prefs {
  theme: ThemePref;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  libraryCollapsed: boolean;
  drawerOpen: boolean;
  drawerWidth: number;
  snapToGrid: boolean;
  pngBackground: 'white' | 'transparent';
  expanded: Record<string, boolean>;
}

export interface DocState {
  workspace: Workspace;
  pages: Record<string, Page>;
  diagrams: Record<string, Diagram>;
  activePageId: string | null;
  prefs: Prefs;
}

export interface PandaDrawEnvelope {
  format: 'pandadraw';
  version: 1;
  workspace: Workspace;
  pages: Page[];
  diagrams: Diagram[];
  exportedAt: string;
}
