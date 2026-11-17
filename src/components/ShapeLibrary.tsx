import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { SHAPE_GROUPS, type ShapeDef } from '../lib/shapeCatalog';
import { shapePrims } from '../lib/shapes';
import { useDoc } from '../store/docStore';
import { canvasApi, SHAPE_MIME } from './Canvas';

/** Miniature drawn with the same primitives as the canvas, scaled into a 40×28 box. */
function ShapeIcon({ def }: { def: ShapeDef }) {
  const W = 40;
  const H = 28;
  const k = Math.min((W - 4) / def.w, (H - 4) / def.h);
  const prims = shapePrims(def.kind, def.w, def.h);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <g transform={`translate(${(W - def.w * k) / 2} ${(H - def.h * k) / 2}) scale(${k})`}>
        {prims.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill={p.paint === 'body' ? 'var(--panel)' : p.paint === 'line' ? 'none' : 'currentColor'}
            fillOpacity={p.paint === 'shade' ? 0.2 : 1}
            stroke={p.paint === 'body' || p.paint === 'line' ? 'currentColor' : 'none'}
            strokeWidth={1.4 / k}
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}

/** Grouped palette. Drag a tile onto the canvas, or click / press Enter to insert it at the viewport centre. */
export function ShapeLibrary() {
  const collapsed = useDoc((s) => s.prefs.libraryCollapsed);
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  return (
    <nav className={`library${collapsed ? ' collapsed' : ''}`} aria-label="Shape library">
      {SHAPE_GROUPS.map((g) => {
        const open = !closed[g.id];
        return (
          <div key={g.id} className="lib-group">
            <button type="button" aria-expanded={open} onClick={() => setClosed((c) => ({ ...c, [g.id]: open }))}>
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {g.name}
            </button>
            {open && (
              <div className="lib-grid">
                {g.shapes.map((s) => (
                  <button
                    key={s.kind}
                    type="button"
                    className="lib-item"
                    draggable
                    title={`${s.name} — drag onto the canvas, or click to insert`}
                    aria-label={`Insert ${s.name}`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(SHAPE_MIME, s.kind);
                      e.dataTransfer.setData('text/plain', s.name);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => {
                      canvasApi.insert(s.kind);
                      canvasApi.focus();
                    }}
                  >
                    <ShapeIcon def={s} />
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
