// Text tool: click places an empty text layer and opens the editor; double-click edits an
// existing one. A new layer's creation gesture stays open while typing, so "place + type" is one
// undo entry and an empty commit leaves nothing behind.
import { isHuman } from '../../core/actors';
import { newId, opId } from '../../core/ids';
import { frameAt, toLocal } from '../../core/tree';
import type { Pt, ShapeId, ShapeProps } from '../../core/types';
import { selectIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { Mode, PointerInfo } from './pipeline';

const BOX_MIN = 3;   // world units: a text-tool drag narrower than this is a click

/**
 * Place an empty text layer at `world` and open the editor. Without `box` it is auto-width at the
 * click baseline; with `box` (a drag) it is a fixed-width box whose height grows with content.
 */
export function placeText(env: BoardEnv, world: Pt, box?: { w: number }) {
  const { board } = env;
  const st = board.doc.getState();
  const parent = frameAt(st, world);
  const l = toLocal(st, parent, world);
  const id = newId('s');
  const base: Partial<ShapeProps> = { name: 'Text', fills: [], text: '', fontSize: 18, color: '#1c1917' };
  const props: Partial<ShapeProps> = box
    ? { ...base, x: Math.round(l.x), y: Math.round(l.y), w: Math.round(box.w), h: 24, textMode: 'auto-h' }
    : { ...base, x: l.x, y: l.y - 10, w: 200, h: 24, textMode: 'auto-w' };
  const g = board.gesture(board.me, 'Text');
  g.update([{ t: 'shape.create', kind: 'text', id, parent, props }]);
  env.pendingText = { id, g, props, parent };
  selectIds(board, [id]);
  env.ui.set({ editing: id, tool: 'select' });
}

/**
 * Text tool pointer mode: a click places auto-width text (SELECT-41), a drag draws a fixed-width
 * box (SELECT-42, shift = none). The layer is only created on release, so Escape mid-drag leaves nothing.
 */
export function startTextTool(env: BoardEnv, p0: PointerInfo): Mode {
  return {
    move() { /* nothing is created until release */ },
    up(p) {
      const dx = p.world.x - p0.world.x, dy = p.world.y - p0.world.y;
      if (Math.abs(dx) < BOX_MIN && Math.abs(dy) < BOX_MIN) { placeText(env, p0.world); return; }
      const w = Math.max(Math.abs(dx), BOX_MIN);
      placeText(env, { x: Math.min(p0.world.x, p.world.x), y: Math.min(p0.world.y, p.world.y) }, { w });
    },
    cancel() { env.ui.set({ tool: 'select' }); },
  };
}

export function startEditing(env: BoardEnv, id: ShapeId) {
  selectIds(env.board, [id]);
  env.ui.set({ editing: id });
}

/** Editor closed with `value`. Empty text removes the layer (or never creates it). */
export function commitText(env: BoardEnv, id: ShapeId, value: string) {
  const { board } = env;
  if (env.ui.get().editing === id) env.ui.set({ editing: null });
  const name = value.trim().slice(0, 24);
  const pend = env.pendingText;
  if (pend?.id === id) {
    env.pendingText = null;
    try {
      if (!value.trim()) { pend.g.abort(); selectIds(board, []); return; }
      pend.g.update([{ t: 'shape.create', kind: 'text', id, parent: pend.parent, props: { ...pend.props, text: value, name } }]);
      pend.g.commit();
      selectIds(board, [id]);
    } catch { /* superseded by another gesture of ours: nothing to keep */ }
    return;
  }
  const s = board.doc.getState().shapes.get(id);
  if (!s || s.deleted) return;
  // a human changing text an agent wrote pins it: agents may not overwrite it afterwards (TEXT-15)
  const pin = !isHuman(s.createdBy) ? { humanEdited: true } : {};
  const commands = !value.trim()
    ? [{ t: 'shape.delete' as const, ids: [id] }]
    : value !== s.text ? [{ t: 'shape.update' as const, ids: [id], patch: { text: value, name, ...pin } }] : [];
  if (commands.length) board.exec({ actor: board.me, opId: opId(board.me), commands, label: 'Edit text' });
}
