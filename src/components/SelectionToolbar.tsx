import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Bold, Copy, Trash2, Type } from 'lucide-react';
import type { EdgeStyle } from '../types';
import { useActiveDiagram, useDoc } from '../store/docStore';
import { useSession } from '../store/sessionStore';
import { FILL_SWATCHES, FONT_SIZES, STROKE_SWATCHES, STROKE_WIDTHS } from '../lib/color';

const EDGE_STYLES: { id: EdgeStyle; name: string }[] = [
  { id: 'orthogonal', name: 'Elbow' },
  { id: 'straight', name: 'Straight' },
  { id: 'bezier', name: 'Curved' },
];

/** Floating style bar for the current selection. Every control is a native button/select, so it is keyboard reachable. */
export function SelectionToolbar() {
  const diagram = useActiveDiagram();
  const nodeIds = useSession((s) => s.selectedNodes);
  const edgeIds = useSession((s) => s.selectedEdges);
  const st = useDoc.getState();
  if (!diagram) return null;
  const nodes = diagram.nodes.filter((n) => nodeIds.includes(n.id));
  const edges = diagram.edges.filter((e) => edgeIds.includes(e.id));
  const first = nodes[0];
  const firstEdge = edges[0];

  const remove = () => {
    if (edges.length) {
      const nodeSet = new Set(nodeIds);
      const loose = edges.filter((e) => !nodeSet.has(e.source) && !nodeSet.has(e.target)).map((e) => e.id);
      if (loose.length) st.removeEdges(loose);
    }
    if (nodeIds.length) st.removeNodes(nodeIds);
  };

  return (
    <div className="seltools pd-ui" role="toolbar" aria-label="Selection style" onPointerDown={(e) => e.stopPropagation()}>
      <span className="count">
        {nodes.length ? `${nodes.length} shape${nodes.length === 1 ? '' : 's'}` : ''}
        {nodes.length && edges.length ? ' · ' : ''}
        {edges.length ? `${edges.length} connector${edges.length === 1 ? '' : 's'}` : ''}
      </span>

      {first && (
        <>
          <span className="mini-sep" />
          <div className="swatches" role="group" aria-label="Fill colour">
            {FILL_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${c === 'transparent' ? ' none' : ''}`}
                style={c === 'transparent' ? undefined : { background: c, outline: first.style.fill === c ? '2px solid var(--accent)' : undefined }}
                title={`Fill ${c}`}
                aria-label={`Fill ${c}`}
                onClick={() => st.patchStyle(nodeIds, { fill: c })}
              />
            ))}
          </div>
          <span className="mini-sep" />
          <div className="swatches" role="group" aria-label="Border colour">
            {STROKE_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                style={{ background: 'var(--panel)', boxShadow: `inset 0 0 0 3px ${c}`, outline: first.style.stroke === c ? '2px solid var(--accent)' : undefined }}
                title={`Border ${c}`}
                aria-label={`Border ${c}`}
                onClick={() => st.patchStyle(nodeIds, { stroke: c })}
              />
            ))}
          </div>
          <select className="numsel" aria-label="Border width" value={first.style.strokeWidth} onChange={(e) => st.patchStyle(nodeIds, { strokeWidth: Number(e.target.value) })}>
            {STROKE_WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </select>
          <span className="mini-sep" />
          <Type size={14} aria-hidden style={{ color: 'var(--ink-3)' }} />
          <select className="numsel" aria-label="Font size" value={first.style.fontSize} onChange={(e) => st.patchStyle(nodeIds, { fontSize: Number(e.target.value) })}>
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" className={`iconbtn plain${first.style.bold ? ' on' : ''}`} title="Bold" aria-pressed={first.style.bold} onClick={() => st.patchStyle(nodeIds, { bold: !first.style.bold })}>
            <Bold size={15} />
          </button>
          {(['left', 'center', 'right'] as const).map((a) => {
            const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
            return (
              <button key={a} type="button" className={`iconbtn plain${first.style.align === a ? ' on' : ''}`} title={`Align text ${a}`} aria-pressed={first.style.align === a} onClick={() => st.patchStyle(nodeIds, { align: a })}>
                <Icon size={15} />
              </button>
            );
          })}
          <span className="mini-sep" />
          <button type="button" className="iconbtn plain" title="Bring to front" onClick={() => st.bringToFront(nodeIds)}>
            <ArrowUpToLine size={15} />
          </button>
          <button type="button" className="iconbtn plain" title="Send to back" onClick={() => st.sendToBack(nodeIds)}>
            <ArrowDownToLine size={15} />
          </button>
          <button type="button" className="iconbtn plain" title="Duplicate (⌘/Ctrl+D)" onClick={() => st.duplicateSelection()}>
            <Copy size={15} />
          </button>
        </>
      )}

      {firstEdge && (
        <>
          <span className="mini-sep" />
          <div className="seg" role="group" aria-label="Connector style">
            {EDGE_STYLES.map((s) => (
              <button key={s.id} type="button" className={firstEdge.style === s.id ? 'on' : ''} aria-pressed={firstEdge.style === s.id} onClick={() => st.patchEdges(edgeIds, { style: s.id })}>
                {s.name}
              </button>
            ))}
          </div>
          <div className="swatches" role="group" aria-label="Connector colour">
            {['#64748b', ...STROKE_SWATCHES.slice(1)].map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                style={{ background: c, outline: firstEdge.stroke === c ? '2px solid var(--accent)' : undefined }}
                title={`Connector ${c}`}
                aria-label={`Connector ${c}`}
                onClick={() => st.patchEdges(edgeIds, { stroke: c })}
              />
            ))}
          </div>
          <select className="numsel" aria-label="Connector width" value={firstEdge.strokeWidth} onChange={(e) => st.patchEdges(edgeIds, { strokeWidth: Number(e.target.value) })}>
            {STROKE_WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </select>
          {edges.length === 1 && !nodes.length && (
            <button type="button" className="btn sm ghost" onClick={() => useSession.getState().setEditing({ type: 'edge', id: firstEdge.id })}>
              Label
            </button>
          )}
        </>
      )}

      <span className="mini-sep" />
      <button type="button" className="iconbtn plain" title="Delete (Del)" aria-label="Delete selection" onClick={remove} style={{ color: 'var(--danger)' }}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}
