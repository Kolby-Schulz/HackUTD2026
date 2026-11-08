// Fractional string index (D2). Keys are base62 fractions in [0,1): "V" ~ 0.5. Plain string
// comparison (not localeCompare) orders them. Invariant: non-empty, never ends with '0'.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const digit = (c: string | undefined, dflt: number) => (c === undefined ? dflt : DIGITS.indexOf(c));

/** Midpoint of fractions a < b ("" = 0, b === null = 1). Result is strictly between. */
function mid(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++; // shared prefix (a is padded with zeros)
    if (n > 0) return b.slice(0, n) + mid(a.slice(n), b.slice(n));
  }
  const da = digit(a[0], 0);
  const db = b === null ? BASE : digit(b[0], 0);
  if (b === null && a && da < BASE - 1) return DIGITS[da + 1]; // append: step one digit, no halving
  if (b !== null && !a && db >= 2) return DIGITS[db - 1]; // prepend: same, one step down
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1); // b's first digit alone is already < b
  return DIGITS[da] + mid(a.slice(1), null);
}

/**
 * A key strictly between a and b. Missing a = start, missing b = end, both missing = first key.
 * Appending and prepending step one digit at a time (about 1 char per 30); inserting between two keys halves the gap.
 * Tied or reversed neighbours (a >= b, e.g. concurrent inserts) return a key just after a;
 * the sibling sort breaks the tie by id.
 */
export function between(a?: string | null, b?: string | null): string {
  const lo = a ?? '';
  const hi = b ?? null;
  if (hi !== null && lo >= hi) return between(lo, null);
  return mid(lo, hi);
}

/** n evenly spread keys strictly between a and b (initial layouts and rebalancing). */
export function keysBetween(n: number, a?: string | null, b?: string | null): string[] {
  if (n <= 0) return [];
  if (n === 1) return [between(a, b)];
  const m = between(a, b);
  const left = Math.floor((n - 1) / 2);
  return [...keysBetween(left, a, m), m, ...keysBetween(n - 1 - left, m, b)];
}

export function compareIndex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sibling order: index, then id. */
export function compareSiblings(x: { index: string; id: string }, y: { index: string; id: string }): number {
  return compareIndex(x.index, y.index) || compareIndex(x.id, y.id);
}

export function sortKeys<T extends { index: string; id: string }>(items: readonly T[]): T[] {
  return [...items].sort(compareSiblings);
}

/** True when a key has grown long enough that a caller should respread siblings with keysBetween. */
export function needsRebalance(key: string, max = 40): boolean {
  return key.length >= max;
}
