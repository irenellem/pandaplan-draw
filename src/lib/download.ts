export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type: string): void {
  downloadBlob(new Blob([text], { type }), filename);
}

export async function downloadDataUrl(dataUrl: string, filename: string): Promise<void> {
  // Convert locally (no network): data: URL → Blob, avoiding very long href attributes.
  const [meta, b64] = dataUrl.split(',', 2);
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  downloadBlob(new Blob([bytes], { type: mime }), filename);
}

export function safeFilename(name: string, fallback = 'diagram'): string {
  const s = name.trim().replace(/[^\w\- .]+/g, '').replace(/\s+/g, '-').slice(0, 80);
  return s || fallback;
}
