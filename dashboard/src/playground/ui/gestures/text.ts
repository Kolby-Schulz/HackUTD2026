// Text tool: click places an empty text layer and opens the editor; double-click edits an
// existing one. A new layer's creation gesture stays open while typing, so "place + type" is one
// undo entry and an empty commit leaves nothing behind.
import { newId, opId } from '../../core/ids';
import { frameAt, toLocal } from '../../core/tree';
import type { Pt, ShapeId, ShapeProps } from '../../core/types';
import { selectIds } from '../board/state';
import type { BoardEnv } from '../board/state';

export function placeText(env: BoardEnv, world: Pt) {
  const { board } = env;
  const st = board.doc.getState();
  const parent = frameAt(st, world);
  const l = toLocal(st, parent, world);
  const id = newId('s');
  const props: Partial<ShapeProps> = { name: 'Text', x: l.x, y: l.y - 10, w: 200, h: 24, fills: [], text: '', fontSize: 18, color: '#1c1917', textMode: 'auto-h' };
  const g = board.gesture(board.me, 'Text');
  g.update([{ t: 'shape.create', kind: 'text', id, parent, props }]);
  env.pendingText = { id, g, props, parent };
  selectIds(board, [id]);
  env.ui.set({ editing: id, tool: 'select' });
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
  const commands = !value.trim()
    ? [{ t: 'shape.delete' as const, ids: [id] }]
    : value !== s.text ? [{ t: 'shape.update' as const, ids: [id], patch: { text: value, name, humanEdited: true } }] : [];
  if (commands.length) board.exec({ actor: board.me, opId: opId(board.me), commands, label: 'Edit text' });
}
