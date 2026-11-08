// Corner resize of the single selected shape: the opposite corner stays put. Absolute box per
// frame (parent space) through one board.gesture; Escape aborts.
import { norm } from '../../core/geom';
import { toLocal } from '../../core/tree';
import type { Gesture, Rect } from '../../core/types';
import { selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { Mode } from './pipeline';
import type { PointerInfo } from './pipeline';

/** Box for dragging `corner` of `orig` to the local point (px, py); the opposite corner is the anchor. */
export function cornerBox(orig: Rect, corner: string, px: number, py: number): Rect {
  const ax = corner.includes('w') ? orig.x + orig.w : orig.x;
  const ay = corner.includes('n') ? orig.y + orig.h : orig.y;
  return norm({ x: ax, y: ay, w: px - ax, h: py - ay });
}

export function startResize(env: BoardEnv, p0: PointerInfo): Mode | null {
  const { board } = env;
  const ids = selectedIds(board);
  const id = ids[ids.length - 1];
  const st = board.doc.getState();
  const s = id ? st.shapes.get(id) : undefined;
  if (!s || !p0.handle) return null;
  const corner = p0.handle;
  const parent = s.parent !== null && st.shapes.has(s.parent) ? s.parent : null;
  const orig: Rect = { x: s.x, y: s.y, w: s.w, h: s.h };
  let g: Gesture | null = null;
  const apply = (p: PointerInfo) => {
    const l = toLocal(st, parent, p.world);
    g ??= board.gesture(board.me, 'Resize');
    g.update([{ t: 'shape.resize', id: s.id, box: cornerBox(orig, corner, l.x, l.y) }]);
  };
  return {
    move: apply,
    up(p) {
      if (!g && p.clientX === p0.clientX && p.clientY === p0.clientY) return;   // click on a handle: no change
      apply(p);
      g!.commit();
    },
    cancel() { g?.abort(); },
  };
}
