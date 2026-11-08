// Layer row actions (LAYERS-7/8, SELECT-27/28): rename request signal, lock/hide toggles, and their shortcuts.
// The helpers take a board so tests need no DOM; the row buttons and the shortcuts share them.
import type { BoardKit } from '../core/commands';
import { opId } from '../core/ids';
import { toast } from '../core/toast';
import type { Action, ShapeId } from '../core/types';
import { activeBoard, selectedIds } from '../ui/board/state';

export type Flag = 'locked' | 'hidden';
export const MAX_NAME = 256;

// ---- rename request: the row whose name should turn into an input (one at a time) ----
let renaming: ShapeId | null = null;
const listeners = new Set<() => void>();
export const getRenaming = (): ShapeId | null => renaming;
export const subscribeRenaming = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function requestRename(id: ShapeId | null) {
  if (renaming === id) return;
  renaming = id;
  for (const l of [...listeners]) l();
}

/** Commit a new name: trimmed, capped, empty reverts (returns false). One command = one undo entry. */
export function renameShape(b: BoardKit, id: ShapeId, raw: string): boolean {
  const name = raw.trim().slice(0, MAX_NAME);
  const s = b.doc.getState().shapes.get(id);
  if (!s || !name) return false;
  if (name === s.name) return true;
  const r = b.exec({ actor: b.me, opId: opId(b.me), commands: [{ t: 'shape.update', ids: [id], patch: { name, nameAuto: false } }] });
  return r.ok;
}

/** Toggle: if any target is off, switch all on; otherwise switch all off. */
export function toggleFlag(b: BoardKit, ids: readonly ShapeId[], flag: Flag): boolean {
  const shapes = b.doc.getState().shapes;
  const live = ids.filter((id) => { const s = shapes.get(id); return s && !s.deleted; });
  if (!live.length) return false;
  const on = live.some((id) => !shapes.get(id)![flag]);
  const r = b.exec({ actor: b.me, opId: opId(b.me), commands: [{ t: 'shape.update', ids: [...live], patch: { [flag]: on } }] });
  if (!r.ok) { toast(`Could not ${flag === 'locked' ? 'lock' : 'hide'}`, { variant: 'warn', key: 'layers.flag', onceMs: 1500 }); return false; }
  return true;
}

/** Alt+click on an eye: show this layer and hide its siblings; when already solo, show everything. */
export function soloVisible(b: BoardKit, id: ShapeId): boolean {
  const st = b.doc.getState();
  const me = st.shapes.get(id);
  if (!me) return false;
  const sibs = (st.children.get(me.parent) ?? []).filter((x) => x !== id && !st.shapes.get(x)?.deleted);
  if (!sibs.length) return false;
  const alreadySolo = !me.hidden && sibs.every((x) => st.shapes.get(x)!.hidden);
  const commands = alreadySolo
    ? [{ t: 'shape.update' as const, ids: sibs, patch: { hidden: false } }]
    : [{ t: 'shape.update' as const, ids: sibs, patch: { hidden: true } }, { t: 'shape.update' as const, ids: [id], patch: { hidden: false } }];
  return b.exec({ actor: b.me, opId: opId(b.me), commands }).ok;
}

/** Figma opacity keys: 1..9 = 10%..90%, 0 = 100%. One shape.update, one undo entry. */
export function setOpacity(b: BoardKit, ids: readonly ShapeId[], value: number): boolean {
  const shapes = b.doc.getState().shapes;
  const live = ids.filter((id) => { const s = shapes.get(id); return s && !s.deleted; });
  if (!live.length) return false;
  return b.exec({ actor: b.me, opId: opId(b.me), commands: [{ t: 'shape.update', ids: [...live], patch: { opacity: value } }], label: `Opacity ${Math.round(value * 100)}%` }).ok;
}

const withBoard = (fn: (b: BoardKit) => void) => () => { const env = activeBoard(); if (env && !env.ui.get().editing) fn(env.board); };

const opacityActions: Action[] = Array.from({ length: 10 }, (_, d) => ({
  id: `layers.opacity${d}`, title: `Set opacity to ${d === 0 ? 100 : d * 10}%`, group: 'Edit' as const, keys: { all: [`Digit${d}`] }, contexts: ['canvas', 'panel'] as Action['contexts'],
  // contexts exclude text fields; the editing check also covers the on-canvas text editor
  run: withBoard((b) => setOpacity(b, selectedIds(b), d === 0 ? 1 : d / 10)),
}));

export const actions: Action[] = [
  ...opacityActions,
  { id: 'layers.lock', title: 'Lock / unlock selection', group: 'Edit', keys: { all: ['Mod+Shift+l'] }, contexts: ['canvas', 'panel'], run: withBoard((b) => toggleFlag(b, selectedIds(b), 'locked')) },
  { id: 'layers.hide', title: 'Show / hide selection', group: 'Edit', keys: { all: ['Mod+Shift+h'] }, contexts: ['canvas', 'panel'], run: withBoard((b) => toggleFlag(b, selectedIds(b), 'hidden')) },
  {
    id: 'layers.rename', title: 'Rename layer', group: 'Edit', keys: { all: ['Enter'] }, contexts: ['panel'],
    when: () => { const env = activeBoard(); return env && selectedIds(env.board).length === 1 ? true : 'Select one layer'; },
    run: withBoard((b) => { const ids = selectedIds(b); if (ids.length === 1) requestRename(ids[0]); }),
  },
];
