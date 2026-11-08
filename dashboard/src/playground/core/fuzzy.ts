// Hand-rolled fuzzy matcher (KEYS-10). No React, no DOM. Subsequence match with scoring:
// exact > prefix > word-start > consecutive run > scattered, matched indices returned for highlighting.
export interface FuzzyMatch { score: number; indices: number[] }

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const isBoundary = (s: string, i: number) => i === 0 || /[\s\-_/.:>]/.test(s[i - 1]);

/** Match `query` against `text`. null when the query is not a subsequence. Empty query matches with score 0. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query).replace(/\s+/g, '');
  const t = fold(text);
  if (!q) return { score: 0, indices: [] };
  if (t.length !== text.length) return null;                 // folding changed length (rare); skip rather than mis-highlight
  if (q.length > t.length) return null;
  const whole = t.indexOf(q);
  // Best contiguous hit scores highest: whole-string > prefix > word start > inside a word.
  if (whole >= 0) {
    let best = whole;
    for (let p = whole; p >= 0; p = t.indexOf(q, p + 1)) if (isBoundary(t, p)) { best = p; break; }
    const base = t === q ? 1000 : best === 0 ? 800 : isBoundary(t, best) ? 600 : 400;
    return { score: base - best - (t.length - q.length) * 0.1, indices: range(best, q.length) };
  }
  // Greedy subsequence, preferring word starts and runs.
  const idx: number[] = [];
  let score = 0, prev = -2, from = 0;
  for (let k = 0; k < q.length; k++) {
    let found = -1;
    for (let i = from; i < t.length; i++) {
      if (t[i] !== q[k]) continue;
      if (found < 0) found = i;
      if (i === prev + 1 || isBoundary(t, i)) { found = i; break; }
    }
    if (found < 0) return null;
    score += (found === prev + 1 ? 15 : 0) + (isBoundary(t, found) ? 10 : 0) + 1 - Math.min(found - prev - 1, 10) * 0.2;
    idx.push(found); prev = found; from = found + 1;
  }
  return { score: Math.min(score, 199) - t.length * 0.05, indices: idx };
}

const range = (s: number, n: number) => Array.from({ length: n }, (_, i) => s + i);

export interface Ranked<T> { item: T; score: number; indices: number[]; field: number }

/** Rank items by their best-matching field (field 0 = title, weighted fully; later fields like group/aliases are discounted). */
export function fuzzyRank<T>(query: string, items: readonly T[], fields: (item: T) => string[], tie?: (a: T, b: T) => number): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    let best: Ranked<T> | null = null;
    fields(item).forEach((f, field) => {
      const m = fuzzyMatch(query, f);
      if (!m) return;
      const score = field === 0 ? m.score : m.score * 0.5 - 20;
      if (!best || score > best.score) best = { item, score, indices: m.indices, field };
    });
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score || (tie ? tie(a.item, b.item) : 0));
}
