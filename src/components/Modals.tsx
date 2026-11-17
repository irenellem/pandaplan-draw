import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useSession } from '../store/sessionStore';
import { BackupPanel } from './BackupPanel';

const SHORTCUTS: [string, string][] = [
  ['Space + drag / middle-drag', 'Pan'],
  ['Arrows (nothing selected)', 'Pan the view'],
  ['⌘/Ctrl + wheel, pinch', 'Zoom at cursor'],
  ['+  /  −  /  0  /  1', 'Zoom in / out / 100% / fit'],
  ['Drag on empty canvas', 'Box select (Shift adds)'],
  ['Shift + click', 'Add / remove from selection'],
  ['] / [  or  Tab', 'Select next / previous shape'],
  ['⌘/Ctrl + A', 'Select all'],
  ['Arrows (Shift = grid)', 'Nudge selection'],
  ['Alt + Arrows', 'Resize selection'],
  ['Enter / F2 / double-click', 'Edit label'],
  ['C (two shapes selected)', 'Connect first → second'],
  ['Drag from a port', 'Connect shapes'],
  ['Delete / Backspace', 'Delete selection'],
  ['⌘/Ctrl + D', 'Duplicate'],
  ['⌘/Ctrl + C / X / V', 'Copy / cut / paste'],
  ['⌘/Ctrl + Z, ⌘/Ctrl + Shift + Z', 'Undo / redo'],
  ['Alt while dragging', 'Bypass snap to grid'],
  ['Escape', 'Clear selection / cancel'],
  ['Sidebar: ↑ ↓ ← →, Enter, F2', 'Navigate, open, rename pages'],
  ['Sidebar: Alt + ↑/↓, ⌘/Ctrl + ] / [', 'Reorder, indent / outdent'],
  ['Sidebar: Shift + F10, Delete', 'Page menu, delete page'],
];

export function Modals() {
  const modal = useSession((s) => s.modal);
  const report = useSession((s) => s.importReport);
  const close = () => useSession.getState().openModal(null);
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!modal) return;
    opener.current = document.activeElement;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => (opener.current as HTMLElement | null)?.focus?.();
  }, [modal]);

  if (!modal) return null;
  const title =
    modal === 'shortcuts' ? 'Keyboard shortcuts' : modal === 'backup' ? 'Cloud backup' : 'Import complete';

  return (
    <div className="scrim" onClick={close}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <strong>{title}</strong>
          <button type="button" className="iconbtn plain" aria-label="Close" onClick={close}>
            <X size={15} />
          </button>
        </header>
        <div className="body-pad">
          {modal === 'shortcuts' && (
            <div className="keys">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <span className="kbd">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          )}
          {modal === 'backup' && <BackupPanel />}
          {modal === 'import-report' && report && (
            <>
              <dl className="kv">
                <dt>Folders</dt>
                <dd>{report.folders}</dd>
                <dt>Diagrams</dt>
                <dd>{report.diagrams}</dd>
                <dt>Shapes</dt>
                <dd>{report.nodes}</dd>
                <dt>Connectors</dt>
                <dd>{report.edges}</dd>
                <dt>Notes</dt>
                <dd>{report.notes}</dd>
              </dl>
              {report.warnings.length > 0 && (
                <ul className="warnlist">
                  {report.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
