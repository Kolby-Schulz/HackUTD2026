// Equal-spacing detection for moves (ALIGN-14) and Alt-hover measurement geometry (ALIGN-16). Pure: no React or DOM.
// snapSpacing finds a position where the moving box makes a gap equal to existing gaps between neighbours
// ("between" two shapes, or "extend" an existing rhythm) and returns the nudge plus the SnapGap markers to draw.
import type { SnapGap } from '../snap';
import type { Rect } from '../types';
import type { Candidate } from './candidates';

type Axis = 'x' | 'y';
const EPS = 0.01;
/** Cap on marked gaps so long rows stay readable (ALIGN-14). */
export const MAX_GAP_MARKS = 8;

const lo = (r: Rect, a: Axis) => (a === 'x' ? r.x : r.y);
const len = (r: Rect, a: Axis) => (a === 'x' ? r.w : r.h);
const hi = (r: Rect, a: Axis) => lo(r, a) + len(r, a);
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');

/** Do two boxes share a strictly positive stretch of the given axis? */
function overlapsOn(p: Rect, q: Rect, a: Axis): boolean {
  return Math.min(hi(p, a), hi(q, a)) - Math.max(lo(p, a), lo(q, a)) > EPS;
}

type Plan = { d: number; gap: number; gapsAt: Rect[][] }; // gapsAt: [from-shape, to-shape] pairs to mark (box excluded)

/** Best equal-gap shift of `box` along axis `a`, or null. `t` is the snap distance in world units. */
function planAxis(box: Rect, cands: Candidate[], a: Axis, t: number, round: boolean): { d: number; pairs: Pair[] } | null {
  const o = other(a);
  const row = cands.filter((c) => overlapsOn(c.box, box, o)).map((c) => c.box).sort((p, q) => lo(p, a) - lo(q, a));
  if (row.length === 0) return null;
  const mid = lo(box, a) + len(box, a) / 2;
  const left = row.filter((r) => lo(r, a) + len(r, a) / 2 < mid);
  const right = row.filter((r) => lo(r, a) + len(r, a) / 2 >= mid);
  const A = left.reduce<Rect | null>((m, r) => (!m || hi(r, a) > hi(m, a) ? r : m), null);
  const B = right.reduce<Rect | null>((m, r) => (!m || lo(r, a) < lo(m, a) ? r : m), null);
  const size = len(box, a);
  const snapPos = (v: number) => (round ? Math.round(v) : v);

  type Opt = { d: number; gap: number; kind: 'between' | 'right' | 'left' };
  const opts: Opt[] = [];
  const push = (start: number, gap: number, kind: Opt['kind']) => {
    if (gap < -EPS) return;
    const s = snapPos(start);
    const d = s - lo(box, a);
    if (Math.abs(d) <= t) opts.push({ d, gap, kind });
  };
  if (A && B) {
    const start = (hi(A, a) + lo(B, a) - size) / 2;
    push(start, start - hi(A, a), 'between');
  }
  // extend an existing rhythm: the gap just before A (or just after B) is repeated next to the box
  const prev = A ? row[row.indexOf(A) - 1] : undefined;
  if (A && prev && lo(A, a) - hi(prev, a) >= -EPS) push(hi(A, a) + (lo(A, a) - hi(prev, a)), lo(A, a) - hi(prev, a), 'right');
  const next = B ? row[row.indexOf(B) + 1] : undefined;
  if (B && next && lo(next, a) - hi(B, a) >= -EPS) {
    const g = lo(next, a) - hi(B, a);
    push(lo(B, a) - g - size, g, 'left');
  }
  if (!opts.length) return null;
  const best = opts.reduce((m, p) => (Math.abs(p.d) < Math.abs(m.d) - EPS ? p : m));
  const start = lo(box, a) + best.d;
  const fin: Rect = a === 'x' ? { ...box, x: start } : { ...box, y: start };

  // Pairs to mark: the new gaps next to the box, plus every existing chain gap of the same size.
  const pairs: Pair[] = [];
  if (A && (best.kind === 'between' || best.kind === 'right')) pairs.push({ from: A, to: fin });
  if (B && (best.kind === 'between' || best.kind === 'left')) pairs.push({ from: fin, to: B });
  const tol = round ? 0.5 + EPS : EPS;
  for (let i = 0; i + 1 < row.length && pairs.length < MAX_GAP_MARKS; i++) {
    const g = lo(row[i + 1], a) - hi(row[i], a);
    if (g < -EPS || Math.abs(g - best.gap) > tol) continue;
    // skip pairs already represented by the box (the box sits between them or they touch it)
    if (pairs.some((p) => (p.from === row[i] && p.to === row[i + 1]))) continue;
    if (hi(row[i], a) > lo(fin, a) + EPS && lo(row[i + 1], a) < hi(fin, a) - EPS) continue;
    pairs.push({ from: row[i], to: row[i + 1] });
  }
  return { d: best.d, pairs };
}
type Pair = { from: Rect; to: Rect };

/** Marker for the gap between two boxes along `a`, drawn across the stretch of the perpendicular axis they share. */
function gapOf(p: Pair, box: Rect, a: Axis): SnapGap {
  const o = other(a);
  const from = hi(p.from, a), to = lo(p.to, a);
  // centre of the perpendicular range shared by the moving box and both shapes; fall back to the box centre
  const s = Math.max(lo(p.from, o), lo(p.to, o), lo(box, o));
  const e = Math.min(hi(p.from, o), hi(p.to, o), hi(box, o));
  const at = e > s ? (s + e) / 2 : lo(box, o) + len(box, o) / 2;
  return { axis: a, from, to, at, size: Math.max(0, to - from) };
}

/**
 * Equal-spacing snap. `box` is the moving box (already nudged by any edge snap); `axes` lists the axes spacing may move
 * (those not already held by an edge snap). Returns the extra nudge and the gap markers (with the nudge applied).
 */
export function snapSpacing(
  box: Rect, cands: Candidate[], t: number, round: boolean, axes: readonly Axis[] = ['x', 'y'],
): { dx: number; dy: number; gaps: SnapGap[] } {
  const out = { dx: 0, dy: 0, gaps: [] as SnapGap[] };
  if (!(t > 0) || cands.length < 1) return out;
  const plans: { a: Axis; p: { d: number; pairs: Pair[] } }[] = [];
  for (const a of axes) {
    const p = planAxis(box, cands, a, t, round);
    if (!p) continue;
    if (a === 'x') out.dx = p.d; else out.dy = p.d;
    plans.push({ a, p });
  }
  const final: Rect = { x: box.x + out.dx, y: box.y + out.dy, w: box.w, h: box.h };
  for (const { a, p } of plans) for (const pair of p.pairs) out.gaps.push(gapOf(pair, final, a));
  return out;
}

// ---- Alt-hover measurement (ALIGN-16) ----

/** A measured distance: a segment from (x1,y1) to (x2,y2) in world space, `size` world units long. */
export type MeasureLine = { x1: number; y1: number; x2: number; y2: number; size: number };

/** Distances between rect `a` (the selection) and `b` (the hovered shape): outside gaps, or inside offsets on overlap. */
export function measureBetween(a: Rect, b: Rect): MeasureLine[] {
  const out: MeasureLine[] = [];
  const intersect = overlapsOn(a, b, 'x') && overlapsOn(a, b, 'y');
  for (const ax of ['x', 'y'] as const) {
    const o = other(ax);
    // position on the perpendicular axis: middle of the shared range, else the edge of `a` nearest `b`
    const s = Math.max(lo(a, o), lo(b, o)), e = Math.min(hi(a, o), hi(b, o));
    const at = e > s ? (s + e) / 2 : hi(a, o) <= lo(b, o) ? hi(a, o) : lo(a, o);
    const seg = (p: number, q: number) => {
      const size = Math.abs(q - p);
      if (size < EPS) return;
      out.push(ax === 'x' ? { x1: p, y1: at, x2: q, y2: at, size } : { x1: at, y1: p, x2: at, y2: q, size });
    };
    if (hi(a, ax) <= lo(b, ax)) seg(hi(a, ax), lo(b, ax));
    else if (hi(b, ax) <= lo(a, ax)) seg(hi(b, ax), lo(a, ax));
    else if (intersect) { seg(lo(b, ax), lo(a, ax)); seg(hi(a, ax), hi(b, ax)); } // overlap: inside offsets
  }
  return out;
}
