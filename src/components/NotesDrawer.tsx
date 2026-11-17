import { X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useActiveDiagram, useDoc } from '../store/docStore';
import { useSession } from '../store/sessionStore';
import { renderMarkdown, wordCount } from '../lib/markdown';

const MIN_W = 260;
const MAX_W = 720;

/** Markdown notes for the diagram, or for the single selected node. */
export function NotesDrawer() {
  const diagram = useActiveDiagram();
  const width = useDoc((s) => s.prefs.drawerWidth);
  const selected = useSession((s) => s.selectedNodes);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const drag = useRef<{ x: number; w: number } | null>(null);
  const st = useDoc.getState();

  const node = diagram && selected.length === 1 ? diagram.nodes.find((n) => n.id === selected[0]) : undefined;
  const text = node ? (node.note ?? '') : (diagram?.note ?? '');
  const html = useMemo(() => (mode === 'preview' ? renderMarkdown(text) : ''), [mode, text]);
  if (!diagram) return null;

  const setW = (w: number) => st.setPrefs({ drawerWidth: Math.round(Math.min(MAX_W, Math.max(MIN_W, w))) });

  return (
    <aside className="drawer" style={{ width, position: 'relative' }} aria-label="Notes">
      <div
        className="grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize notes drawer"
        aria-valuemin={MIN_W}
        aria-valuemax={MAX_W}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setW(width + 20);
          if (e.key === 'ArrowRight') setW(width - 20);
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => drag.current && setW(drag.current.w + drag.current.x - e.clientX)}
        onPointerUp={() => (drag.current = null)}
      />
      <div className="drawer-head">
        <div className="seg" role="group" aria-label="Notes mode">
          <button type="button" className={mode === 'edit' ? 'on' : ''} aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
            Edit
          </button>
          <button type="button" className={mode === 'preview' ? 'on' : ''} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>
            Preview
          </button>
        </div>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink-2)', fontSize: 12 }}>
          {node ? `Node: ${node.label || node.kind}` : 'Diagram note'}
        </span>
        <button type="button" className="iconbtn plain" aria-label="Close notes" title="Close notes" onClick={() => st.setPrefs({ drawerOpen: false })}>
          <X size={15} />
        </button>
      </div>
      <div className="drawer-body">
        {mode === 'edit' ? (
          <textarea
            key={node?.id ?? 'diagram'}
            className="note-editor"
            aria-label={node ? 'Node note (Markdown)' : 'Diagram note (Markdown)'}
            placeholder={node ? 'Notes for this shape, in Markdown…' : 'Notes for this diagram, in Markdown…'}
            value={text}
            onChange={(e) => (node ? st.setNodeNote(node.id, e.target.value) : st.setDiagramNote(e.target.value))}
          />
        ) : text.trim() ? (
          <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="md" style={{ color: 'var(--ink-3)' }}>
            Nothing written yet.
          </div>
        )}
      </div>
      <div className="drawer-foot">
        <span>{wordCount(text)} words</span>
        <span style={{ marginLeft: 'auto' }}>{node ? 'Select nothing to edit the diagram note' : 'Select one shape for its own note'}</span>
      </div>
    </aside>
  );
}
