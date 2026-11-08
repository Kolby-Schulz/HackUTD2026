// Snapping for resizes and the draw tools (ALIGN-3, ALIGN-8, ALIGN-23). Pure: no React or DOM.
// Only the dragged edges are sources; anchor edges never move. Candidates are siblings plus the parent frame.
//
// snapResize takes the RAW (unsnapped) box in world space. For a flipped resize pass either the signed box
// (negative w/h: x/y is the fixed anchor, x+w / y+h the pointer side) or the normalised box with the handle
// that now moves (e.g. 'w' once an 'e' drag has crossed the anchor). dx/dy are nudges for the MOVING edge
// (add dx to the right edge for 'e', to the left edge for 'w'). Shift/Alt handling is the caller's job.
import type { ResizeHandle, SnapCtx, SnapLine, SnapResult } from '../snap';
import type { Pt, Rect, ShapeId } from '../types';
import { collectCandidates, getSnapSource } from './candidates';
import type { Candidate } from './candidates';
import { HYSTERESIS_PX } from './move';
import { withParent } from './parent';

const NONE: SnapResult = { dx: 0, dy: 0, lines: [], gaps: [] };
const EPS = 0.01;
const FAR = 1e9;
const MIN_SIZE = 1;

type Axis = 'x' | 'y';
type Held = { at: number; center: boolean };
type Memory = { sig: string; x: Held | null; y: Held | null };
const memory = new Map<string, Memory>();

/** Forget resize/create hysteresis state; gestures call this on pointer-up / abort. */
export function resetResizeSnapMemory(actor?: string): void { if (actor) memory.delete(actor); else memory.clear(); }

const lines3 = (r: Rect, a: Axis): [number, number, number] => {
  const s = a === 'x' ? r.x : r.y, z = a === 'x' ? r.w : r.h;
  return [s, s + z / 2, s + z];
};

/** One moving line: its axis, raw position, the fixed anchor (null for a point), and the other-axis centre for ties. */
type Src = { axis: Axis; pos: number; anchor: number | null; mid: number };
type Pick = { d: number; at: number; center: boolean };

function best(s: Src, cands: Candidate[], t: number): Pick | null {
  const o: Axis = s.axis === 'x' ? 'y' : 'x';
  let pick: Pick | null = null, pickDist = 0;
  for (const c of cands) {
    const cl = lines3(c.box, s.axis);
    const oc = lines3(c.box, o)[1];
    const dist = Math.abs(oc - s.mid);
    for (let i = 0; i < 3; i++) {
      const d = cl[i] - s.pos;
      const ad = Math.abs(d);
      if (ad > t) continue;
      if (s.anchor !== null && Math.abs(cl[i] - s.anchor) < MIN_SIZE) continue; // never collapse below 1 unit
      if (!pick || ad < Math.abs(pick.d) - EPS || (Math.abs(ad - Math.abs(pick.d)) <= EPS && dist < pickDist)) {
        pick = { d, at: cl[i], center: i === 1 }; pickDist = dist;
      }
    }
  }
  return pick;
}

function held(s: Src, cands: Candidate[], h: Held | null, limit: number): Pick | null {
  if (!h) return null;
  const d = h.at - s.pos;
  if (Math.abs(d) > limit) return null;
  if (s.anchor !== null && Math.abs(h.at - s.anchor) < MIN_SIZE) return null;
  return cands.some((c) => lines3(c.box, s.axis).some((v) => Math.abs(v - h.at) <= EPS)) ? { d, at: h.at, center: h.center } : null;
}

/** Shared core: snap each source line, then build guides spanning `extent(axis)` plus every candidate on the line. */
function run(srcs: Src[], ctx: SnapCtx, near: Rect, kindKey: string, extent: (a: Axis, snapped: Map<Axis, number>) => [number, number]): SnapResult {
  const src = getSnapSource();
  const t = ctx.thresholdWorld;
  if (!src || !(t > 0) || srcs.length === 0) return NONE;
  if (!srcs.every((s) => Number.isFinite(s.pos) && Number.isFinite(s.mid))) return NONE;

  const isHuman = ctx.actor.startsWith('human');
  const hyst = isHuman ? HYSTERESIS_PX / Math.max(src.zoom?.() ?? 1, 1e-6) : 0;
  const vp = src.viewport?.() ?? null;
  const region: Rect = vp
    ? { x: vp.x - t, y: vp.y - t, w: vp.w + 2 * t, h: vp.h + 2 * t }
    : { x: -FAR, y: -FAR, w: 2 * FAR, h: 2 * FAR };
  const ignore = ctx.ignore as Set<ShapeId>;
  const cands = withParent(collectCandidates(src, region, ignore, ctx.parent, near), src, ctx.parent, ignore);
  if (cands.length === 0) { memory.delete(ctx.actor); return NONE; }

  const sig = kindKey + '|' + [...ctx.ignore].sort().join(',') + '|' + (ctx.parent ?? '');
  let mem = memory.get(ctx.actor);
  if (!mem || mem.sig !== sig) mem = { sig, x: null, y: null };
  const round = src.round?.() ?? true;

  const next: Memory = { sig, x: null, y: null };
  const out: SnapResult = { dx: 0, dy: 0, lines: [], gaps: [] };
  const snapped = new Map<Axis, number>();
  const hits: { axis: Axis; at: number; center: boolean }[] = [];
  for (const s of srcs) {
    const pick = (isHuman ? held(s, cands, mem[s.axis], t + hyst) : null) ?? best(s, cands, t);
    if (!pick) continue;
    let d = pick.d, at = pick.at;
    if (round) { at = Math.round(s.pos + d); d = at - s.pos; }
    if (s.anchor !== null && Math.abs(at - s.anchor) < MIN_SIZE) continue;
    if (s.axis === 'x') out.dx = d; else out.dy = d;
    next[s.axis] = { at: pick.at, center: pick.center };
    snapped.set(s.axis, at);
    hits.push({ axis: s.axis, at, center: pick.center });
  }
  if (hits.length) memory.set(ctx.actor, next); else memory.delete(ctx.actor);

  const tol = round ? 0.5 + EPS : EPS;
  for (const h of hits) {
    let [from, to] = extent(h.axis === 'x' ? 'y' : 'x', snapped);
    for (const c of cands) {
      if (!lines3(c.box, h.axis).some((v) => Math.abs(v - h.at) <= tol)) continue;
      const [c0, , c2] = lines3(c.box, h.axis === 'x' ? 'y' : 'x');
      from = Math.min(from, c0); to = Math.max(to, c2);
    }
    const line: SnapLine = { axis: h.axis, at: h.at, from, to, kind: h.center ? 'center' : 'edge' };
    out.lines.push(line);
  }
  return out;
}

export function snapResizeImpl(box: Rect, handle: ResizeHandle, ctx: SnapCtx): SnapResult {
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite)) return NONE;
  const movesE = handle.includes('e'), movesW = handle.includes('w');
  const movesS = handle.includes('s'), movesN = handle.includes('n');
  const x1 = box.x + box.w, y1 = box.y + box.h;
  const near: Rect = { x: Math.min(box.x, x1), y: Math.min(box.y, y1), w: Math.abs(box.w), h: Math.abs(box.h) };

  const srcs: Src[] = [];
  const mx = near.x + near.w / 2, my = near.y + near.h / 2;
  if (movesE) srcs.push({ axis: 'x', pos: x1, anchor: box.x, mid: my });
  else if (movesW) srcs.push({ axis: 'x', pos: box.x, anchor: x1, mid: my });
  if (movesS) srcs.push({ axis: 'y', pos: y1, anchor: box.y, mid: mx });
  else if (movesN) srcs.push({ axis: 'y', pos: box.y, anchor: y1, mid: mx });

  // Extent of the final box along `a` (the guide runs along the other axis from the one that snapped).
  const extent = (a: Axis, sn: Map<Axis, number>): [number, number] => {
    const lo = a === 'x' ? box.x : box.y, hi = a === 'x' ? x1 : y1;
    const moving = a === 'x' ? (movesE ? hi : movesW ? lo : null) : (movesS ? hi : movesN ? lo : null);
    const v = sn.get(a);
    let p = lo, q = hi;
    if (v !== undefined && moving !== null) { if (moving === hi) q = v; else p = v; }
    return [Math.min(p, q), Math.max(p, q)];
  };
  return run(srcs, ctx, near, 'r:' + handle, extent);
}

/** Snap a point (ALIGN-23): the start of a draw drag, or its live corner. Both axes, point-sized source. */
export function snapCreateImpl(pt: Pt, ctx: SnapCtx): SnapResult {
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return NONE;
  const srcs: Src[] = [
    { axis: 'x', pos: pt.x, anchor: null, mid: pt.y },
    { axis: 'y', pos: pt.y, anchor: null, mid: pt.x },
  ];
  const extent = (a: Axis, sn: Map<Axis, number>): [number, number] => {
    const v = a === 'x' ? (sn.get('x') ?? pt.x) : (sn.get('y') ?? pt.y);
    return [v, v];
  };
  return run(srcs, ctx, { x: pt.x, y: pt.y, w: 0, h: 0 }, 'c', extent);
}
