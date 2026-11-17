import { CloudUpload, RotateCcw, RefreshCw, Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { history } from '../store/history';
import { useDoc } from '../store/docStore';
import { useSession } from '../store/sessionStore';
import { buildEnvelope, validateEnvelope } from '../lib/pandadraw';
import type { PandaDrawEnvelope } from '../types';

type Snapshot = { key: string; size: number; uploaded: string };

/** "2026-11-17/workspace.pandadraw" -> "17 Nov 2026, 08:14" (local time). */
function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function kb(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Cloud backup panel. Talks only to /api/draw/* on this same host, which is the Worker behind the
 * Cloudflare Access gate - no keys, no bucket names, no public URL in the browser.
 */
export function BackupPanel() {
  const toast = useSession((s) => s.toast);
  const [items, setItems] = useState<Snapshot[] | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const r = await fetch('/api/draw/backups', { headers: { accept: 'application/json' } });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setItems(j.items as Snapshot[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the backup service.');
      setItems([]);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const backupNow = async () => {
    setBusy('save');
    setError(null);
    try {
      const s = useDoc.getState();
      const page = s.activePageId ? s.pages[s.activePageId] : undefined;
      const name =
        (page?.title || 'workspace')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'workspace';
      const body = JSON.stringify(buildEnvelope(s));
      const r = await fetch(`/api/draw/backup?name=${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast(`Backed up to the cloud (${kb(j.bytes)}).`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Backup failed.';
      setError(msg);
      toast(`Backup failed: ${msg}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const restore = async (snap: Snapshot) => {
    setBusy(snap.key);
    setError(null);
    try {
      const r = await fetch(`/api/draw/backup?key=${encodeURIComponent(snap.key)}`, {
        headers: { accept: 'application/json' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const raw = await r.json();
      const err = validateEnvelope(raw);
      if (err) throw new Error(err);
      const s = useDoc.getState();
      Object.keys(s.pages).forEach((id) => history.drop(id));
      useSession.getState().clearSelection();
      useDoc.setState({ pages: {}, diagrams: {}, activePageId: null });
      const report = s.importEnvelope(raw as PandaDrawEnvelope);
      useSession.setState({ importReport: report });
      useSession.getState().openModal('import-report');
      toast(`Restored ${when(snap.uploaded)}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Restore failed.';
      setError(msg);
      toast(`Restore failed: ${msg}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => void backupNow()} disabled={busy !== null}>
          <CloudUpload size={14} /> {busy === 'save' ? 'Backing up…' : 'Back up now'}
        </button>
        <button type="button" className="btn" onClick={() => void load()} disabled={busy !== null}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <p className="hint" style={{ margin: '0 0 10px' }}>
        Snapshots are stored on Cloudflare, not in this browser. Restoring replaces the current
        workspace — export first if you want to keep it.
      </p>

      {error && (
        <p className="warnlist" style={{ margin: '0 0 10px' }}>
          {error}
        </p>
      )}

      {busy === 'load' && !items && <p className="mini-empty">Loading snapshots…</p>}

      {items && items.length === 0 && !error && (
        <p className="mini-empty">No cloud backups yet. Press “Back up now”.</p>
      )}

      {items && items.length > 0 && (
        <ul className="keys" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 0 }}>
          {items.map((snap) => (
            <li
              key={snap.key}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)' }}
            >
              <Check size={13} style={{ opacity: 0.55, flex: '0 0 auto' }} />
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 12.5 }}>{when(snap.uploaded)}</strong>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {snap.key.split('/').slice(-1)[0]} · {kb(snap.size)}
                </span>
              </span>
              <button
                type="button"
                className="iconbtn"
                title={`Restore ${when(snap.uploaded)}`}
                aria-label={`Restore snapshot from ${when(snap.uploaded)}`}
                onClick={() => void restore(snap)}
                disabled={busy !== null}
              >
                <RotateCcw size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
