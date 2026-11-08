// Per-actor colour assignment (MULTI-3). Pure: no DOM, no store.
// 12 palette colours first (least-used wins), then golden-angle hues with a letter badge.
export const PALETTE = ['#f24e1e', '#a259ff', '#14ae5c', '#ff7262', '#0fa5e9', '#e8a700', '#ec4899', '#6366f1', '#10b981', '#f97316', '#8b5cf6', '#06b6d4'];
const GOLDEN = 137.508;

/** Colour for the n-th actor beyond the palette: fixed saturation and lightness, rotating hue. */
export function generatedColor(n: number): string {
  const h = Math.round(((n - PALETTE.length) * GOLDEN + 20) % 360);
  return `hsl(${h} 75% 34%)`;
}

/** Least-used palette entry (first one on ties); beyond 12 actors a generated hue. */
export function pickColor(inUse: readonly string[]): string {
  const count = new Map<string, number>();
  for (const c of inUse) count.set(c, (count.get(c) ?? 0) + 1);
  let best = PALETTE[0], bestN = Infinity;
  for (const c of PALETTE) { const n = count.get(c) ?? 0; if (n < bestN) { best = c; bestN = n; } }
  if (bestN === 0) return best;
  for (let n = inUse.length; ; n++) { const g = generatedColor(n); if (!count.has(g)) return g; }
}

/**
 * Display colours for a list of actors in a stable order. An actor keeps its own colour when nobody
 * before it has it; otherwise it gets the next free one. `sticky` remembers answers for the session.
 */
export function resolveColors(actors: readonly { id: string; color: string }[], sticky: Map<string, string> = new Map()): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const a of actors) { const s = sticky.get(a.id); if (s && !taken.has(s)) { out.set(a.id, s); taken.add(s); } }
  for (const a of actors) {
    if (out.has(a.id)) continue;
    let c = a.color;
    if (taken.has(c)) c = pickColor([...taken]);
    out.set(a.id, c); taken.add(c); sticky.set(a.id, c);
  }
  return out;
}

/** True when two colours share a name tag letter badge need: any colour outside the 12-colour palette. */
export const needsBadge = (color: string) => !PALETTE.includes(color);

/** Tag letter badge: first letter of the name, upper case. */
export const badgeOf = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/** Relative luminance of #rrggbb or hsl(h s% l%); used to pick tag text colour. */
export function luminance(color: string): number {
  let r = 0, g = 0, b = 0;
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  const hsl = /^hsl\((\d+(?:\.\d+)?) (\d+)% (\d+)%\)$/.exec(color);
  if (hex) { const v = parseInt(hex[1], 16); r = (v >> 16) & 255; g = (v >> 8) & 255; b = v & 255; }
  else if (hsl) {
    const h = +hsl[1], s = +hsl[2] / 100, l = +hsl[3] / 100, a = s * Math.min(l, 1 - l);
    const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    r = f(0); g = f(8); b = f(4);
  }
  const lin = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** Contrast ratio against white. */
export const contrastOnWhite = (color: string) => 1.05 / (luminance(color) + 0.05);
