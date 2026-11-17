import { create, type StoreApi } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Diagram, DocState } from '../types';
import { diagramActions, type DiagramActions } from './diagramActions';
import { pageActions, type PageActions } from './pageActions';
import { createDebouncedStorage } from './persistStorage';
import { defaultPrefs, seedState } from './seed';

export const STORAGE_KEY = 'pandadraw.v1';
export const SCHEMA_VERSION = 1;

export type DocStore = DocState & PageActions & DiagramActions;
export type SetDoc = StoreApi<DocStore>['setState'];
export type GetDoc = StoreApi<DocStore>['getState'];

type Persisted = DocState;

export const useDoc = create<DocStore>()(
  persist(
    (set, get) => ({
      ...seedState(),
      prefs: defaultPrefs(),
      ...pageActions(set, get),
      ...diagramActions(set, get),
    }),
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createDebouncedStorage<Persisted>(300),
      partialize: (s): Persisted => ({
        workspace: s.workspace,
        pages: s.pages,
        diagrams: s.diagrams,
        activePageId: s.activePageId,
        prefs: s.prefs,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Persisted>;
        if (!p.pages || typeof p.pages !== 'object' || !p.diagrams || typeof p.diagrams !== 'object') return current;
        return {
          ...current,
          workspace: p.workspace ?? current.workspace,
          pages: p.pages,
          diagrams: p.diagrams,
          activePageId: p.activePageId ?? null,
          prefs: { ...current.prefs, ...(p.prefs ?? {}) },
        };
      },
    },
  ),
);

export function activeDiagram(s: Pick<DocState, 'activePageId' | 'diagrams'>): Diagram | null {
  return s.activePageId ? (s.diagrams[s.activePageId] ?? null) : null;
}

export const useActiveDiagram = () => useDoc((s) => activeDiagram(s));
