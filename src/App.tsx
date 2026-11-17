import { ChevronLeft, FilePlus2, Folder, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DrawioEditor, EditorPlaceholder } from './components/DrawioEditor';
import { MoveSelect, SavedWorkPanel, saveStatusText, when, type SaveState } from './components/SavedWorkPanel';
import { blankXml } from './lib/drawioFile';
import { INIT_TIMEOUT_MS, probeDrawio, type DrawioLink } from './lib/drawioProtocol';
import { nextSlot, type Slot } from './lib/editorSlot';
import { beginOpen } from './lib/perf';
import { prefetchDrawio, warmupAllowed, whenIdle } from './lib/warmup';
import { downloadText, titleFilename } from './lib/download';
import {
  clampTitle,
  deleteEntry,
  entryId,
  listEntries,
  localFolders,
  pretty,
  readXml,
  saveXml,
  setLocalFolders,
  titleOf,
  tombstone,
  uniqueSlug,
  type Entry,
  type Source,
  type Truncated,
} from './lib/savedWork';
import { applyTheme, nextTheme, readTheme, storeTheme, type ThemeChoice } from './lib/theme';

const AUTOSAVE_MS = 2000;

/** `name` is the slug (storage key); `title` the display title ("" = old file, shown via `pretty`). */
type Open = { id: string; name: string; title: string; folder: string; xml: string; token: number; source: Source };
type Mount = { status: 'probing' | 'mounted' | 'missing'; reason: string | null };
/** Workspace: saved-work folder on the left, draw.io full-bleed on the right. */
export function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<Truncated>(null);
  const [open, setOpenState] = useState<Open | null>(null);
  const [mount, setMount] = useState<Mount>({ status: 'probing', reason: null });
  const [save, setSave] = useState<SaveState>({ state: 'idle' });
  const [printImg, setPrintImg] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [emptyFolders, setEmptyFolders] = useState<string[]>(localFolders);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [drawer, setDrawer] = useState(false);

  const openRef = useRef<Open | null>(null);
  const latestXml = useRef('');
  const savedXml = useRef('');
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const linkRef = useRef<DrawioLink | null>(null);
  const token = useRef(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const setOpen = (o: Open | null) => {
    openRef.current = o;
    setOpenState(o);
    setSlot((s) => nextSlot(s, o !== null));
  };

  // The URL follows the screen: /f/<slug> for a file, / for the file home. Back returns home.
  useEffect(() => {
    const want = open ? `/f/${encodeURIComponent(open.name)}` : '/';
    if (window.location.pathname !== want) window.history.pushState({ name: open?.name ?? null }, '', want);
  }, [open?.id]);

  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname.startsWith('/f/')) return;
      if (!openRef.current) return;
      void flush();
      setOpen(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const fail = (what: string, e?: unknown) =>
    setSave({ state: 'error', error: e === undefined ? `${what}.` : `${what}: ${e instanceof Error ? e.message : String(e)}` });

  /* ---------------------------------------------------------------------- list + mount */

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await listEntries();
    entriesRef.current = r.entries;
    setEntries(r.entries);
    setListError(r.error);
    setTruncated(r.truncated);
    setLoading(false);
  }, []);

  const checkMount = useCallback(async () => {
    setMount({ status: 'probing', reason: null });
    const p = await probeDrawio();
    setMount(p.ok ? { status: 'mounted', reason: null } : { status: 'missing', reason: p.reason });
  }, []);

  useEffect(() => {
    void refresh();
    void checkMount();
  }, [refresh, checkMount]);

  // Warm-up, once the list is on screen and the browser is idle (never competing with the shell):
  // prefetch draw.io's files once, then boot a hidden spare editor while the pane is empty, so the
  // next file opened lands in an editor that has already started. Skipped on Save-Data.
  const listShown = !loading;
  // With a file already open its frame is fetching these files itself; a prefetch would only race it.
  useEffect(() => {
    if (!listShown || mount.status !== 'mounted' || open || !warmupAllowed()) return;
    return whenIdle(() => {
      if (!openRef.current) prefetchDrawio();
    });
  }, [listShown, mount.status, open]);
  useEffect(() => {
    if (!listShown || mount.status !== 'mounted' || open || slot || !warmupAllowed()) return;
    return whenIdle(() => setSlot((s) => (s || openRef.current ? s : nextSlot(s, true))));
  }, [listShown, mount.status, open, slot]);

  // Light / Dark are fixed; System follows the OS, live.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme('system');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const cycleTheme = () =>
    setTheme((t) => {
      const n = nextTheme(t);
      storeTheme(n);
      return n;
    });

  /** Every folder: the ones holding a diagram (from the cloud list) plus empty ones made here. */
  const folders = useMemo(() => {
    const set = new Set(emptyFolders);
    for (const e of entries) if (e.folder) set.add(e.folder);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [entries, emptyFolders]);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  const updateEmptyFolders = (f: (list: string[]) => string[]) =>
    setEmptyFolders((list) => {
      const next = f(list);
      setLocalFolders(next);
      return next;
    });

  useEffect(() => {
    document.title = open ? `${titleOf(open)} · PandaPlan Draw` : 'PandaPlan Draw';
  }, [open]);

  /** Also updates `entriesRef` at once: the next queued job may run before React re-renders. */
  const upsert = (e: Entry, removeId?: string) => {
    const next = (list: Entry[]) => [e, ...list.filter((x) => x.id !== e.id && x.id !== removeId)];
    entriesRef.current = next(entriesRef.current);
    setEntries(next);
  };

  /* ---------------------------------------------------------------------- saving */

  /** Every PUT runs on `chain`, one at a time, so two PUTs never race. Jobs must not reject. */
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(job);
    chain.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  /**
   * Save the open file's latest XML through PUT /api/draw/backup. The file and XML are captured when
   * the save is queued, not when it runs, so switching files never drops the previous file's edits.
   * Resolves true when that XML is stored (or nothing needed saving); never rejects.
   */
  const flush = useCallback(
    (keepalive = false): Promise<boolean> => {
      window.clearTimeout(timer.current);
      const o = openRef.current;
      const xml = latestXml.current;
      if (!o || !xml || xml === savedXml.current) return enqueue(async () => true);
      return enqueue(async () => {
        const isOpen = () => openRef.current?.token === o.token;
        if (isOpen() && xml === savedXml.current) return true; // an earlier queued save stored it
        // Same token = same file, possibly renamed or promoted from browser to cloud since queueing.
        const cur = isOpen() ? openRef.current! : o;
        if (isOpen()) setSave({ state: 'saving' });
        try {
          const res = await saveXml(cur.name, cur.folder, xml, cur.title, keepalive);
          const id = entryId(cur.name, cur.folder);
          const stillListed = isOpen() || entriesRef.current.some((x) => x.id === cur.id);
          if (!stillListed) {
            tombstone(id); // deleted while this save was in flight: keep it hidden
            return true;
          }
          if (cur.source === 'browser') tombstone(cur.id); // the browser-only copy now lives in R2
          const prev = entriesRef.current.find((x) => x.id === id);
          upsert(
            { id, name: cur.name, title: cur.title, folder: cur.folder, source: 'cloud', key: res.key ?? prev?.key, size: res.bytes, updated: res.updatedAt, versions: (prev?.versions ?? 0) + 1 },
            cur.source === 'browser' ? cur.id : undefined,
          );
          if (!res.key) void refresh(); // Worker did not echo the key: re-list so Open fetches the newest copy
          if (isOpen()) {
            savedXml.current = xml;
            if (cur.source === 'browser') setOpen({ ...cur, id, source: 'cloud' });
            setSave({ state: latestXml.current === xml ? 'saved' : 'pending', at: res.updatedAt });
          }
          return true;
        } catch (e) {
          if (isOpen()) {
            fail('Not saved (your changes are still on screen)', e);
          } else if (entriesRef.current.some((x) => x.id === cur.id)) {
            // The editor has moved on: this XML exists nowhere else. Hand it to the user.
            const file = titleFilename(titleOf(cur), '.unsaved.drawio');
            downloadText(xml, file, 'application/xml');
            fail(`Could not save "${titleOf(cur)}"; its last changes were offered as a download (${file})`, e);
          }
          return false;
        }
      });
    },
    [enqueue, refresh],
  );

  const onChange = useCallback(
    (xml: string, immediate: boolean) => {
      latestXml.current = xml;
      if (xml === savedXml.current) return;
      setSave({ state: 'pending' });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), immediate ? 0 : AUTOSAVE_MS);
    },
    [flush],
  );

  /**
   * The Save button. Not a second save path: it skips the autosave wait and queues the same `flush`
   * on the same chain, so it can never race or duplicate an autosave PUT.
   */
  const saveNow = useCallback(() => {
    const o = openRef.current;
    if (!o) return;
    if (latestXml.current && latestXml.current !== savedXml.current) {
      void flush();
      return;
    }
    // Nothing new to store. If a save is already queued or running, its outcome will show; otherwise
    // confirm when the cloud copy was last written.
    setSave((s) => {
      if (s.state === 'saving' || s.state === 'saved' || s.state === 'error') return s;
      const e = entriesRef.current.find((x) => x.id === o.id);
      return e && o.source === 'cloud' ? { state: 'saved', at: e.updated } : s;
    });
  }, [flush]);

  useEffect(() => {
    const onHide = () => void flush(true);
    // Phones rarely fire pagehide/beforeunload: switching apps or locking the screen only hides the page.
    const onVis = () => {
      if (document.visibilityState === 'hidden') void flush(true);
      else void refresh(); // back from another device or tab: show its saves
    };
    // Closing the tab inside the 2 s autosave wait, during a save, or after a failed save would drop
    // the last edits silently: ask the browser to warn first.
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      if (!openRef.current || !latestXml.current || latestXml.current === savedXml.current) return;
      void flush(true);
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [flush, refresh]);

  /* ---------------------------------------------------------------------- file actions */

  const openEntry = async (e: Entry) => {
    const cur = openRef.current;
    if (cur?.id === e.id) return;
    beginOpen(titleOf(e));
    const saved = await flush();
    if (
      !saved &&
      cur &&
      openRef.current?.token === cur.token &&
      !window.confirm(
        `"${titleOf(cur)}" has changes that could not be saved to the cloud.\n\nOpen "${titleOf(e)}" anyway and discard them?\n(Cancel keeps it open; the Download button saves a copy to this device.)`,
      )
    ) {
      return;
    }
    try {
      const xml = await readXml(e);
      const cloud = entriesRef.current.filter((x) => x.source === 'cloud').map((x) => x.name);
      const name = e.source === 'browser' ? uniqueSlug(e.name, cloud) : e.name;
      latestXml.current = xml;
      savedXml.current = xml;
      setOpen({ id: e.id, name, title: e.title, folder: e.folder, xml, token: ++token.current, source: e.source });
      setSave({ state: 'idle' });
    } catch (err) {
      fail(`Could not open "${titleOf(e)}"`, err);
    }
  };

  /** Returns the new file's id. */
  const newDiagram = async (want: string, folder = ''): Promise<string> => {
    // Queue the current file's last edits under its own name before switching (captured now).
    void flush();
    // The editor opens first and unconditionally: the save queue must never gate it.
    // Names stay unique across all folders, so a name alone never matches two files.
    const name = uniqueSlug(want, entriesRef.current.map((x) => x.name));
    const title = clampTitle(want);
    const id = entryId(name, folder);
    const xml = blankXml();
    beginOpen(title);
    const tok = ++token.current;
    latestXml.current = xml;
    savedXml.current = '';
    setSave({ state: 'saving' });
    setOpen({ id, name, title, folder, xml, token: tok, source: 'cloud' });
    await enqueue(async () => {
      const isOpen = () => openRef.current?.token === tok;
      try {
        const res = await saveXml(name, folder, xml, title);
        upsert({ id, name, title, folder, source: 'cloud', key: res.key, size: res.bytes, updated: res.updatedAt, versions: 1 });
        if (!res.key) void refresh();
        if (isOpen()) {
          savedXml.current = xml;
          setSave({ state: latestXml.current === xml ? 'saved' : 'pending', at: res.updatedAt });
        }
      } catch (err) {
        if (isOpen()) fail('Could not save the new diagram to the cloud (it is open, unsaved)', err);
      }
    });
    return id;
  };

  /**
   * Rename to free text. The title keeps exactly what was typed (trimmed, max 120 characters); the slug
   * (storage key) is derived from it. Same slug: re-save under the same key with the new title. New
   * slug: no rename route in the Worker, so copy to the new slug, then delete the old one in its own
   * folder only. Empty text cancels. Returns the file's id afterwards, or null when it failed.
   */
  const rename = async (e: Entry, text: string): Promise<string | null> => {
    const title = clampTitle(text);
    if (!title) return e.id;
    const name = uniqueSlug(text, entriesRef.current.filter((x) => x.id !== e.id).map((x) => x.name));
    const sameKey = name === e.name && e.source === 'cloud';
    if (sameKey && title === e.title) return e.id;
    const id = sameKey ? e.id : entryId(name, e.folder);
    if (openRef.current?.id === e.id) window.clearTimeout(timer.current); // pending edits go to the new name
    return enqueue(async () => {
      const o = openRef.current;
      const isOpen = o?.id === e.id;
      try {
        const xml = isOpen && latestXml.current ? latestXml.current : await readXml(e);
        const res = await saveXml(name, e.folder, xml, title);
        if (!sameKey) tombstone(e.id);
        const prev = entriesRef.current.find((x) => x.id === e.id);
        upsert(
          { id, name, title, folder: e.folder, source: 'cloud', key: res.key, size: res.bytes, updated: res.updatedAt, versions: sameKey ? (prev?.versions ?? 0) + 1 : 1 },
          e.id,
        );
        if (!res.key) void refresh();
        if (isOpen && o && openRef.current?.token === o.token) {
          savedXml.current = xml;
          setOpen({ ...openRef.current, id, name, title, source: 'cloud' });
          setSave({ state: latestXml.current === xml ? 'saved' : 'pending', at: res.updatedAt });
          if (latestXml.current !== xml) void flush();
        }
        // The tombstone only hides the old name in this browser; without this the phone and every
        // other device keep showing it, so one rename leaves two files.
        if (!sameKey && e.source === 'cloud') {
          await deleteEntry(e.name, e.folder).catch(() =>
            fail(`Renamed to "${title}", but the old name "${titleOf(e)}" still shows on other devices. Delete it there`),
          );
        }
        return id;
      } catch (err) {
        fail(`Rename failed`, err);
        return null;
      }
    });
  };

  /**
   * Duplicate as "<title> copy" in the same folder. On the save queue, so it never interleaves with an
   * autosave PUT. The open file is copied from what is on screen, never from its older cloud copy.
   * Returns the copy's id (it is not opened), or null when it failed (the reason is shown).
   */
  const duplicate = (e: Entry): Promise<string | null> =>
    enqueue(async () => {
      try {
        const o = openRef.current;
        const xml = o && o.id === e.id && latestXml.current ? latestXml.current : await readXml(e);
        // "copy", then "copy 2", "copy 3"… so two copies never share a title in the list.
        const base = titleOf(e).replace(/ copy( \d+)?$/, '');
        const taken = new Set(entriesRef.current.map((x) => x.title));
        let title = clampTitle(`${base} copy`);
        for (let i = 2; taken.has(title) && i < 1000; i++) title = clampTitle(`${base} copy ${i}`);
        const name = uniqueSlug(title, entriesRef.current.map((x) => x.name));
        const id = entryId(name, e.folder);
        const res = await saveXml(name, e.folder, xml, title);
        upsert({ id, name, title, folder: e.folder, source: 'cloud', key: res.key, size: res.bytes, updated: res.updatedAt, versions: 1 });
        if (!res.key) void refresh();
        return id;
      } catch (err) {
        fail(`Could not duplicate "${titleOf(e)}"`, err);
        return null;
      }
    });

  const remove = (e: Entry): boolean => {
    const ok = window.confirm(
      `Delete "${titleOf(e)}"?\n\nThis deletes every saved version of it from cloud storage. It cannot be undone.`,
    );
    if (!ok) return false;
    // Close it first: an open file keeps autosaving, and a save landing after the delete would
    // put the diagram straight back in the list.
    if (openRef.current?.id === e.id) {
      window.clearTimeout(timer.current);
      latestXml.current = savedXml.current = '';
      setOpen(null);
      setSave({ state: 'idle' });
    }
    tombstone(e.id);
    setEntries((list) => list.filter((x) => x.id !== e.id));
    entriesRef.current = entriesRef.current.filter((x) => x.id !== e.id);
    if (e.source === 'cloud') {
      // On the save queue: a save already in flight for this file lands first, so the delete removes
      // it too instead of the diagram reappearing on other devices.
      void enqueue(() =>
        deleteEntry(e.name, e.folder).then(
          () => undefined,
          (err) => fail(`"${titleOf(e)}" is hidden here, but the cloud copy could not be deleted`, err),
        ),
      );
    }
    return true;
  };

  /* ---------------------------------------------------------------------- folders */

  /**
   * Move one diagram to `folder` ("" = no folder). Runs INSIDE a queue job (callers enqueue), so no
   * autosave PUT can interleave. No move route in the Worker: read, PUT to the new folder, DELETE the
   * old copy. Returns the new id, or null when it failed (the reason is shown).
   */
  const relocate = async (e: Entry, folder: string): Promise<string | null> => {
    if (e.folder === folder && e.source === 'cloud') return e.id;
    const o = openRef.current;
    const isOpen = !!o && o.id === e.id;
    if (isOpen) window.clearTimeout(timer.current); // its pending edits go along to the new folder
    // An old browser-only diagram gets a free cloud name, the same one Open gives it.
    const cloudNames = entriesRef.current.filter((x) => x.source === 'cloud').map((x) => x.name);
    const name = isOpen ? o.name : e.source === 'browser' ? uniqueSlug(e.name, cloudNames) : e.name;
    const id = entryId(name, folder);
    const title = isOpen ? o.title : e.title;
    try {
      const xml = isOpen && latestXml.current ? latestXml.current : await readXml(e);
      // Write the new copy first, then delete the old one in ITS folder only (`folder=` = unfiled
      // copies only), so the diagram is never held only in memory and the new copy is never hit.
      const res = await saveXml(name, folder, xml, title);
      if (e.source === 'cloud') {
        await deleteEntry(e.name, e.folder).catch(() =>
          fail(`Moved "${titleOf(e)}", but an old copy is still in its previous folder. Delete it there`),
        );
      }
      tombstone(e.id);
      const prev = entriesRef.current.find((x) => x.id === e.id);
      upsert({ id, name, title, folder, source: 'cloud', key: res.key, size: res.bytes, updated: res.updatedAt, versions: prev?.versions ?? 1 }, e.id);
      if (!res.key) void refresh();
      const now = openRef.current;
      if (isOpen && o && now?.token === o.token) {
        savedXml.current = xml;
        setOpen({ ...now, id, name, folder, source: 'cloud' });
        setSave({ state: latestXml.current === xml ? 'saved' : 'pending', at: res.updatedAt });
        if (latestXml.current !== xml) void flush();
      }
      return id;
    } catch (err) {
      fail(`Could not move "${titleOf(e)}"`, err);
      return null;
    }
  };

  const move = (e: Entry, folder: string): Promise<string | null> => enqueue(() => relocate(e, folder));

  const newFolder = (want: string): string => {
    const slug = uniqueSlug(want, foldersRef.current);
    updateEmptyFolders((list) => [...list, slug]);
    return slug;
  };

  const renameFolder = async (from: string, want: string): Promise<string | null> => {
    const to = uniqueSlug(want, foldersRef.current.filter((f) => f !== from));
    if (to === from) return from;
    updateEmptyFolders((list) => [...list.filter((f) => f !== from), to]);
    return enqueue(async () => {
      let ok = true;
      for (const e of entriesRef.current.filter((x) => x.folder === from)) {
        if ((await relocate(e, to)) === null) ok = false;
      }
      return ok ? to : null;
    });
  };

  const deleteFolder = (folder: string): boolean => {
    const inside = entriesRef.current.filter((x) => x.folder === folder);
    const n = inside.length;
    const ok = window.confirm(
      `Delete folder ${pretty(folder)} and the ${n} diagram${n === 1 ? '' : 's'} inside it? This cannot be undone.`,
    );
    if (!ok) return false;
    if (openRef.current && openRef.current.folder === folder) {
      window.clearTimeout(timer.current);
      latestXml.current = savedXml.current = '';
      setOpen(null);
      setSave({ state: 'idle' });
    }
    const gone = new Set(inside.map((x) => x.id));
    inside.forEach((x) => tombstone(x.id));
    setEntries((list) => list.filter((x) => !gone.has(x.id)));
    entriesRef.current = entriesRef.current.filter((x) => !gone.has(x.id));
    updateEmptyFolders((list) => list.filter((f) => f !== folder));
    for (const e of inside) {
      void enqueue(() =>
        deleteEntry(e.name, folder).then(
          () => undefined,
          (err) => fail(`"${titleOf(e)}" is hidden here, but the cloud copy could not be deleted`, err),
        ),
      );
    }
    return true;
  };

  /* ---------------------------------------------------------------------- print / download */

  /**
   * Print / PDF. The iframe canvas is never printed (it is hidden in print CSS and a cross-document
   * canvas cannot be captured): the sheet prints an SVG that draw.io itself exports on request.
   */
  const print = useCallback(async () => {
    let img: string | null = null;
    const link = linkRef.current;
    if (link?.ready) {
      try {
        img = await link.exportSvg();
        const im = new Image();
        im.src = img;
        await im.decode().catch(() => undefined);
      } catch (err) {
        fail('Print export failed', err);
      }
    }
    setPrintImg(img);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && ev.key.toLowerCase() === 'p') {
        ev.preventDefault();
        void print();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [print]);

  const download = () => {
    const o = openRef.current;
    if (o) downloadText(latestXml.current || o.xml, titleFilename(titleOf(o), '.drawio', o.name), 'application/xml');
  };

  /* ---------------------------------------------------------------------- render */

  // The frame is rendered on its own, beside the overlays, so a spare survives the empty state being
  // replaced by an open file (same key = same iframe, no reload).
  const frameFile = open ? { token: open.token, name: titleOf(open), xml: open.xml } : null;
  const frame =
    mount.status === 'mounted' && slot ? (
      <DrawioEditor
        key={slot.key}
        file={frameFile}
        waiting={null}
        linkRef={linkRef}
        onChange={onChange}
        onExit={() => {
          void flush();
          setOpen(null);
        }}
        onTimeout={() =>
          setMount({ status: 'missing', reason: `the editor page loaded but did not start within ${INIT_TIMEOUT_MS / 1000} seconds` })
        }
      />
    ) : null;

  let main;
  if (mount.status === 'missing') {
    main = <EditorPlaceholder reason={mount.reason} onRetry={() => void checkMount()} />;
  } else if (mount.status === 'probing') {
    main = <div className="sw-empty-main" role="status">Looking for the draw.io editor…</div>;
  } else if (open) {
    main = null;
  } else {
    main = (
      <div className="sw-empty-main">
        <strong>No diagram open</strong>
        <span>Pick a diagram in the saved-work folder, or start a new one.</span>
        <button type="button" className="btn primary" onClick={() => void newDiagram('Untitled')}>
          <FilePlus2 size={15} /> New diagram
        </button>
      </div>
    );
  }

  return (
    <>
      <div className={`sw-app${open ? ' has-open' : ''}${open && drawer ? ' panel-open' : ''}`} data-app="pandaplan-draw">
        <SavedWorkPanel
          entries={entries}
          loading={loading}
          error={listError}
          activeId={open?.id ?? null}
          save={save}
          folders={folders}
          theme={theme}
          onTheme={cycleTheme}
          onOpen={(e) => {
            setDrawer(false);
            void openEntry(e);
          }}
          onNew={newDiagram}
          onRename={rename}
          onDuplicate={duplicate}
          truncated={truncated}
          onDelete={remove}
          onMove={move}
          onNewFolder={newFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onRefresh={() => void refresh()}
          onPrint={() => void print()}
          onDownload={download}
        />
        <main className="sw-main" aria-label="Diagram editor">
          {/* The file toolbar. Desktop: always there (Save shows, disabled, with nothing open).
              Phone: only with a diagram open, where it is also the way back to the folder. */}
          <div className="sw-filebar">
            {open && (
              <button
                type="button"
                className="btn sm sw-files"
                aria-expanded={drawer}
                onClick={() => setDrawer((d) => !d)}
                title="Show the saved-work list"
              >
                <Folder size={14} /> Files
              </button>
            )}
            {open && (
              <button
                type="button"
                className="btn sm sw-back"
                onClick={() => {
                  void flush();
                  setOpen(null);
                }}
              >
                <ChevronLeft size={14} /> Saved work
              </button>
            )}
            <span className="sw-filebar-name">
              {open ? (
                <>
                  {open.folder && (
                    <span className="sw-filebar-folder">
                      <Folder size={13} aria-hidden /> {pretty(open.folder)} /
                    </span>
                  )}
                  <strong>{titleOf(open)}</strong>
                </>
              ) : (
                <span className="sw-filebar-none">No diagram open</span>
              )}
            </span>
            {open && (save.state === 'pending' || save.state === 'error') && (
              <span className={`sw-filebar-status${save.state === 'error' ? ' err' : ''}`} role="status">
                {saveStatusText(save)}
              </span>
            )}
            {open && (
              <MoveSelect
                className="sw-filebar-move"
                folders={folders}
                current={open.folder}
                label="Move to…"
                onPick={(f) => {
                  const e = entriesRef.current.find((x) => x.id === open.id);
                  if (e) void move(e, f);
                  else fail('It has not finished saving yet. Wait for “Saved”, then move it');
                }}
              />
            )}
            <button
              type="button"
              className="btn primary sm sw-save"
              disabled={!open || save.state === 'saving'}
              onClick={saveNow}
              title="Save now (Ctrl+S in the editor does the same). Changes also save by themselves."
              aria-live="polite"
            >
              <Save size={14} aria-hidden />
              {!open ? 'Save' : save.state === 'saving' ? 'Saving…' : save.state === 'saved' && save.at ? `Saved ${when(save.at)}` : 'Save'}
            </button>
          </div>
          <div className="sw-stage">
            {frame}
            {main}
          </div>
        </main>
      </div>
      <section className="print-sheet" aria-hidden="true">
        <h1>{open ? titleOf(open) : 'PandaPlan Draw'}</h1>
        {printImg ? (
          <img src={printImg} alt="" />
        ) : open ? (
          <p>The diagram could not be exported for printing. Print from inside the editor with File › Print.</p>
        ) : (
          <p>Nothing to print from here. Open a diagram, or print from inside the editor with File › Print.</p>
        )}
      </section>
    </>
  );
}
