import { FilePlus2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DrawioEditor, EditorPlaceholder } from './components/DrawioEditor';
import { SavedWorkPanel, type SaveState } from './components/SavedWorkPanel';
import { blankXml } from './lib/drawioFile';
import { probeDrawio, type DrawioLink } from './lib/drawioProtocol';
import { downloadText } from './lib/download';
import { listEntries, readXml, saveXml, tombstone, uniqueSlug, type Entry, type Source } from './lib/savedWork';

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

  /** Every save goes through PUT /api/draw/backup. Serialised so two PUTs never race. */
  const flush = useCallback((keepalive = false): Promise<void> => {
    window.clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const o = openRef.current;
      const xml = latestXml.current;
      if (!o || !xml || xml === savedXml.current) return;
      setSave({ state: 'saving' });
      try {
        const res = await saveXml(o.name, xml, keepalive);
        savedXml.current = xml;
        const prev = entriesRef.current.find((x) => x.id === o.name);
        if (o.source === 'browser') {
          tombstone(o.id); // the browser-only copy now lives in R2
          setOpen({ ...o, id: o.name, source: 'cloud' });
        }
        upsert(
          { id: o.name, name: o.name, source: 'cloud', key: res.key ?? prev?.key, size: res.bytes, updated: res.updatedAt, versions: (prev?.versions ?? 0) + 1 },
          o.source === 'browser' ? o.id : undefined,
        );
        if (!res.key) void refresh(); // Worker did not echo the key: re-list so Open fetches the newest copy
        setSave({ state: latestXml.current === xml ? 'saved' : 'pending', at: res.updatedAt });
      } catch (e) {
        fail('Save failed', e);
      }
    });
    return chain.current;
  }, [refresh]);

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
    if (openRef.current?.id === e.id) return;
    await flush();
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

  const newDiagram = async (want: string) => {
    // The editor opens first and unconditionally: the save queue must never gate it.
    const name = uniqueSlug(want, entriesRef.current.map((x) => x.id));
    const xml = blankXml();
    latestXml.current = xml;
    savedXml.current = '';
    setSave({ state: 'saving' });
    setOpen({ id: name, name, xml, token: ++token.current, source: 'cloud' });
    try {
      await flush();
    } catch {
      /* a stuck or failed save of the previous file must not block a new one */
    }
    try {
      const res = await saveXml(name, xml);
      savedXml.current = xml;
      upsert({ id: name, name, source: 'cloud', key: res.key, size: res.bytes, updated: res.updatedAt, versions: 1 });
      if (!res.key) void refresh();
      setSave({ state: 'saved', at: res.updatedAt });
    } catch (err) {
      fail('Could not save the new diagram to the cloud (it is open, unsaved)', err);
    }
  };

  /** No rename route in the Worker: copy to the new slug, then tombstone the old one. */
  const rename = async (e: Entry, want: string) => {
    const name = uniqueSlug(want, entriesRef.current.filter((x) => x.id !== e.id).map((x) => x.id));
    if (name === e.id) return;
    const isOpen = openRef.current?.id === e.id;
    try {
      if (isOpen) await flush();
      const xml = isOpen ? latestXml.current : await readXml(e);
      const res = await saveXml(name, xml);
      tombstone(e.id);
      upsert({ id: name, name, source: 'cloud', key: res.key, size: res.bytes, updated: res.updatedAt, versions: 1 }, e.id);
      if (!res.key) void refresh();
      const o = openRef.current;
      if (isOpen && o) {
        savedXml.current = xml;
        setOpen({ ...o, id: name, name, source: 'cloud' });
      }
      setSave({ state: 'saved', at: res.updatedAt });
    } catch (err) {
      fail(`Rename failed`, err);
    }
  };

  const remove = (e: Entry): boolean => {
    const ok = window.confirm(
      `Delete "${e.name}"?\n\nIt is hidden in this browser now. The cloud copy stays in storage until a delete route is added to the backup service.`,
    );
    if (!ok) return false;
    tombstone(e.id);
    setEntries((list) => list.filter((x) => x.id !== e.id));
    if (openRef.current?.id === e.id) {
      window.clearTimeout(timer.current);
      latestXml.current = savedXml.current = '';
      setOpen(null);
      setSave({ state: 'idle' });
    }
    return true;
  };

  /* ---------------------------------------------------------------------- print / download */

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
        onTimeout={() => setMount({ status: 'missing', reason: 'draw.io sent no init message within 8 seconds' })}
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
        ) : (
          <p>Nothing to print from here. Open a diagram, or print from inside the editor with File › Print.</p>
        )}
      </section>
    </>
  );
}
