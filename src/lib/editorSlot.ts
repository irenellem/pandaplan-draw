/**
 * The page's one editor frame. It is created once (warm-up while the list is on screen, or at the
 * first open when the warm-up is off) and then serves every file: each open is a `load` message into
 * the same iframe (see the fence in drawioProtocol.ts). A new frame only replaces it after the editor
 * failed to start and she pressed "Check again".
 *
 * Same `key` = same iframe (React keeps it, nothing reloads).
 */
export type Slot = { key: number };

let seq = 0;
export const newSlot = (): Slot => ({ key: ++seq });

/** The frame to render: keep the one there is; create one only when a file needs it now. */
export function nextSlot(s: Slot | null, need: boolean): Slot | null {
  return s ?? (need ? newSlot() : null);
}
