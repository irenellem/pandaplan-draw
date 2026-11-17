import { toPng } from 'html-to-image';
import type { DNode } from '../types';
import { boundsOf } from './geometry';

/**
 * PNG export at 2x using html-to-image on the transformed canvas layer. The layer is re-framed to the
 * content bounds, and editor chrome (ports, resize handles, selection rings) is filtered out by the
 * `pd-ui` class. skipFonts keeps it offline: we only use system fonts.
 */
export async function exportPng(layer: HTMLElement, nodes: DNode[], background: 'white' | 'transparent'): Promise<string> {
  const b = boundsOf(nodes);
  if (!b) throw new Error('Nothing to export: the diagram is empty.');
  const pad = 32;
  const x = b.x - pad - 20;
  const y = b.y - pad;
  const width = Math.ceil(b.w + pad * 2 + 40);
  const height = Math.ceil(b.h + pad * 2);
  return toPng(layer, {
    width,
    height,
    pixelRatio: 2,
    skipFonts: true,
    backgroundColor: background === 'white' ? '#ffffff' : undefined,
    style: {
      transform: `translate(${-x}px, ${-y}px) scale(1)`,
      transformOrigin: '0 0',
      width: `${width}px`,
      height: `${height}px`,
    },
    filter: (node: HTMLElement) => !(node instanceof Element && node.classList.contains('pd-ui')),
  });
}
