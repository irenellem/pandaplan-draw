/**
 * Which editor frame shows which file. There is one frame on the page at a time:
 *  - `token: null` is a warm spare: draw.io booting (or booted) with no file, waiting for one;
 *  - `token: n` holds open file n, and only ever file n (one `load` per frame).
 * Same `key` = same iframe (React keeps it, nothing reloads); a new key = a new frame.
 */
export type Slot = { key: number; token: number | null };

let seq = 0;
export const newSpare = (): Slot => ({ key: ++seq, token: null });

/** The frame for `open`: same frame for the same file, the spare for a new file, else a new frame. */
export function nextSlot(s: Slot | null, open: { token: number } | null): Slot | null {
  if (!open) return s?.token === null ? s : null; // closed: that file's frame goes; a spare stays
  if (s?.token === open.token) return s;
  if (s && s.token === null) return { key: s.key, token: open.token }; // adopt the warm spare
  return { key: ++seq, token: open.token };
}
