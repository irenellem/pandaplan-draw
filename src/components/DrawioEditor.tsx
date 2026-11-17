import { useEffect, useRef, useState } from 'react';
import { connectDrawio, DRAWIO_SRC, INIT_TIMEOUT_MS, type DrawioLink } from '../lib/drawioProtocol';
import { noteFrame, noteInit, noteUsable } from '../lib/perf';
import { SLOW_AFTER_MS, SLOW_TEXT, stageText } from '../lib/warmup';

/** The file the frame should show. A new `token` = a new `load` into the same frame. */
export interface EditorFile {
  token: number;
  name: string;
  xml: string;
}

interface Props {
  /** null = nothing to show: a warm spare booting, or the last file was closed. */
  file: EditorFile | null;
  /** Title of a file whose XML is still on its way (the frame is covered meanwhile). */
  waiting: string | null;
  onChange(xml: string, immediate: boolean): void;
  onExit(): void;
  /** The /drawio/ page finished loading but sent no `init` within INIT_TIMEOUT_MS. */
  onTimeout(): void;
  linkRef: { current: DrawioLink | null };
}

/** If draw.io never sends its `load` event, stop covering the canvas this long after `load` was sent. */
const SKELETON_FALLBACK_MS = 4000;
/** A warm swap is covered by a plain veil; only if it takes longer than this does the veil say why. */
const VEIL_TEXT_AFTER_MS = 400;

/**
 * Full-bleed draw.io iframe, one per page. App keys it once: every file opened is a `load` into this
 * same frame (the protocol's fence keeps one diagram's late `autosave` from being stored as another).
 *
 * While a file is on its way the canvas is covered, so the previous diagram never flashes:
 *  - frame cold (draw.io not started): the canvas skeleton with its stage line;
 *  - frame warm: a plain veil the colour of the canvas, normally gone within a frame or two. The
 *    skeleton is never shown over a warm frame.
 */
export function DrawioEditor({ file, waiting, onChange, onExit, onTimeout, linkRef }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const link = useRef<DrawioLink | null>(null);
  const bornAt = useRef(typeof performance === 'undefined' ? 0 : performance.now());
  const hadFile = useRef(false);
  const [booted, setBooted] = useState(false);
  /** Token of the last `load` sent, and of the last one draw.io answered (= on screen). */
  const [sentToken, setSentToken] = useState<number | null>(null);
  const [shownToken, setShownToken] = useState<number | null>(null);
  /** Was draw.io already running when the current file was handed over? Picks veil vs skeleton. */
  const [warmAtAssign, setWarmAtAssign] = useState(false);
  const [slow, setSlow] = useState(false);
  const [veilText, setVeilText] = useState(false);
  const latest = useRef({ file, onChange, onExit, onTimeout });
  latest.current = { file, onChange, onExit, onTimeout };
  const token = file?.token ?? null;

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let timer: number | undefined;
    const l: DrawioLink = connectDrawio(el, {
      onInit: () => {
        window.clearTimeout(timer);
        setBooted(true);
        const f = latest.current.file;
        if (!f) return null; // spare: hold the load until a file is assigned
        noteInit();
        setSentToken(f.token);
        return f.xml;
      },
      onLoaded: () => {
        const f = latest.current.file;
        // Several loads in flight (quick clicks): only the answer to the last one reveals the canvas.
        if (!f || l.fenced) return;
        setShownToken(f.token);
        noteUsable();
      },
      title: () => latest.current.file?.name ?? '',
      // The protocol already drops anything between a `load` and draw.io's answer to it.
      onAutosave: (x) => {
        if (latest.current.file) latest.current.onChange(x, false);
      },
      onSave: (x) => {
        if (!latest.current.file) return;
        latest.current.onChange(x, true);
        // Not "Saved": the PUT has not happened yet. The file bar shows the real outcome.
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

  // A file arrives: the first one into a spare, or the next one into a frame that showed another.
  useEffect(() => {
    const l = link.current;
    const f = latest.current.file;
    if (token === null || !l || !f) return;
    noteFrame(bornAt.current, l.ready, hadFile.current);
    hadFile.current = true;
    linkRef.current = l; // Print / export talk to the frame holding the open file
    setWarmAtAssign(l.ready);
    setSlow(false);
    if (l.load(f.xml)) setSentToken(token); // not started yet: `onInit` sends it
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(slowTimer);
  }, [token, linkRef]);

  // Never trap the canvas: if draw.io does not answer a load, uncover it anyway.
  useEffect(() => {
    if (sentToken === null || sentToken === shownToken) return;
    const t = window.setTimeout(() => setShownToken(sentToken), SKELETON_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [sentToken, shownToken]);

  const covering = waiting !== null || (file !== null && shownToken !== file.token);
  const coverTitle = waiting ?? file?.name ?? '';
  // Warm = draw.io is running. While XML is still on its way that is all that matters; for a
  // handed-over file, whether it was running at the hand-over.
  const warm = booted && (waiting !== null || warmAtAssign);

  useEffect(() => {
    setVeilText(false);
    if (!covering || !warm) return;
    const t = window.setTimeout(() => setVeilText(true), VEIL_TEXT_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [covering, warm, coverTitle]);

  const idle = file === null && waiting === null;

  return (
    <div className={`sw-frame-wrap${idle ? ' spare' : ''}`} aria-hidden={idle ? true : undefined} data-shown={shownToken ?? ''}>
      {covering &&
        (warm ? (
          <div className="sw-veil" role="status" aria-live="polite">
            {veilText && <p className="sw-skel-stage">{stageText('opening', coverTitle)}</p>}
          </div>
        ) : (
          <div className="sw-skeleton" role="status" aria-live="polite">
            <div className="sw-skel-bar" />
            <div className="sw-skel-side" />
            <div className="sw-skel-canvas">
              <p className="sw-skel-stage">
                {stageText(booted ? 'opening' : 'preparing', coverTitle)}
                {slow && <span>{SLOW_TEXT}</span>}
              </p>
            </div>
          </div>
        ))}
      <iframe
        ref={frame}
        className="sw-frame"
        src={DRAWIO_SRC}
        tabIndex={idle ? -1 : undefined}
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
      <p>Your saved diagrams are safe: the file list still lists, renames and deletes them.</p>
      <button type="button" className="btn" onClick={onRetry}>
        Check again
      </button>
      <p className="sw-reason">
        Details for the admin: {reason ?? 'no reason given'} · expected <code className="sw-src">{DRAWIO_SRC}</code>
      </p>
    </div>
  );
}
