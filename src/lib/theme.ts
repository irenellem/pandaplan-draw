/** Light / Dark / System. The choice persists; System follows the OS live. */
export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'pandadraw.theme';
const ORDER: ThemeChoice[] = ['light', 'dark', 'system'];

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function storeTheme(t: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode: applies for this visit only */
  }
}

export const nextTheme = (t: ThemeChoice): ThemeChoice => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length];

const osDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export function applyTheme(t: ThemeChoice): void {
  document.documentElement.dataset.theme = t === 'system' ? (osDark() ? 'dark' : 'light') : t;
}
