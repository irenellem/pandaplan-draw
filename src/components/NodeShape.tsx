import { memo } from 'react';
import type { DNode } from '../types';
import { labelBox, shapePrims, isCaptioned } from '../lib/shapes';
import { textOn } from '../lib/color';

type PaintAttrs = { fill?: string; stroke?: string; strokeWidth?: number; opacity?: number };

function paint(p: 'body' | 'line' | 'solid' | 'shade', n: DNode): PaintAttrs {
  switch (p) {
    case 'body':
      return { fill: n.style.fill, stroke: n.style.stroke, strokeWidth: n.style.strokeWidth };
    case 'line':
      return { fill: 'none', stroke: n.style.stroke, strokeWidth: n.style.strokeWidth };
    case 'solid':
      return { fill: n.style.stroke };
    case 'shade':
      return { fill: n.style.stroke, opacity: 0.18 };
  }
}

/** Screen rendering of one node — primitives come from lib/shapes so the SVG export matches. */
export const NodeShape = memo(function NodeShape({ node }: { node: DNode }) {
  const prims = shapePrims(node.kind, node.w, node.h);
  const box = labelBox(node.kind, node.w, node.h);
  const ink = textOn(node.style.fill);
  const isGantt = node.kind === 'gantt';
  const ganttH = node.h - 18;

  return (
    <g transform={`translate(${node.x} ${node.y})`} data-kind={node.kind}>
      {prims.map((p, i) => (
        <path key={i} d={p.d} {...paint(p.paint, node)} strokeLinejoin="round" />
      ))}
      {isGantt && (
        <text
          x={14}
          y={ganttH + 13}
          fontFamily="inherit"
          fontSize={9.5}
          fill={node.style.stroke}
          opacity={0.95}
        >
          {[node.start, node.end].filter(Boolean).join('  →  ')}
        </text>
      )}
      <foreignObject
        x={box.x}
        y={box.y}
        width={Math.max(4, box.w)}
        height={Math.max(4, box.h)}
        style={{ overflow: 'visible' }}
      >
        <div
          // xmlns keeps the HTML namespace explicit for the serializer
          {...{ xmlns: 'http://www.w3.org/1999/xhtml' }}
          className="node-text"
          style={{
            display: 'flex',
            alignItems: box.valign === 'top' ? 'flex-start' : 'center',
            justifyContent:
              node.style.align === 'center' ? 'center' : node.style.align === 'right' ? 'flex-end' : 'flex-start',
            width: '100%',
            height: '100%',
            padding: isCaptioned(node.kind) ? '0 2px' : '0 4px',
            color: ink,
            fontSize: node.style.fontSize,
            fontWeight: node.style.bold ? 700 : 500,
            lineHeight: 1.22,
            textAlign: node.style.align,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            fontFamily: 'inherit',
          }}
        >
          <span>{node.label}</span>
        </div>
      </foreignObject>
    </g>
  );
});
