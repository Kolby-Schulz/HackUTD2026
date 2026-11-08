// Draw a frame / rectangle / ellipse: click for the default size, drag to size. The new layer is
// created inside the frame under the pointer (parent + local coordinates, D1). One gesture, one
// undo entry; Escape aborts; the new layer is selected and the tool returns to Move.
import { newId } from '../../core/ids';
import { norm } from '../../core/geom';
import { frameAt, toLocal } from '../../core/tree';
import type { Command, Gesture, Kind, Pt, ShapeId, ShapeProps } from '../../core/types';
import { selectIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { Mode, PointerInfo } from './pipeline';

export type DrawKind = Extract<Kind, 'frame' | 'rect' | 'ellipse'>;
export const DEFAULT_SIZE: Record<DrawKind, { w: number; h: number }> = { frame: { w: 320, h: 240 }, rect: { w: 120, h: 120 }, ellipse: { w: 120, h: 120 } };
const STYLE: Record<DrawKind, Partial<ShapeProps>> = {
  frame: { fills: [{ type: 'solid', color: '#ffffff' }], radius: 12, clip: true },
  rect: { fills: [{ type: 'solid', color: '#d9d6cf' }], radius: 4 },
  ellipse: { fills: [{ type: 'solid', color: '#d9d6cf' }] },
};
const CLICK_MAX = 4;   // world units: smaller than this on release = a click

/** Props for a drawn shape from its local start point to the local pointer (default size for a click). */
export function drawProps(kind: DrawKind, name: string, a: Pt, b: Pt, final: boolean): Partial<ShapeProps> {
  let box = norm({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
  if (final && box.w < CLICK_MAX && box.h < CLICK_MAX) box = { x: a.x, y: a.y, ...DEFAULT_SIZE[kind] };
  return { name, ...STYLE[kind], ...box };
}

export function startCreate(env: BoardEnv, p0: PointerInfo, kind: DrawKind): Mode {
  const { board } = env;
  const st = board.doc.getState();
  const parent: ShapeId | null = frameAt(st, p0.world);
  const a = toLocal(st, parent, p0.world);
  let n = 1;
  for (const s of st.shapes.values()) if (!s.deleted && s.kind === kind) n++;
  const name = `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`;
  const id = newId('s');
  const g: Gesture = board.gesture(board.me, `Draw ${kind}`);
  const cmd = (p: Pt, final: boolean): Command[] =>
    [{ t: 'shape.create', kind, id, parent, props: drawProps(kind, name, a, toLocal(st, parent, p), final) }];
  g.update(cmd(p0.world, false));
  return {
    move(p) { g.update(cmd(p.world, false)); },
    up(p) {
      g.update(cmd(p.world, true));
      const r = g.commit();
      if (r.ok) selectIds(board, [id]);
      env.ui.set({ tool: 'select' });
    },
    cancel() { g.abort(); env.ui.set({ tool: 'select' }); },
  };
}
