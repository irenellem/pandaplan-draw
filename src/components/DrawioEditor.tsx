import { useEffect, useRef } from 'react';
import { connectDrawio, DRAWIO_PATH, DRAWIO_SRC, INIT_TIMEOUT_MS, type DrawioLink } from '../lib/drawioProtocol';

interface Props {
  name: string;
  xml: string;
  onChange(xml: string, immediate: boolean): void;
  onExit(): void;
  /** The /drawio/ page finished loading but sent no `init` within INIT_TIMEOUT_MS. */
  onTimeout(): void;
  linkRef: { current: DrawioLink | null };
}

/** Full-bleed draw.io iframe. Remounted (via `key`) for every file that is opened. */
export function DrawioEditor({ name, xml, onChange, onExit, onTimeout, linkRef }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ name, xml, onChange, onExit, onTimeout });
  latest.current = { name, xml, onChange, onExit, onTimeout };

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let timer: number | undefined;
    const link = connectDrawio(el, {
      onInit: () => {
        window.clearTimeout(timer);
        return latest.current.xml;
      },
      title: () => latest.current.name,
      onAutosave: (x) => latest.current.onChange(x, false),
      onSave: (x) => {
        latest.current.onChange(x, true);
        // Not "Saved": the PUT has not happened yet. The saved-work panel shows the real outcome.
        link.send({ action: 'status', message: '', modified: false });
      },
      onExit: () => latest.current.onExit(),
    });
    // The clock starts at the frame's `load` event, not at mount: a cold-cache download of the
    // multi-MB draw.io bundle must not be mistaken for a missing editor. `init` may also arrive
    // before `load` (draw.io starts before its last images finish), which `link.ready` covers.
    const onLoad = () => {
      window.clearTimeout(timer);
      if (link.ready) return;
      timer = window.setTimeout(() => {
        if (!link.ready) latest.current.onTimeout();
      }, INIT_TIMEOUT_MS);
    };
    el.addEventListener('load', onLoad);
    linkRef.current = link;
    return () => {
      el.removeEventListener('load', onLoad);
      window.clearTimeout(timer);
      link.dispose();
      if (linkRef.current === link) linkRef.current = null;
    };
  }, [linkRef]);

  return <iframe ref={frame} className="sw-frame" src={DRAWIO_SRC} title={`draw.io editor: ${name}`} />;
}

/** Shown when /drawio/ is missing (404, SPA fallback) or loaded but sent no init within 8 s of `load`. */
export function EditorPlaceholder({ reason, onRetry }: { reason: string | null; onRetry(): void }) {
  return (
    <div className="sw-placeholder" role="status">
      <h2>The draw.io editor is not available</h2>
      <p>
        Expected the self-hosted drawio webapp at <code>{DRAWIO_PATH}</code> on this origin, loaded as
      </p>
      <p>
        <code className="sw-src">{DRAWIO_SRC}</code>
      </p>
      {reason && <p className="sw-reason">Reason: {reason}</p>}
      <p>The saved-work folder on the left still works: you can see, rename and delete files.</p>
      <button type="button" className="btn" onClick={onRetry}>
        Check again
      </button>
    </div>
  );
}
