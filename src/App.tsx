import { FilePlus2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DrawioEditor, EditorPlaceholder } from './components/DrawioEditor';
import { SavedWorkPanel, type SaveState } from './components/SavedWorkPanel';
import { blankXml } from './lib/drawioFile';
import { INIT_TIMEOUT_MS, probeDrawio, type DrawioLink } from './lib/drawioProtocol';
import { downloadText } from './lib/download';
import { deleteEntry, listEntries, readXml, saveXml, tombstone, uniqueSlug, type Entry, type Source } from './lib/savedWork';

const AUTOSAVE_MS = 2000;

type Open = { id: string; name: string; xml: string; token: number; source: Source };
type Mount = { status: 'probing' | 'mounted' | 'missing'; reason: string | null };

/** Workspace: saved-work folder on the left, draw.io full-bleed on the right. */
export function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [open, setOpenState] = useState<Open | null>(null);
  const [mount, setMount] = useState<Mount>({ status: 'probing', reason: null });
  const [save, setSave] = useState<SaveState>({ state: 'idle' });
  const [printImg, setPrintImg] = useState<string | null>(null);

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
  };

  const fail = (what: string, e: unknown) => setSave({ state: 'error', error: `${what}: ${e instanceof Error ? e.message : String(e)}` });

  /* ---------------------------------------------------------------------- list + mount */

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await listEntries();
    setEntries(r.entries);
    setListError(r.error);
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

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => (document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    document.title = open ? `${open.name} · PandaPlan Draw` : 'PandaPlan Draw';
  }, [open]);

  const upsert = (e: Entry, removeId?: string) =>
    setEntries((list) => [e, ...list.filter((x) => x.id !== e.id && x.id !== removeId)]);

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
          const res = await saveXml(cur.name, xml, keepalive);
          const stillListed = isOpen() || entriesRef.current.some((x) => x.id === cur.id);
          if (!stillListed) {
            tombstone(cur.name); // deleted while this save was in flight: keep it hidden
            return true;
          }
          if (cur.source === 'browser') tombstone(cur.id); // the browser-only copy now lives in R2
          const prev = entriesRef.current.find((x) => x.id === cur.name);
          upsert(
            { id: cur.name, name: cur.name, source: 'cloud', key: res.key ?? prev?.key, size: res.bytes, updated: res.updatedAt, versions: (prev?.versions ?? 0) + 1 },
            cur.source === 'browser' ? cur.id : undefined,
          );
          if (!res.key) void refresh(); // Worker did not echo the key: re-list so Open fetches the newest copy
          if (isOpen()) {
            savedXml.current = xml;
            if (cur.source === 'browser') setOpen({ ...cur, id: cur.name, source: 'cloud' });
            setSave({ state: latestXml.current === xml ? 'saved' : 'pending', at: res.updatedAt });
          }
          return true;
        } catch (e) {
          if (isOpen()) {
            fail('Save failed (changes are still in the editor)', e);
          } else if (entriesRef.current.some((x) => x.id === cur.id)) {
            // The editor has moved on: this XML exists nowhere else. Hand it to the user.
            downloadText(xml, `${cur.name}.unsaved.drawio`, 'application/xml');
            fail(`Could not save ${cur.name}; its last changes were offered as a download (${cur.name}.unsaved.drawio)`, e);
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

  useEffect(() => {
    const onHide = () => void flush(true);
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flush]);

  /* ---------------------------------------------------------------------- file actions */

  const openEntry = async (e: Entry) => {
    const cur = openRef.current;
    if (cur?.id === e.id) return;
    const saved = await flush();
    if (
      !saved &&
      cur &&
      openRef.current?.token === cur.token &&
      !window.confirm(
        `"${cur.name}" has changes that could not be saved to the cloud.\n\nOpen "${e.name}" anyway and discard them?\n(Cancel keeps it open; ".drawio" downloads a copy.)`,
      )
    ) {
      return;
    }
    try {
      const xml = await readXml(e);
      const cloud = entriesRef.current.filter((x) => x.source === 'cloud').map((x) => x.id);
      const name = e.source === 'browser' ? uniqueSlug(e.name, cloud) : e.name;
      latestXml.current = xml;
      savedXml.current = xml;
      setOpen({ id: e.id, name, xml, token: ++token.current, source: e.source });
      setSave({ state: 'idle' });
    } catch (err) {
      fail(`Could not open ${e.name}`, err);
    }
  };

  /** Returns the new file's id. */
  const newDiagram = async (want: string): Promise<string> => {
    // Queue the current file's last edits under its own name before switching (captured now).
    void flush();
    // The editor opens first and unconditionally: the save queue must never gate it.
    const name = uniqueSlug(want, entriesRef.current.map((x) => x.id));
    const xml = blankXml();
    const tok = ++token.current;
    latestXml.current = xml;
    savedXml.current = '';
    setSave({ state: 'saving' });
    setOpen({ id: name, name, xml, token: tok, source: 'cloud' });
    await enqueue(async () => {
      const isOpen = () => openRef.current?.token === tok;
      try {
        const res = await saveXml(name, xml);
        upsert({ id: name, name, source: 'cloud', key: res.key, size: res.bytes, updated: res.updatedAt, versions: 1 });
        if (!res.key) void refresh();
        if (isOpen()) {
          savedXml.current = xml;
          setSave({ state: latestXml.current === xml ? 'saved' : 'pending', at: res.updatedAt });
        }
      } catch (err) {
        if (isOpen()) fail('Could not save the new diagram to the cloud (it is open, unsaved)', err);
      }
    });
    return name;
  };

  /** No rename route in the Worker: copy to the new slug, then tombstone the old one. Returns the new id. */
  const rename = async (e: Entry, want: string): Promise<string | null> => {
    const name = uniqueSlug(want, entriesRef.current.filter((x) => x.id !== e.id).map((x) => x.id));
    if (name === e.id) return e.id;
    if (openRef.current?.id === e.id) window.clearTimeout(timer.current); // pending edits go to the new name
    return enqueue(async () => {
      const o = openRef.current;
      const isOpen = o?.id === e.id;
      try {
        const xml = isOpen && latestXml.current ? latestXml.current : await readXml(e);
        const res = await saveXml(name, xml);
        tombstone(e.id);
        upsert({ id: name, name, source: 'cloud', key: res.key, size: res.bytes, updated: res.updatedAt, versions: 1 }, e.id);
        if (!res.key) void refresh();
        if (isOpen && o && openRef.current?.token === o.token) {
          savedXml.current = xml;
          setOpen({ ...openRef.current, id: name, name, source: 'cloud' });
          setSave({ state: latestXml.current === xml ? 'saved' : 'pending', at: res.updatedAt });
          if (latestXml.current !== xml) void flush();
        }
        return name;
      } catch (err) {
        fail(`Rename failed`, err);
        return null;
      }
    });
  };

  const remove = (e: Entry): boolean => {
    const ok = window.confirm(
      `Delete "${e.name}"?\n\nThis deletes every saved version of it from cloud storage. It cannot be undone.`,
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
      void deleteEntry(e.id).catch((err) =>
        fail(`"${e.name}" is hidden here, but the cloud copy could not be deleted`, err),
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
    if (o) downloadText(latestXml.current || o.xml, `${o.name}.drawio`, 'application/xml');
  };

  /* ---------------------------------------------------------------------- render */

  let main;
  if (mount.status === 'missing') {
    main = <EditorPlaceholder reason={mount.reason} onRetry={() => void checkMount()} />;
  } else if (mount.status === 'probing') {
    main = <div className="sw-empty-main" role="status">Looking for the draw.io editor…</div>;
  } else if (open) {
    main = (
      <DrawioEditor
        key={open.token}
        name={open.name}
        xml={open.xml}
        linkRef={linkRef}
        onChange={onChange}
        onExit={() => {
          void flush();
          setOpen(null);
        }}
        onTimeout={() =>
          setMount({ status: 'missing', reason: `the /drawio/ page loaded but draw.io sent no init message within ${INIT_TIMEOUT_MS / 1000} seconds` })
        }
      />
    );
  } else {
    main = (
      <div className="sw-empty-main">
        <strong>No diagram open</strong>
        <span>Pick a diagram in the saved-work folder, or start a new one.</span>
        <button type="button" className="btn primary" onClick={() => void newDiagram('untitled')}>
          <FilePlus2 size={15} /> New diagram
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="sw-app" data-app="pandaplan-draw">
        <SavedWorkPanel
          entries={entries}
          loading={loading}
          error={listError}
          activeId={open?.id ?? null}
          save={save}
          onOpen={(e) => void openEntry(e)}
          onNew={newDiagram}
          onRename={rename}
          onDelete={remove}
          onRefresh={() => void refresh()}
          onPrint={() => void print()}
          onDownload={download}
        />
        <main className="sw-main" aria-label="Diagram editor">
          {main}
        </main>
      </div>
      <section className="print-sheet" aria-hidden="true">
        <h1>{open?.name ?? 'PandaPlan Draw'}</h1>
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
