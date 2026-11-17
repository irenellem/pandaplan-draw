import { useEffect, useRef, useState } from 'react';
import { connectDrawio, DRAWIO_SRC, INIT_TIMEOUT_MS, type DrawioLink } from '../lib/drawioProtocol';
import { noteFrame, noteInit, noteUsable } from '../lib/perf';
import { SLOW_AFTER_MS, SLOW_TEXT, stageText } from '../lib/warmup';

/** The file a frame shows. A frame gets one file in its life (one `load`), never a second one. */
export interface EditorFile {
  token: number;
  name: string;
  xml: string;
}

interface Props {
  /** null = warm spare: the frame boots hidden behind the empty state and waits for a file. */
  file: EditorFile | null;
  onChange(xml: string, immediate: boolean): void;
  onExit(): void;
  /** The /drawio/ page finished loading but sent no `init` within INIT_TIMEOUT_MS. */
  onTimeout(): void;
  linkRef: { current: DrawioLink | null };
}

/** If draw.io never sends its `load` event, stop covering the canvas this long after `load` was sent. */
const SKELETON_FALLBACK_MS = 4000;

/**
 * Full-bleed draw.io iframe. App keys it per frame, not per file: a spare frame mounted with
 * `file={null}` is adopted by the next file opened (its single deferred `load`), and every other
 * open gets a new frame, as before. A frame never switches from one file to another, so a late
 * `autosave` from one diagram can never be stored under another.
 */
export function DrawioEditor({ file, onChange, onExit, onTimeout, linkRef }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const link = useRef<DrawioLink | null>(null);
  const bornAt = useRef(typeof performance === 'undefined' ? 0 : performance.now());
  const startedWithFile = useRef(file !== null);
  const [booted, setBooted] = useState(false);
  const [loadSent, setLoadSent] = useState(false);
  const [usable, setUsable] = useState(false);
  const [slow, setSlow] = useState(false);
  const latest = useRef({ file, onChange, onExit, onTimeout });
  latest.current = { file, onChange, onExit, onTimeout };
  const token = file?.token ?? null;

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let timer: number | undefined;
    const l = connectDrawio(el, {
      onInit: () => {
        window.clearTimeout(timer);
        setBooted(true);
        const f = latest.current.file;
        if (!f) return null; // spare: hold the load until a file is assigned
        noteInit();
        setLoadSent(true);
        return f.xml;
      },
      onLoaded: () => {
        if (!latest.current.file) return;
        setUsable(true);
        noteUsable();
      },
      title: () => latest.current.file?.name ?? '',
      // A spare has no file and draw.io sends no autosave before `load`; guard anyway.
      onAutosave: (x) => {
        if (latest.current.file) latest.current.onChange(x, false);
      },
      onSave: (x) => {
        if (!latest.current.file) return;
        latest.current.onChange(x, true);
        // Not "Saved": the PUT has not happened yet. The saved-work panel shows the real outcome.
        l.send({ action: 'status', message: '', modified: false });
      },
      onExit: () => {
        if (latest.current.file) latest.current.onExit();
      },
    });
    link.current = l;
    // The clock starts at the frame's `load` event, not at mount: a cold-cache download of the
    // multi-MB draw.io bundle must not be mistaken for a missing editor. `init` may also arrive
    // before `load` (draw.io starts before its last images finish), which `l.ready` covers.
    const onLoad = () => {
      window.clearTimeout(timer);
      if (l.ready) return;
      timer = window.setTimeout(() => {
        if (!l.ready) latest.current.onTimeout();
      }, INIT_TIMEOUT_MS);
    };
    el.addEventListener('load', onLoad);
    return () => {
      el.removeEventListener('load', onLoad);
      window.clearTimeout(timer);
      l.dispose();
      link.current = null;
      if (linkRef.current === l) linkRef.current = null;
    };
  }, [linkRef]);

  // A file arrives: at mount (fresh frame) or later (a spare being adopted). Runs after the effect above.
  useEffect(() => {
    const l = link.current;
    const f = latest.current.file;
    if (token === null || !l || !f) return;
    noteFrame(bornAt.current, l.ready, !startedWithFile.current);
    linkRef.current = l; // Print / export talk to the frame that holds the open file, never to a spare
    if (l.load(f.xml)) setLoadSent(true); // already booted; otherwise `onInit` sends it
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(slowTimer);
  }, [token, linkRef]);

  useEffect(() => {
    if (!loadSent || usable) return;
    const t = window.setTimeout(() => setUsable(true), SKELETON_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [loadSent, usable]);

  return (
    <div className={`sw-frame-wrap${file ? '' : ' spare'}`} aria-hidden={file ? undefined : true}>
      {file && !usable && (
        <div className="sw-skeleton" role="status" aria-live="polite">
          <div className="sw-skel-bar" />
          <div className="sw-skel-side" />
          <div className="sw-skel-canvas">
            <p className="sw-skel-stage">
              {stageText(booted ? 'opening' : 'preparing', file.name)}
              {slow && <span>{SLOW_TEXT}</span>}
            </p>
          </div>
        </div>
      )}
      <iframe
        ref={frame}
        className="sw-frame"
        src={DRAWIO_SRC}
        tabIndex={file ? undefined : -1}
        title={file ? `draw.io editor: ${file.name}` : 'draw.io editor (getting ready)'}
      />
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
