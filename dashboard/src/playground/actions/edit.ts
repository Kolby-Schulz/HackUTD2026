// Edit actions: undo / redo act on the human's own stack only (agent work is untouched, D3),
// delete removes the selection (with descendants), duplicate clones it at +16,+16, select-all picks
// the siblings in the current scope, escape cancels a drag or clears state.
// The helpers take a board so tests need no DOM; the actions below just hand them the active one.
import type { BoardKit } from '../core/commands';
import { opId } from '../core/ids';
import { toast } from '../core/toast';
import type { Action, Shape, ShapeId } from '../core/types';
import { activeBoard, selectIds, selectedIds } from '../ui/board/state';
import { escapeLadder } from '../ui/gestures/pipeline';

export const DUP_OFFSET = 16;

const liveSet = (b: BoardKit): Set<ShapeId> => {
  const out = new Set<ShapeId>();
  for (const [id, s] of b.doc.getState().shapes) if (!s.deleted) out.add(id);
  return out;
};
const gained = (before: Set<ShapeId>, after: Set<ShapeId>): ShapeId[] => [...after].filter((id) => !before.has(id));

/** After undo/redo bring shapes back (restore or re-create), select them: the selection follows the history. */
function followHistory(b: BoardKit, before: Set<ShapeId>) {
  const shapes = b.doc.getState().shapes;
  const back = gained(before, liveSet(b));
  const roots = back.filter((id) => { const p = shapes.get(id)?.parent; return !p || !back.includes(p); });
  if (roots.length) selectIds(b, roots);
}

export function undoMine(b: BoardKit): boolean {
  const before = liveSet(b);
  const n0 = b.undoManager.last()?.n;
  const ok = b.undo(b.me);
  if (!ok) {
    // an entry was tried but its fields were superseded: not "nothing" (the history UI reports the skip)
    const ev = b.undoManager.last();
    if (ev && ev.n !== n0 && ev.outcome.skipped.length) return false;
    toast('Nothing to undo', { key: 'edit.undo', onceMs: 1500 });
    return false;
  }
  followHistory(b, before);
  return true;
}

export function redoMine(b: BoardKit): boolean {
  const before = liveSet(b);
  const n0 = b.undoManager.last()?.n;
  const ok = b.redo(b.me);
  if (!ok) {
    // an entry was tried but its fields were superseded: not "nothing" (the history UI reports the skip)
    const ev = b.undoManager.last();
    if (ev && ev.n !== n0 && ev.outcome.skipped.length) return false;
    toast('Nothing to redo', { key: 'edit.redo', onceMs: 1500 });
    return false;
  }
  followHistory(b, before);
  return true;
}

export function deleteSelection(b: BoardKit): boolean {
  const ids = [...selectedIds(b)];
  if (!ids.length) { toast('Nothing selected', { key: 'edit.empty', onceMs: 1500 }); return false; }
  const r = b.exec({ actor: b.me, opId: opId(b.me), commands: [{ t: 'shape.delete', ids }] });
  if (!r.ok) {
    const bad = r.results.find((x) => !x.ok);
    toast(bad && !bad.ok && bad.error === 'locked' ? 'Layer is locked' : bad && !bad.ok ? bad.message : 'Could not delete', { variant: 'warn', key: 'edit.delete', onceMs: 1500 });
    return false;
  }
  selectIds(b, []);
  return true;
}

// Repeat-duplicate memory: when the selection is the previous copy and the user moved it, the next one repeats that move.
const lastDup = new WeakMap<BoardKit, { copy: ShapeId; x: number; y: number }>();

function offsetFor(b: BoardKit, ids: readonly ShapeId[]): { x: number; y: number } {
  const last = lastDup.get(b);
  if (last && ids.length === 1 && ids[0] === last.copy) {
    const shapes = b.doc.getState().shapes;
    const c = shapes.get(last.copy);
    if (c && !c.deleted && (c.x !== last.x || c.y !== last.y)) return { x: c.x - last.x, y: c.y - last.y }; // how far the user moved the copy
  }
  return { x: DUP_OFFSET, y: DUP_OFFSET };
}

export function duplicateSelection(b: BoardKit): boolean {
  const ids = [...selectedIds(b)];
  if (!ids.length) { toast('Nothing selected', { key: 'edit.empty', onceMs: 1500 }); return false; }
  const offset = offsetFor(b, ids);
  const before = liveSet(b);
  const r = b.exec({ actor: b.me, opId: opId(b.me), commands: [{ t: 'shape.duplicate', ids, offset }] });
  if (!r.ok) {
    const bad = r.results.find((x) => !x.ok);
    toast(bad && !bad.ok ? bad.message : 'Could not duplicate', { variant: 'warn', key: 'edit.dup', onceMs: 1500 });
    return false;
  }
  const shapes = b.doc.getState().shapes;
  const made = gained(before, liveSet(b));
  const copies = made.filter((id) => { const p = shapes.get(id)?.parent; return !p || !made.includes(p); });
  if (copies.length) {
    selectIds(b, copies);
    if (copies.length === 1 && ids.length === 1) { const c = shapes.get(copies[0])!; lastDup.set(b, { copy: c.id, x: c.x, y: c.y }); }
    else lastDup.delete(b);
  }
  return true;
}

/** Visible, unlocked siblings in the scope of the current selection (or the actor's scope when nothing is selected). */
export function selectAll(b: BoardKit): boolean {
  const st = b.doc.getState();
  const sel = b.selection.get(b.me);
  const first: Shape | undefined = sel.ids.length ? st.shapes.get(sel.ids[0]) : undefined;
  const scope = first ? first.parent ?? null : sel.scope;
  const ids = (st.children.get(scope) ?? []).filter((id) => {
    const s = st.shapes.get(id);
    return s && !s.deleted && !s.hidden && !s.locked;
  });
  if (!ids.length) return false;
  b.exec({ actor: b.me, opId: opId(b.me), commands: [{ t: 'selection.set', ids: [...ids] }] });
  return true;
}

export const actions: Action[] = [
  {
    id: 'edit.undo', title: 'Undo', group: 'Edit', keys: { all: ['Mod+z'] }, contexts: ['canvas', 'panel'],
    run() { const env = activeBoard(); if (env && !env.cancelGesture()) undoMine(env.board); },
  },
  {
    id: 'edit.redo', title: 'Redo', group: 'Edit', keys: { all: ['Mod+Shift+z'], win: ['Mod+y'] }, contexts: ['canvas', 'panel'],
    run() { const env = activeBoard(); if (env) redoMine(env.board); },
  },
  {
    id: 'edit.delete', title: 'Delete', group: 'Edit', keys: { all: ['Delete', 'Backspace'] }, contexts: ['canvas', 'panel'],
    run() {
      const env = activeBoard();
      if (!env || env.ui.get().editing) return;
      deleteSelection(env.board);
    },
  },
  {
    id: 'edit.duplicate', title: 'Duplicate', group: 'Edit', keys: { all: ['Mod+d'] }, contexts: ['canvas', 'panel'],
    run() { const env = activeBoard(); if (env && !env.ui.get().editing) duplicateSelection(env.board); },
  },
  {
    id: 'edit.selectAll', title: 'Select all', group: 'Edit', keys: { all: ['Mod+a'] }, contexts: ['canvas', 'panel'],
    run() { const env = activeBoard(); if (env && !env.ui.get().editing) selectAll(env.board); },
  },
  {
    id: 'edit.escape', title: 'Cancel / deselect', group: 'Edit', keys: { all: ['Escape'] }, contexts: ['canvas', 'panel'],
    run() {
      const env = activeBoard();
      if (!env) return;
      // one step per press: cancel drag, close popover, leave text edit, select parent, clear selection, Move tool
      if (!escapeLadder(env)) env.ui.emitEscape(); // nothing left on the board: shell menus close themselves
    },
  },
];
