// Colour maths for the picker (PROPS-12). Pure TS: hex parse/format, RGB <-> HSV, named colours, contrast.
// Hex strings are '#rrggbb' (lowercase); opacity is kept separate (0..1) except in 8-digit hex.
export interface RGB { r: number; g: number; b: number }          // 0..255
export interface HSV { h: number; s: number; v: number }          // h 0..360, s and v 0..1
export interface RGBA extends RGB { a: number }                   // a 0..1

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const byte = (n: number) => clamp(Math.round(n), 0, 255);
const hex2 = (n: number) => byte(n).toString(16).padStart(2, '0');

/** A few CSS names people type; anything else is rejected. */
export const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080', grey: '#808080', cyan: '#00ffff',
  magenta: '#ff00ff', brown: '#a52a2a', teal: '#008080', navy: '#000080', lime: '#00ff00', silver: '#c0c0c0',
  maroon: '#800000', olive: '#808000', aqua: '#00ffff', fuchsia: '#ff00ff',
};

/**
 * Parse user text: '#abc', 'abc', '#aabbcc', '#aabbccdd', 'rrggbb' or a colour name. 'transparent' gives alpha 0.
 * Returns null for anything invalid (callers keep the old value).
 */
export function parseColor(input: string): RGBA | null {
  let s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[s]) s = NAMED[s]!;
  if (s.startsWith('#')) s = s.slice(1);
  if (!/^[0-9a-f]+$/.test(s)) return null;
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return null;
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) / 255 : 1 };
}

/** '#rrggbb' from RGB (values clamped and rounded). */
export function toHex(c: RGB): string { return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`; }
/** '#rrggbb', or '#rrggbbaa' when a < 1. */
export function toHexA(c: RGBA): string { return c.a >= 1 ? toHex(c) : toHex(c) + hex2(c.a * 255); }
/** Normalise to '#rrggbb'; null when invalid. Drops alpha (use parseColor to keep it). */
export function normalizeHex(input: string): string | null {
  const c = parseColor(input);
  return c ? toHex(c) : null;
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), d = max - Math.min(R, G, B);
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hh = (((h % 360) + 360) % 360) / 60;
  const S = clamp(s, 0, 1), V = clamp(v, 0, 1);
  const c = V * S, x = c * (1 - Math.abs((hh % 2) - 1)), m = V - c;
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return { r: byte((r + m) * 255), g: byte((g + m) * 255), b: byte((b + m) * 255) };
}

export const hexToHsv = (hex: string): HSV | null => { const c = parseColor(hex); return c ? rgbToHsv(c) : null; };
export const hsvToHex = (c: HSV): string => toHex(hsvToRgb(c));

/** CSS rgba() string for display; opacity 0..1. */
export function cssRgba(hex: string, opacity = 1): string {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${+(c.a * clamp(opacity, 0, 1)).toFixed(3)})`;
}

/** WCAG relative luminance (0..1). */
export function luminance({ r, g, b }: RGB): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** WCAG contrast ratio 1..21 between two colours (hex strings or RGB). */
export function contrast(a: string | RGB, b: string | RGB): number {
  const la = luminance(typeof a === 'string' ? parseColor(a) ?? { r: 0, g: 0, b: 0 } : a);
  const lb = luminance(typeof b === 'string' ? parseColor(b) ?? { r: 0, g: 0, b: 0 } : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
