// Arrange actions (SELECT-22/29/32/33, LAYERS-12/13, KEYS-14): arrow nudge, z-order, group, ungroup, frame selection.
// Helpers take a board so tests need no DOM; the actions below just hand them the active one.
// Every edit is one board.exec batch (one undo entry); nudges go through a gesture so a burst coalesces.
import type { BoardKit } from '../core/commands';
import { opId } from '../core/ids';
import { toast } from '../core/toast';
import type { Action, Command, Result, ShapeId } from '../core/types';
import { activeBoard, selectIds, selectedIds } from '../ui/board/state';

const liveShapes = (b: BoardKit) => b.doc.getState().shapes;
const isLive = (b: BoardKit, id: ShapeId) => { const s = liveShapes(b).get(id); return !!s && !s.deleted; };
const failText = (rs: Result[], fallback: string) => {
  const bad = rs.find((r) => !r.ok);
  return bad && !bad.ok ? (bad.error === 'locked' ? 'Layer is locked' : bad.message) : fallback;
};
const warn = (msg: string, key: string) => toast(msg, { variant: 'warn', key, onceMs: 1500 });

/** Selected ids that still exist (the selection can hold ids another actor deleted). */
function liveSelection(b: BoardKit): ShapeId[] {
  return selectedIds(b).filter((id) => isLive(b, id));
}

/** Selected ids whose ancestors are not also selected. */
function topLevel(b: BoardKit, ids: readonly ShapeId[]): ShapeId[] {
  const shapes = liveShapes(b);
  const set = new Set(ids);
  return ids.filter((id) => {
    for (let p = shapes.get(id)?.parent; p; p = shapes.get(p)?.parent) if (set.has(p)) return false;
    return true;
  });
}

// ---- nudge ----
export function nudge(b: BoardKit, dx: number, dy: number): boolean {
  const ids = topLevel(b, liveSelection(b));
  if (!ids.length || (!dx && !dy)) return false;
  // Same key for the same selection: undo.ts merges a burst (within its coalesce window) into one entry.
  const g = b.gesture(b.me, 'Nudge', { coalesceKey: `nudge:${[...ids].sort().join(',')}` });
  g.update([{ t: 'shape.translate', ids, dx, dy }]);
  const r = g.commit();
  if (!r.ok) { warn(failText(r.results, 'Could not move'), 'arrange.nudge'); return false; }
  return true;
}

// ---- z-order ----
export function reorder(b: BoardKit, to: 'front' | 'back' | 'forward' | 'backward'): boolean {
  const ids = liveSelection(b);
  if (!ids.length) return false;
  const r = b.exec({ actor: b.me, opId: opId(b.me), commands: [{ t: 'shape.reorder', ids, to }] });
  if (!r.ok) { warn(failText(r.results, 'Could not reorder'), 'arrange.reorder'); return false; }
  return true; // already at the end: the batch has no ops, so no history entry
}

// ---- group / frame ----
const isContainer = (k: string) => k === 'group' || k === 'frame';

/** Next free "Group N" / "Frame N". */
function nextName(b: BoardKit, label: 'Group' | 'Frame'): string {
  let n = 0;
  for (const s of liveShapes(b).values()) {
    if (s.deleted) continue;
    const m = new RegExp(`^${label} (\\d+)$`).exec(s.name ?? '');
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${label} ${n + 1}`;
}

/** Paint-order index of every live shape (depth first, bottom to top), to find the topmost selected item. */
function paintOrder(b: BoardKit): Map<ShapeId, number> {
  const st = b.doc.getState();
  const out = new Map<ShapeId, number>();
  const walk = (parent: ShapeId | null) => {
    for (const id of st.children.get(parent) ?? []) { out.set(id, out.size); walk(id); }
  };
  walk(null);
  return out;
}

export function groupSelection(b: BoardKit, as: 'group' | 'frame' = 'group'): boolean {
  const tops = topLevel(b, liveSelection(b));
  if (!tops.length) { warn('Nothing selected', 'arrange.empty'); return false; }
  const shapes = liveShapes(b);
  const order = paintOrder(b);
  const topmost = tops.reduce((a, c) => ((order.get(c) ?? 0) > (order.get(a) ?? 0) ? c : a));
  const parent = shapes.get(topmost)?.parent ?? null; // mixed parents: the group goes under the topmost item's parent
  const commands: Command[] = [];
  const outside = tops.filter((id) => (shapes.get(id)?.parent ?? null) !== parent);
  if (outside.length) commands.push({ t: 'shape.reparent', ids: outside, parent, keepWorld: true });
  const gi = commands.length;
  commands.push({ t: 'shape.group', ids: tops, as, name: nextName(b, as === 'frame' ? 'Frame' : 'Group') });
  if (as === 'frame') commands.push({ t: 'shape.update', ids: [`$${gi}`], patch: { fills: [{ type: 'solid', color: '#ffffff' }], clip: true } });
  const r = b.exec({ actor: b.me, opId: opId(b.me), commands, atomic: true, label: as === 'frame' ? 'Frame selection' : 'Group' });
  if (!r.ok) { warn(failText(r.results, 'Could not group'), 'arrange.group'); return false; }
  const made = r.results[gi];
  if (made?.ok && made.id) selectIds(b, [made.id]);
  return true;
}

export function ungroupSelection(b: BoardKit): boolean {
  const shapes = liveShapes(b);
  const sel = liveSelection(b);
  const containers = sel.filter((id) => isContainer(shapes.get(id)!.kind));
  if (!containers.length) { warn('Select a group or frame to ungroup', 'arrange.ungroup'); return false; }
  const kids = containers.flatMap((id) => b.doc.getState().children.get(id) ?? []);
  const r = b.exec({ actor: b.me, opId: opId(b.me), commands: [{ t: 'shape.ungroup', ids: containers }], atomic: true });
  if (!r.ok) { warn(failText(r.results, 'Could not ungroup'), 'arrange.ungroup'); return false; }
  const keep = sel.filter((id) => !containers.includes(id));
  selectIds(b, [...keep, ...kids]);
  return true;
}

// ---- actions ----
const withBoard = (f: (b: BoardKit) => void) => () => {
  const env = activeBoard();
  if (env && !env.ui.get().editing) f(env.board);
};
const hasSelection = (): true | string => {
  const env = activeBoard();
  return env && selectedIds(env.board).length ? true : '';
};
const canvas: Action['contexts'] = ['canvas', 'panel'];
const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

export const actions: Action[] = [
  {
    id: 'arrange.nudge', title: 'Nudge selection', group: 'Arrange', contexts: canvas,
    keys: { all: [...arrows, ...arrows.map((k) => `Shift+${k}`)] },
    when: hasSelection,
    run(args) {
      const a = args as { dx?: number; dy?: number } | undefined;
      const env = activeBoard();
      if (!env || env.ui.get().editing || !a) return;
      nudge(env.board, a.dx ?? 0, a.dy ?? 0);
    },
  },
  { id: 'arrange.forward', title: 'Bring forward', group: 'Arrange', keys: { all: ['Mod+BracketRight'] }, contexts: canvas, run: withBoard((b) => reorder(b, 'forward')) },
  { id: 'arrange.backward', title: 'Send backward', group: 'Arrange', keys: { all: ['Mod+BracketLeft'] }, contexts: canvas, run: withBoard((b) => reorder(b, 'backward')) },
  { id: 'arrange.front', title: 'Bring to front', group: 'Arrange', keys: { all: ['Mod+Shift+BracketRight', 'Mod+Alt+BracketRight'] }, contexts: canvas, run: withBoard((b) => reorder(b, 'front')) },
  { id: 'arrange.back', title: 'Send to back', group: 'Arrange', keys: { all: ['Mod+Shift+BracketLeft', 'Mod+Alt+BracketLeft'] }, contexts: canvas, run: withBoard((b) => reorder(b, 'back')) },
  { id: 'arrange.group', title: 'Group selection', group: 'Arrange', keys: { all: ['Mod+g'] }, contexts: canvas, run: withBoard((b) => groupSelection(b, 'group')) },
  { id: 'arrange.ungroup', title: 'Ungroup', group: 'Arrange', keys: { all: ['Mod+Shift+g'] }, contexts: canvas, run: withBoard(ungroupSelection) },
  { id: 'arrange.frameSelection', title: 'Frame selection', group: 'Arrange', keys: { all: ['Mod+Alt+g'] }, contexts: canvas, run: withBoard((b) => groupSelection(b, 'frame')) },
];
