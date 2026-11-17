export const FILL_SWATCHES = [
  '#ffffff',
  '#f1f5f9',
  '#dbeafe',
  '#dcfce7',
  '#fef3c7',
  '#fde68a',
  '#fee2e2',
  '#ede9fe',
  '#1877f2',
  '#0f172a',
  'transparent',
];

export const STROKE_SWATCHES = ['#334155', '#94a3b8', '#1877f2', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#000000'];

export const STROKE_WIDTHS = [1, 1.5, 2, 3, 4];
export const FONT_SIZES = [11, 12, 13, 14, 16, 18, 20, 24, 32];

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (WCAG). Unknown or transparent colours count as light. */
export function luminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text colour that stays readable on the given fill. */
export function textOn(fill: string): string {
  return luminance(fill) < 0.4 ? '#ffffff' : '#0f172a';
}

export function isHexColor(value: string): boolean {
  return value === 'transparent' || parseHex(value) !== null;
}
