// Click selection (SELECT-2..6). A plain click picks the hit's top-level target (groups are climbed,
// frame children are selectable); once "inside" a container (scope) it picks that container's direct
// child; Cmd/Ctrl picks the deepest shape; Shift toggles; double-click enters a container or edits text.
// Ids are written with the selection.set command; scope is presence-only and set on the store.
import { hitTest, topLevelTarget } from '../../core/hittest';
import { ancestors } from '../../core/tree';
import type { Pt, ShapeId } from '../../core/types';
import { selectIds, selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { PointerInfo } from './pipeline';
import { startEditing } from './text';

type View = ReturnType<BoardEnv['board']['doc']['getState']>;

/** Deepest unlocked, visible shape under the point (ellipse/radius aware, locked skipped). */
function leafAt(env: BoardEnv, world: Pt): ShapeId | null {
  return hitTest(env.board.doc.getState(), env.board.index, world, { z: env.camera.getCam().z, deep: true });
}

const isContainer = (view: View, id: ShapeId) => {
  const k = view.shapes.get(id)?.kind;
  return k === 'group' || k === 'frame';
};

/** Nearest ancestor-or-self of `leaf` that is also an ancestor-or-self of `scope`; null = root. */
function commonScope(view: View, leaf: ShapeId, scope: ShapeId): ShapeId | null {
  const mine = new Set([scope, ...ancestors(view, scope)]);
  for (const a of ancestors(view, leaf)) if (mine.has(a)) return a; // ancestors() excludes leaf itself
  return null;
}

/** The ancestor-or-self of `leaf` whose parent is `scope` (the scope's direct child on the way down). */
function childOf(view: View, leaf: ShapeId, scope: ShapeId): ShapeId {
  let cur = leaf;
  for (;;) {
    const p = view.shapes.get(cur)?.parent ?? null;
    if (p === scope || p === null) return cur;
    cur = p;
  }
}

/** What a plain click on `leaf` selects given the current scope; also the scope to be in afterwards. */
export function clickTarget(view: View, leaf: ShapeId, scope: ShapeId | null): { id: ShapeId; scope: ShapeId | null } {
  if (scope && view.shapes.has(scope)) {
    const next = commonScope(view, leaf, scope);
    if (next === scope) return { id: childOf(view, leaf, scope), scope };
    return clickTarget(view, leaf, next);
  }
  return { id: topLevelTarget(view, leaf), scope: null };
}

function setSel(env: BoardEnv, ids: ShapeId[], scope: ShapeId | null) {
  selectIds(env.board, ids);
  env.board.selection.set(env.board.me, ids, scope);
}

/** Updates the human's selection for a click at `p`; returns the hit shape (null on empty canvas). */
export function selectAt(env: BoardEnv, p: PointerInfo): ShapeId | null {
  const view = env.board.doc.getState();
  const leaf = leafAt(env, p.world);
  const cur = selectedIds(env.board);
  const scope = env.board.selection.get(env.board.me).scope;
  if (!leaf) { if (!p.shift && cur.length) setSel(env, [], scope); return null; }
  const t = p.mod ? { id: leaf, scope: view.shapes.get(leaf)?.parent ?? null } : clickTarget(view, leaf, scope);
  if (p.shift) setSel(env, cur.includes(t.id) ? cur.filter((id) => id !== t.id) : [...cur, t.id], t.scope);
  else if (!cur.includes(t.id) || t.scope !== scope) setSel(env, cur.includes(t.id) ? [...cur] : [t.id], t.scope);
  return t.id;
}

/** Double-click (use the 300ms / 4px detector or the native event): enter a container or edit text. True when handled. */
export function enterAt(env: BoardEnv, p: PointerInfo): boolean {
  const view = env.board.doc.getState();
  const leaf = leafAt(env, p.world);
  if (!leaf) return false;
  const s = view.shapes.get(leaf);
  if (s?.kind === 'text') { startEditing(env, leaf); return true; }
  const sel = env.board.selection.get(env.board.me);
  // the container the first click selected, else the one a click here would select
  const box = sel.ids.find((id) => isContainer(view, id) && ancestors(view, leaf).includes(id))
    ?? (() => { const t = clickTarget(view, leaf, sel.scope).id; return isContainer(view, t) && t !== leaf ? t : null; })();
  if (!box) return false;
  setSel(env, [childOf(view, leaf, box)], box);
  return true;
}
