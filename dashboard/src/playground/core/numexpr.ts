// Safe arithmetic for number fields (PROPS-8). Hand-written recursive descent, no eval.
//   evalNumber('100/2+8')        -> 58
//   evalNumber('50%', 200)       -> 100   (a trailing % is a share of the current value)
//   evalNumber('+10', 200)       -> 210   (leading + or - is relative to the current value)
//   evalNumber('1,5')            -> 1.5   (locale comma)
// Returns null for garbage, division by zero, or a non-finite result.

export const NUM_LIMIT = 1e6;
const MAX_LEN = 200;
const MAX_DEPTH = 40;
const UNITS = /(px|deg|°)/gi;

export interface EvalOpts {
  /** Clamp the result to this range (default +-1e6). */
  min?: number;
  max?: number;
  /** Decimal places kept (default 2). */
  decimals?: number;
}

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ') { i++; continue; }
    if ('+-*/()%'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i;
      while (j < src.length && ((src[j]! >= '0' && src[j]! <= '9') || src[j] === '.')) j++;
      const text = src.slice(i, j);
      if ((text.match(/\./g) ?? []).length > 1 || text === '.') return null;
      out.push({ t: 'num', v: Number(text) });
      i = j;
      continue;
    }
    return null;
  }
  return out;
}

/** Evaluate tokens; `cur` is what a postfix % is a share of. */
function parseTokens(toks: Tok[], cur: number): number | null {
  let p = 0;
  let bad = false;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = peek(); return !!t && t.t === 'op' && t.v === v; };

  function expr(d: number): number {
    if (d > MAX_DEPTH) { bad = true; return 0; }
    let v = term(d);
    while (!bad && (isOp('+') || isOp('-'))) {
      const op = (toks[p++] as { v: string }).v;
      const r = term(d);
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term(d: number): number {
    let v = unary(d);
    while (!bad && (isOp('*') || isOp('/'))) {
      const op = (toks[p++] as { v: string }).v;
      const r = unary(d);
      if (op === '/') { if (r === 0) { bad = true; return 0; } v /= r; } else v *= r;
    }
    return v;
  }
  function unary(d: number): number {
    if (isOp('-')) { p++; return -unary(d + 1); }
    if (isOp('+')) { p++; return unary(d + 1); }
    return postfix(d);
  }
  function postfix(d: number): number {
    let v = atom(d);
    while (!bad && isOp('%')) { p++; v = (v / 100) * cur; }
    return v;
  }
  function atom(d: number): number {
    const t = peek();
    if (!t) { bad = true; return 0; }
    if (t.t === 'num') { p++; return t.v; }
    if (t.v === '(') {
      p++;
      const v = expr(d + 1);
      if (!isOp(')')) { bad = true; return 0; }
      p++;
      return v;
    }
    bad = true;
    return 0;
  }

  const v = expr(0);
  if (bad || p !== toks.length || !Number.isFinite(v)) return null;
  return v;
}

/** Evaluate typed text for a field whose current value is `current`. Null means "revert". */
export function evalNumber(text: string, current = 0, o: EvalOpts = {}): number | null {
  if (typeof text !== 'string' || text.length > MAX_LEN) return null;
  let s = text.trim().replace(UNITS, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // Locale comma: '1,5' reads as 1.5; with a dot present commas are thousands separators.
  s = s.includes('.') ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  const toks = tokenize(s);
  if (!toks || !toks.length) return null;
  let v = parseTokens(toks, current);
  if (v === null) return null;
  // Leading + or - means relative to the current value ('+10', '-10').
  const first = toks[0]!;
  if (first.t === 'op' && (first.v === '+' || first.v === '-')) v = current + v;
  const dec = o.decimals ?? 2;
  const k = 10 ** dec;
  v = Math.round(v * k) / k;
  if (!Number.isFinite(v)) return null;
  const lo = Math.max(o.min ?? -NUM_LIMIT, -NUM_LIMIT);
  const hi = Math.min(o.max ?? NUM_LIMIT, NUM_LIMIT);
  return Math.min(hi, Math.max(lo, v)) + 0; // + 0 turns -0 into 0
}

/** Display text for a value: at most `decimals` places, no trailing zeros. */
export function formatNumber(v: number, decimals = 2): string {
  const k = 10 ** decimals;
  const r = Math.round(v * k) / k;
  return String(Object.is(r, -0) ? 0 : r);
}
