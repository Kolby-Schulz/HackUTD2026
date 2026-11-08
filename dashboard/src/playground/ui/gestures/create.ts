// Draw a frame / rectangle / ellipse: click for the default size, drag to size. The new layer is
// created inside the frame under the pointer (parent + local coordinates, D1). One gesture, one
// undo entry; Escape aborts; the new layer is selected and the tool returns to Move.
import { newId } from '../../core/ids';
import type { Rect } from '../../core/types';
import { snapCreate, snapResult } from '../../core/snap';
import { frameAt, toLocal } from '../../core/tree';
import type { Command, Gesture, Kind, Pt, ShapeId, ShapeProps } from '../../core/types';
import { selectIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { Mode, PointerInfo } from './pipeline';

export type DrawKind = Extract<Kind, 'frame' | 'rect' | 'ellipse'>;
export const DEFAULT_SIZE: Record<DrawKind, { w: number; h: number }> = { frame: { w: 320, h: 240 }, rect: { w: 100, h: 100 }, ellipse: { w: 100, h: 100 } };
const STYLE: Record<DrawKind, Partial<ShapeProps>> = {
  frame: { fills: [{ type: 'solid', color: '#ffffff' }], radius: 12, clip: true },
  rect: { fills: [{ type: 'solid', color: '#d9d6cf' }], radius: 4 },
  ellipse: { fills: [{ type: 'solid', color: '#d9d6cf' }] },
};
const CLICK_MAX = 4;   // world units: smaller than this on release = a click

export type DrawMods = { shift?: boolean; alt?: boolean };

/** The drawn box from the local start point `a` to the local pointer `b`. Shift = square, Alt = grow from `a` as centre. */
export function drawBox(kind: DrawKind, a: Pt, b: Pt, final: boolean, mods: DrawMods = {}): Rect {
  let dx = b.x - a.x, dy = b.y - a.y;
  if (final && Math.abs(dx) < CLICK_MAX && Math.abs(dy) < CLICK_MAX) {
    const { w, h } = DEFAULT_SIZE[kind];
    return mods.alt ? { x: Math.round(a.x - w / 2), y: Math.round(a.y - h / 2), w, h } : { x: Math.round(a.x), y: Math.round(a.y), w, h };
  }
  if (mods.shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * m; dy = (dy < 0 ? -1 : 1) * m;
  }
  const x0 = mods.alt ? a.x - dx : a.x, y0 = mods.alt ? a.y - dy : a.y;
  const x = Math.round(Math.min(x0, a.x + dx)), y = Math.round(Math.min(y0, a.y + dy));
  return { x, y, w: Math.round(Math.abs(mods.alt ? 2 * dx : dx)), h: Math.round(Math.abs(mods.alt ? 2 * dy : dy)) };
}

/** Props for a drawn shape (default size for a click). */
export function drawProps(kind: DrawKind, name: string, a: Pt, b: Pt, final: boolean, mods: DrawMods = {}): Partial<ShapeProps> {
  return { name, ...STYLE[kind], ...drawBox(kind, a, b, final, mods) };
}

export function startCreate(env: BoardEnv, p0: PointerInfo, kind: DrawKind): Mode {
  const { board } = env;
  const st = board.doc.getState();
  const parent: ShapeId | null = frameAt(st, p0.world);
  const z = () => env.camera.getCam().z;
  const ctx = { actor: board.me, ignore: new Set<ShapeId>(), parent };
  // Snap a local point to nearby edges/centres (Mod suspends snapping) and publish the guides.
  const snapPt = (pt: Pt, p: PointerInfo): Pt => {
    if (p.mod) { snapResult.clear(); return pt; }
    const r = snapCreate(pt, { ...ctx, thresholdWorld: 5 / z() });
    snapResult.set(r);
    return { x: pt.x + r.dx, y: pt.y + r.dy };
  };
  const a = snapPt(toLocal(st, parent, p0.world), p0);
  let n = 1;
  for (const s of st.shapes.values()) if (!s.deleted && s.kind === kind) n++;
  const name = `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`;
  const id = newId('s');
  const g: Gesture = board.gesture(board.me, `Draw ${kind}`);
  const cmd = (p: PointerInfo, final: boolean): Command[] =>
    [{ t: 'shape.create', kind, id, parent, props: drawProps(kind, name, a, snapPt(toLocal(st, parent, p.world), p), final, p) }];
  g.update(cmd(p0, false));
  return {
    move(p) { g.update(cmd(p, false)); },
    up(p) {
      g.update(cmd(p, true));
      snapResult.clear();
      const r = g.commit();
      if (r.ok) selectIds(board, [id]);
      env.ui.set({ tool: 'select' });
    },
    cancel() { snapResult.clear(); g.abort(); env.ui.set({ tool: 'select' }); },
  };
}
