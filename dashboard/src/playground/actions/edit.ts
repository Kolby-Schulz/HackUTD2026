// Edit actions: undo / redo act on the human's own stack only (agent work is untouched, D3),
// delete removes the selection (with descendants), escape cancels a drag or clears state.
import { opId } from '../core/ids';
import type { Action } from '../core/types';
import { activeBoard, selectIds, selectedIds } from '../ui/board/state';

export const actions: Action[] = [
  {
    id: 'edit.undo', title: 'Undo', group: 'Edit', keys: { all: ['Mod+z'] }, contexts: ['canvas', 'panel'],
    run() { const env = activeBoard(); if (env && !env.cancelGesture()) env.board.undo(env.board.me); },
  },
  {
    id: 'edit.redo', title: 'Redo', group: 'Edit', keys: { all: ['Mod+Shift+z'], win: ['Mod+y'] }, contexts: ['canvas', 'panel'],
    run() { const env = activeBoard(); if (env) env.board.redo(env.board.me); },
  },
  {
    id: 'edit.delete', title: 'Delete', group: 'Edit', keys: { all: ['Delete', 'Backspace'] }, contexts: ['canvas', 'panel'],
    run() {
      const env = activeBoard();
      if (!env || env.ui.get().editing) return;
      const ids = [...selectedIds(env.board)];
      if (!ids.length) return;
      env.board.exec({ actor: env.board.me, opId: opId(env.board.me), commands: [{ t: 'shape.delete', ids }] });
      selectIds(env.board, []);
    },
  },
  {
    id: 'edit.escape', title: 'Cancel / deselect', group: 'Edit', keys: { all: ['Escape'] }, contexts: ['canvas', 'panel'],
    run() {
      const env = activeBoard();
      if (!env || env.cancelGesture()) return;           // Escape mid-drag only cancels the drag
      env.ui.set({ pop: null, hover: null, tool: 'select' });
      env.ui.emitEscape();
      selectIds(env.board, []);
    },
  },
];
