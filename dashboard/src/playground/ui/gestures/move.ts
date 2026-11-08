// Move the selection (frames carry their children: they are local to the frame, D1).
// One board.gesture per drag; each frame re-plans the whole move from the base, so the
// commands carry the total offset since pointer-down. Commit = one undo entry; Escape aborts.
import { toLocal } from '../../core/tree';
import type { Command, Gesture, Pt, ShapeId } from '../../core/types';
import { selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { Mode, PointerInfo } from './pipeline';

const SLOP_PX = 2;

export function startMove(env: BoardEnv, p0: PointerInfo): Mode | null {
  const { board } = env;
  const ids = [...selectedIds(board)];
  if (!ids.length) return null;
  const start = board.doc.getState();
  const parentOf = new Map<ShapeId, ShapeId | null>(ids.map((id) => {
    const s = start.shapes.get(id);
    return [id, s?.parent != null && start.shapes.has(s.parent) ? s.parent : null];
  }));
  let g: Gesture | null = null;

  const cmds = (p: Pt): Command[] => ids.map((id) => {
    const parent = parentOf.get(id) ?? null;
    const a = toLocal(start, parent, p0.world), b = toLocal(start, parent, p);
    return { t: 'shape.translate', ids: [id], dx: b.x - a.x, dy: b.y - a.y };
  });

  const move = (p: PointerInfo) => {
    if (!g) {
      if (Math.hypot(p.clientX - p0.clientX, p.clientY - p0.clientY) < SLOP_PX) return;
      g = board.gesture(board.me, ids.length > 1 ? `Move ${ids.length} layers` : 'Move');
    }
    g.update(cmds(p.world));
  };
  return {
    move,
    up(p) {
      move(p);
      g?.commit();   // a click without motion opened no gesture: nothing recorded
    },
    cancel() { g?.abort(); },
  };
}
