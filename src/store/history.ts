import type { DEdge, DNode } from '../types';

/**
 * Undo/redo for each diagram, kept in memory. Snapshots share structure: actions create new arrays and
 * objects instead of mutating, so a snapshot is two array references.
 */
export interface Snapshot {
  nodes: DNode[];
  edges: DEdge[];
}

export const HISTORY_LIMIT = 100;

export class HistoryStack {
  past: Snapshot[] = [];
  future: Snapshot[] = [];
  constructor(private limit = HISTORY_LIMIT) {}

  push(s: Snapshot): void {
    this.past.push(s);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.future = [];
  }

  undo(current: Snapshot): Snapshot | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }
}

const stacks = new Map<string, HistoryStack>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version++;
  listeners.forEach((l) => l());
}

function stack(id: string): HistoryStack {
  let s = stacks.get(id);
  if (!s) {
    s = new HistoryStack();
    stacks.set(id, s);
  }
  return s;
}

export const history = {
  push(id: string, snap: Snapshot) {
    stack(id).push(snap);
    bump();
  },
  undo(id: string, current: Snapshot): Snapshot | null {
    const r = stack(id).undo(current);
    bump();
    return r;
  },
  redo(id: string, current: Snapshot): Snapshot | null {
    const r = stack(id).redo(current);
    bump();
    return r;
  },
  canUndo: (id: string | null) => !!id && (stacks.get(id)?.past.length ?? 0) > 0,
  canRedo: (id: string | null) => !!id && (stacks.get(id)?.future.length ?? 0) > 0,
  drop(id: string) {
    stacks.delete(id);
    bump();
  },
  version: () => version,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
