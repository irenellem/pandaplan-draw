/** Short random ids. crypto.randomUUID exists in every browser we target; the fallback covers old WebViews. */
export function uid(prefix = ''): string {
  const c = globalThis.crypto;
  const raw =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return prefix ? `${prefix}_${raw}` : raw;
}
