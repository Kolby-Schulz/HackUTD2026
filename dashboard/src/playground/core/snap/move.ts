// Edge and center snapping for moves (ALIGN-1, 4, 6, 7, 35). Pure: no React or DOM.
// The box is the union AABB of the moving selection in world space, already offset by the raw pointer delta.
import type { SnapCtx, SnapLine, SnapResult } from '../snap';
import type { Rect, ShapeId } from '../types';
import { collectCandidates, getSnapSource } from './candidates';
import type { Candidate } from './candidates';
import { withParent } from './parent';
import { snapSpacing } from './spacing';

const NONE: SnapResult = { dx: 0, dy: 0, lines: [], gaps: [] };
const EPS = 0.01;
/** Extra screen px a held snap survives past the threshold (ALIGN-1 hysteresis). */
export const HYSTERESIS_PX = 2;
const FAR = 1e9; // no viewport known: consider the whole board

type Axis = 'x' | 'y';
type Held = { at: number; src: number };
type Memory = { sig: string; x: Held | null; y: Held | null };
const memory = new Map<string, Memory>();

/** Forget hysteresis state; gestures call this on pointer-up / abort. */
export function resetSnapMemory(actor?: string): void { if (actor) memory.delete(actor); else memory.clear(); }

/** Start, size of a rect along an axis. */
const span = (r: Rect, a: Axis): [number, number] => (a === 'x' ? [r.x, r.w] : [r.y, r.h]);
/** Candidate line positions along an axis: start, center, end. */
const lines3 = (r: Rect, a: Axis): [number, number, number] => {
  const [s, z] = span(r, a);
  return [s, s + z / 2, s + z];
};

type Pick = { d: number; src: number; at: number; dist: number };

function best(box: Rect, cands: Candidate[], a: Axis, t: number): Pick | null {
  const [s0, size] = span(box, a);
  const srcs = [s0, s0 + size / 2, s0 + size];
  const o = a === 'x' ? 'y' : 'x';
  const [b0, bz] = span(box, o);
  const bc = b0 + bz / 2;
  // Center sources must not drag a small shape across a big one (ALIGN-4 clamp).
  const centerT = Math.min(t, 0.25 * Math.min(box.w, box.h));
  let pick: Pick | null = null;
  for (const c of cands) {
    const cl = lines3(c.box, a);
    const [c0, cz] = span(c.box, o);
    const dist = Math.abs(c0 + cz / 2 - bc);
    for (let si = 0; si < 3; si++) {
      const lim = si === 1 ? centerT : t;
      for (let ci = 0; ci < 3; ci++) {
        const d = cl[ci] - srcs[si];
        const ad = Math.abs(d);
        if (ad > lim) continue;
        if (!pick || ad < Math.abs(pick.d) - EPS || (Math.abs(ad - Math.abs(pick.d)) <= EPS && dist < pick.dist)) {
          pick = { d, src: si, at: cl[ci], dist };
        }
      }
    }
  }
  return pick;
}

/** Re-use last frame's line if it is still a candidate line and within threshold + hysteresis of the raw box. */
function held(box: Rect, cands: Candidate[], a: Axis, h: Held | null, limit: number): Pick | null {
  if (!h) return null;
  const [s0, size] = span(box, a);
  const raw = s0 + (h.src * size) / 2;
  const d = h.at - raw;
  if (Math.abs(d) > limit) return null;
  const alive = cands.some((c) => lines3(c.box, a).some((v) => Math.abs(v - h.at) <= EPS));
  return alive ? { d, src: h.src, at: h.at, dist: 0 } : null;
}

function guide(box: Rect, cands: Candidate[], a: Axis, at: number, src: number, tol: number): SnapLine {
  const o = a === 'x' ? 'y' : 'x';
  const [b0, bz] = span(box, o);
  let from = b0, to = b0 + bz;
  for (const c of cands) {
    if (!lines3(c.box, a).some((v) => Math.abs(v - at) <= tol)) continue;
    const [c0, cz] = span(c.box, o);
    from = Math.min(from, c0); to = Math.max(to, c0 + cz);
  }
  return { axis: a, at, from, to, kind: src === 1 ? 'center' : 'edge' };
}

export function snapMoveImpl(box: Rect, ctx: SnapCtx): SnapResult {
  const src = getSnapSource();
  const t = ctx.thresholdWorld;
  if (!src || !(t > 0) || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w < 0 || box.h < 0) return NONE;

  const isHuman = ctx.actor.startsWith('human');
  const hyst = isHuman ? HYSTERESIS_PX / Math.max(src.zoom?.() ?? 1, 1e-6) : 0;
  const vp = src.viewport?.() ?? null;
  const region: Rect = vp
    ? { x: vp.x - t, y: vp.y - t, w: vp.w + 2 * t, h: vp.h + 2 * t }
    : { x: -FAR, y: -FAR, w: 2 * FAR, h: 2 * FAR };
  const cands = withParent(collectCandidates(src, region, ctx.ignore as Set<ShapeId>, ctx.parent, box), src, ctx.parent, ctx.ignore);

  const sig = [...ctx.ignore].sort().join(',') + '|' + (ctx.parent ?? '');
  let mem = memory.get(ctx.actor);
  if (!mem || mem.sig !== sig) mem = { sig, x: null, y: null };
  const round = src.round?.() ?? true;

  const next: Memory = { sig, x: null, y: null };
  const out: SnapResult = { dx: 0, dy: 0, lines: [], gaps: [] };
  const snapped: { axis: Axis; at: number; src: number }[] = [];
  for (const a of ['x', 'y'] as const) {
    const pick = (isHuman ? held(box, cands, a, mem[a], t + hyst) : null) ?? best(box, cands, a, t);
    if (!pick) continue;
    const [s0, size] = span(box, a);
    const mul = pick.src / 2;
    let d = pick.d;
    let at = pick.at;
    if (round) {
      const start = Math.round(s0 + d); // the box's origin lands on an integer
      d = start - s0;
      at = start + mul * size;
    }
    if (a === 'x') out.dx = d; else out.dy = d;
    next[a] = { at: pick.at, src: pick.src };
    snapped.push({ axis: a, at, src: pick.src });
  }
  if (snapped.length) memory.set(ctx.actor, next); else memory.delete(ctx.actor);

  // equal-spacing snap on the axes no edge snap holds (ALIGN-14); no hysteresis yet
  const free = (['x', 'y'] as const).filter((a) => !snapped.some((s) => s.axis === a));
  if (free.length) {
    const edged: Rect = { x: box.x + out.dx, y: box.y + out.dy, w: box.w, h: box.h };
    const sp = snapSpacing(edged, cands, t, round, free);
    out.dx += sp.dx; out.dy += sp.dy;
    out.gaps.push(...sp.gaps);
  }

  const final: Rect = { x: box.x + out.dx, y: box.y + out.dy, w: box.w, h: box.h };
  for (const s of snapped) out.lines.push(guide(final, cands, s.axis, s.at, s.src, round ? 0.5 + EPS : EPS));
  return out;
}
