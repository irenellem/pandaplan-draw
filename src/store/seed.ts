import { uid } from '../lib/ids';
import { createNode } from '../lib/shapeCatalog';
import type { DEdge, Diagram, DNode, DocState, Page, Prefs, Side } from '../types';

export function defaultPrefs(): Prefs {
  const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return {
    theme: dark ? 'dark' : 'light',
    sidebarWidth: 264,
    sidebarCollapsed: false,
    libraryCollapsed: false,
    drawerOpen: false,
    drawerWidth: 360,
    snapToGrid: true,
    pngBackground: 'white',
    expanded: {},
  };
}

export function emptyDiagram(id: string): Diagram {
  return { id, nodes: [], edges: [], note: '', defaultEdgeStyle: 'orthogonal', viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: Date.now() };
}

function edge(source: DNode, sourceSide: Side, target: DNode, targetSide: Side, label = ''): DEdge {
  return { id: uid('e'), source: source.id, target: target.id, sourceSide, targetSide, style: 'orthogonal', label, stroke: '#64748b', strokeWidth: 1.5 };
}

function welcomeDiagram(id: string): Diagram {
  const start = createNode('terminator', 120, 80, 1);
  const step = createNode('process', 120, 208, 2);
  step.label = 'Draw shapes';
  const check = createNode('decision', 120, 352, 3);
  check.label = 'Looks right?';
  const done = createNode('terminator', 120, 496, 4);
  done.label = 'Export';
  const sticky = createNode('sticky', 420, 136, 5);
  sticky.label = 'Double-click any shape to edit its text.\n\nPress ? for shortcuts.';
  const bar = createNode('gantt', 440, 352, 6);
  bar.label = 'Review';
  bar.start = 'Mon 3';
  bar.end = 'Fri 7';
  step.note = 'Node notes live here. Select a single node and open the notes drawer.';
  const edges = [
    edge(start, 's', step, 'n'),
    edge(step, 's', check, 'n'),
    edge(check, 's', done, 'n', 'yes'),
    edge(check, 'e', bar, 'w', 'no'),
  ];
  return {
    ...emptyDiagram(id),
    nodes: [start, step, check, done, sticky, bar],
    edges,
    note: [
      '# Welcome',
      '',
      'This drawer holds the **diagram note**, written in Markdown.',
      '',
      '- Switch between *Edit* and *Preview* at the top.',
      '- Select exactly one node to edit that node\'s note.',
      '- Everything saves to this browser automatically.',
    ].join('\n'),
    viewport: { x: 80, y: 40, zoom: 1 },
  };
}

export function seedState(): Omit<DocState, 'prefs'> {
  const now = Date.now();
  const folder: Page = { id: uid('p'), parentId: null, kind: 'folder', title: 'Getting started', position: 0, createdAt: now, updatedAt: now };
  const welcome: Page = { id: uid('p'), parentId: folder.id, kind: 'diagram', title: 'Welcome', position: 0, createdAt: now, updatedAt: now };
  return {
    workspace: { id: uid('w'), name: 'PandaPlan' },
    pages: { [folder.id]: folder, [welcome.id]: welcome },
    diagrams: { [welcome.id]: welcomeDiagram(welcome.id) },
    activePageId: welcome.id,
  };
}
