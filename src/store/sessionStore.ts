import { create } from 'zustand';
import type { ImportReport } from '../lib/pandadraw';
import type { DEdge, DNode } from '../types';

/** UI state that is not saved: selection, inline editing, clipboard, toasts, modals. */
export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

export type Editing = { type: 'node' | 'edge'; id: string } | null;
export type ModalId = 'shortcuts' | 'import-report' | 'backup' | null;

interface SessionState {
  selectedNodes: string[];
  selectedEdges: string[];
  editing: Editing;
  clipboard: { nodes: DNode[]; edges: DEdge[] } | null;
  toasts: Toast[];
  modal: ModalId;
  importReport: ImportReport | null;
  search: string;
  select: (nodes: string[], edges?: string[]) => void;
  clearSelection: () => void;
  setEditing: (e: Editing) => void;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  openModal: (m: ModalId) => void;
}

let toastSeq = 0;

export const useSession = create<SessionState>()((set) => ({
  selectedNodes: [],
  selectedEdges: [],
  editing: null,
  clipboard: null,
  toasts: [],
  modal: null,
  importReport: null,
  search: '',
  select: (nodes, edges = []) => set({ selectedNodes: nodes, selectedEdges: edges }),
  clearSelection: () => set({ selectedNodes: [], selectedEdges: [], editing: null }),
  setEditing: (editing) => set({ editing }),
  toast: (message, tone = 'info') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }));
    window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 6000 : 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openModal: (modal) => set({ modal }),
}));
