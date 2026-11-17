import { useEffect, useRef, useState } from 'react';
import { connectDrawio, DRAWIO_SRC, INIT_TIMEOUT_MS, type DrawioLink } from '../lib/drawioProtocol';

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
  const [ready, setReady] = useState(false);
  const latest = useRef({ name, xml, onChange, onExit, onTimeout });
  latest.current = { name, xml, onChange, onExit, onTimeout };

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let timer: number | undefined;
    const link = connectDrawio(el, {
      onInit: () => {
        window.clearTimeout(timer);
        setReady(true);
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

  return (
    <div className="sw-frame-wrap">
      {!ready && (
        <div className="sw-loading" role="status">
          Loading the drawing editor…
          <span>The first load of a new session takes a few seconds.</span>
        </div>
      )}
      <iframe ref={frame} className="sw-frame" src={DRAWIO_SRC} title={`draw.io editor: ${name}`} />
    </div>
  );
}

/** Shown when /drawio/ is missing (404, SPA fallback) or loaded but never sent `init`. */
export function EditorPlaceholder({ reason, onRetry }: { reason: string | null; onRetry(): void }) {
  return (
    <div className="sw-placeholder" role="status">
      <h2>The drawing editor did not load</h2>
      <p>Press “Check again”, or reload the page. If it keeps happening, tell the PandaPlan admin and quote the details below.</p>
      <p>Your saved diagrams are safe: the saved-work folder still lists, renames and deletes them.</p>
      <button type="button" className="btn" onClick={onRetry}>
        Check again
      </button>
      <p className="sw-reason">
        Details for the admin: {reason ?? 'no reason given'} · expected <code className="sw-src">{DRAWIO_SRC}</code>
      </p>
    </div>
  );
}
