// Move the selection as one gesture (SELECT-20), Shift = axis lock (SELECT-21), drop into / out of
// frames (SELECT-34). Each frame re-plans the whole move from the base: absolute deltas since
// pointer-down, then a reparent (keepWorld) when the pointer is over another frame than the one
// the shape sits in. Commit = one undo entry; Escape aborts. Mod while dropping = do not reparent.
import { snapMove, snapResult } from '../../core/snap';
import { ancestors, descendants, frameAt, toLocal, toWorld, worldBounds } from '../../core/tree';
import type { Command, Gesture, Pt, Rect, ShapeId } from '../../core/types';
import { selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { Mode, PointerInfo } from './pipeline';

const SLOP_PX = 2;

/** Constrain a world delta to its dominant axis (equal: x wins). */
export function lockAxis(dx: number, dy: number): Pt {
  return Math.abs(dx) >= Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy };
}

export function startMove(env: BoardEnv, p0: PointerInfo): Mode | null {
  const { board } = env;
  const start = board.doc.getState();
  const live = (id: ShapeId) => { const s = start.shapes.get(id); return s && !s.deleted ? s : undefined; };
  // locked shapes (or inside a locked ancestor) cannot be dragged from the canvas
  const ids = [...selectedIds(board)].filter((id) => live(id) && ![id, ...ancestors(start, id)].some((a) => live(a)?.locked));
  if (!ids.length) return null;
  const parentOf = new Map<ShapeId, ShapeId | null>(ids.map((id) => {
    const s = live(id)!;
    return [id, s.parent != null && live(s.parent) ? s.parent : null];
  }));
  // The frame a shape belongs to for drop purposes (a group child stays "in" its frame ancestor).
  const containerOf = (id: ShapeId): ShapeId | null => {
    for (let p = parentOf.get(id) ?? null; p; p = live(p)?.parent ?? null) if (live(p)?.kind === 'frame') return p;
    return null;
  };
  // snapping works in the common parent's space; mixed parents fall back to world space
  const parents = new Set(parentOf.values());
  const space: ShapeId | null = parents.size === 1 ? [...parents][0] : null;
  const startBox = (): Rect | null => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const s = live(id)!;
      const r: Rect | null = space ? { x: s.x, y: s.y, w: s.w, h: s.h } : worldBounds(start, id);
      if (!r) continue;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const box0 = startBox();
  const ignore = new Set<ShapeId>(ids);
  ids.forEach((id) => descendants(start, id).forEach((d) => ignore.add(d)));

  // human wins: take over any soft lock an agent holds on what is being dragged
  // agent locks on these shapes are revoked by the lock-aware board.gesture (presence/locks.ts attachLocks)

  let g: Gesture | null = null;

  const plan = (p: PointerInfo): Command[] => {
    let d = { x: p.world.x - p0.world.x, y: p.world.y - p0.world.y };
    if (p.shift) d = lockAxis(d.x, d.y);
    // world delta -> delta in snap space, nudged by the snap engine, back to a world delta
    const o = toLocal(start, space, { x: 0, y: 0 }), e = toLocal(start, space, d);
    let sd = { x: e.x - o.x, y: e.y - o.y };
    if (box0) {
      const res = snapMove({ ...box0, x: box0.x + sd.x, y: box0.y + sd.y },
        { actor: board.me, ignore, thresholdWorld: 5 / env.camera.getCam().z, parent: space });
      // lock first, then snap only along the remaining axis
      const nx = p.shift && d.x === 0 ? 0 : res.dx, ny = p.shift && d.y === 0 ? 0 : res.dy;
      sd = { x: sd.x + nx, y: sd.y + ny };
      snapResult.set({ ...res, dx: nx, dy: ny });
    }
    const w0 = toWorld(start, space, { x: 0, y: 0 }), w1 = toWorld(start, space, sd);
    const wd = { x: w1.x - w0.x, y: w1.y - w0.y };
    const cmds: Command[] = ids.map((id) => {
      const parent = parentOf.get(id) ?? null;
      const a = toLocal(start, parent, { x: 0, y: 0 }), b = toLocal(start, parent, wd);
      return { t: 'shape.translate', ids: [id], dx: b.x - a.x, dy: b.y - a.y };
    });
    if (!p.mod) {
      const target = frameAt(start, p.world, { exclude: ids });
      // only frames at the root of a drag target change parent; moved shapes already there stay put
      const byFrom = ids.filter((id) => containerOf(id) !== target && (target !== null || containerOf(id) !== null));
      // a group child dragged within its own frame hierarchy keeps its group (target equals its container)
      if (byFrom.length) cmds.push({ t: 'shape.reparent', ids: byFrom, parent: target, keepWorld: true });
    }
    return cmds;
  };

  const move = (p: PointerInfo) => {
    if (!g) {
      if (Math.hypot(p.clientX - p0.clientX, p.clientY - p0.clientY) < SLOP_PX) return;
      g = board.gesture(board.me, ids.length > 1 ? `Move ${ids.length} layers` : 'Move');
    }
    g.update(plan(p));
  };
  return {
    move,
    up(p) {
      move(p);
      g?.commit();   // a click without motion opened no gesture: nothing recorded
      snapResult.clear();
    },
    cancel() { g?.abort(); snapResult.clear(); },
  };
}
