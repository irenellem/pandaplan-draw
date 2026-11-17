import type { Page } from '../types';

export type PageMap = Record<string, Page>;

export function childrenOf(pages: PageMap, parentId: string | null): Page[] {
  return Object.values(pages)
    .filter((p) => p.parentId === parentId)
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

export function descendants(pages: PageMap, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const c of childrenOf(pages, cur)) {
      out.push(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

export function ancestors(pages: PageMap, id: string): Page[] {
  const out: Page[] = [];
  const seen = new Set<string>();
  let cur = pages[id]?.parentId ?? null;
  while (cur && pages[cur] && !seen.has(cur)) {
    seen.add(cur);
    out.unshift(pages[cur]);
    cur = pages[cur].parentId;
  }
  return out;
}

export function nextPosition(pages: PageMap, parentId: string | null): number {
  const sibs = childrenOf(pages, parentId);
  return sibs.length ? sibs[sibs.length - 1].position + 1 : 0;
}

/** Folders a page may be moved into (not itself, not its own descendants). */
export function moveTargets(pages: PageMap, id: string): Page[] {
  const banned = new Set([id, ...descendants(pages, id)]);
  return Object.values(pages)
    .filter((p) => p.kind === 'folder' && !banned.has(p.id))
    .sort((a, b) => pathLabel(pages, a.id).localeCompare(pathLabel(pages, b.id)));
}

export function pathLabel(pages: PageMap, id: string): string {
  return [...ancestors(pages, id), pages[id]].map((p) => p?.title ?? '').join(' / ');
}

/** Ids visible under a search query: every match plus its ancestors. null = no filter. */
export function searchVisible(pages: PageMap, query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const visible = new Set<string>();
  for (const p of Object.values(pages)) {
    if (p.title.toLowerCase().includes(q)) {
      visible.add(p.id);
      for (const a of ancestors(pages, p.id)) visible.add(a.id);
    }
  }
  return visible;
}

/** Tree integrity problems (dangling parents, non-folder parents, cycles). */
export function treeProblems(pages: PageMap): string[] {
  const problems: string[] = [];
  for (const p of Object.values(pages)) {
    if (p.parentId !== null) {
      const parent = pages[p.parentId];
      if (!parent) problems.push(`${p.id}: missing parent ${p.parentId}`);
      else if (parent.kind !== 'folder') problems.push(`${p.id}: parent ${p.parentId} is not a folder`);
    }
    const seen = new Set<string>([p.id]);
    let cur = p.parentId;
    while (cur && pages[cur]) {
      if (seen.has(cur)) {
        problems.push(`${p.id}: cycle`);
        break;
      }
      seen.add(cur);
      cur = pages[cur].parentId;
    }
  }
  return problems;
}

export function firstDiagram(pages: PageMap): Page | null {
  const walk = (parentId: string | null): Page | null => {
    for (const c of childrenOf(pages, parentId)) {
      if (c.kind === 'diagram') return c;
      const inner = walk(c.id);
      if (inner) return inner;
    }
    return null;
  };
  return walk(null);
}
