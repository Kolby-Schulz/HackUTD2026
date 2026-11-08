// Layer-panel drag and drop (LAYERS-10/11): reorder within a parent, reparent onto a frame/group row.
// `planDrop` is pure and tested; the controller below wires pointer events, a ghost row, auto-scroll, Esc and the
// one board.exec that makes the drop a single undo entry. Rows list top layer first, the store keeps bottom first.
import { useSyncExternalStore } from 'react';
import { opId } from '../../core/ids';
import { toast } from '../../core/toast';
import type { Shape, ShapeId } from '../../core/types';
import { activeBoard } from '../board/state';

export const DRAG_THRESHOLD = 4;
export const AUTOSCROLL_EDGE = 32;
export const AUTOSCROLL_MAX = 16;
export const EXPAND_DELAY_MS = 600;

type Shapes = ReadonlyMap<ShapeId, Shape>;
type Children = ReadonlyMap<ShapeId | null, readonly ShapeId[]>;
export type At = 'top' | 'bottom' | { after: ShapeId };
export type DropMode = 'before' | 'after' | 'into' | 'root';

export interface DropTarget {
  /** The row under the pointer, or null for empty panel space (drop at page root top). */
  id: ShapeId | null;
  /** Pointer position inside that row, 0 (top edge) to 1 (bottom edge). */
  frac: number;
  /** The row is an expanded parent (its children are listed right below it). */
  expanded?: boolean;
}
export interface DropPlan {
  mode: DropMode;
  parent: ShapeId | null;
  at: At;
  /** Row that shows the indicator (null for 'root'). */
  row: ShapeId | null;
  /** Indent depth of the insertion line. */
  depth: number;
  /** Dropping would leave the order unchanged. */
  noop: boolean;
}

const isContainer = (s: Shape) => s.kind === 'frame' || s.kind === 'group';
const parentOf = (s: Shape | undefined) => s?.parent ?? null;

export function depthOf(shapes: Shapes, id: ShapeId): number {
  let d = 0;
  for (let p = parentOf(shapes.get(id)); p && d < 1000; p = parentOf(shapes.get(p))) d++;
  return d;
}

/** The ids that actually move: no id whose ancestor is also in the set; live shapes only. */
export function dragRoots(shapes: Shapes, ids: readonly ShapeId[]): ShapeId[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    if (!shapes.get(id) || shapes.get(id)!.deleted) return false;
    for (let p = parentOf(shapes.get(id)); p; p = parentOf(shapes.get(p))) if (set.has(p)) return false;
    return true;
  });
}

/** `id` is one of `moved` or lives inside one. */
export function insideMoved(shapes: Shapes, moved: ReadonlySet<ShapeId>, id: ShapeId | null): boolean {
  for (let p: ShapeId | null = id; p; p = parentOf(shapes.get(p))) if (moved.has(p)) return true;
  return false;
}

/** Where a drop at `target` would land, or null when it is refused (own descendant, locked parent, no row). */
export function planDrop(shapes: Shapes, children: Children, movedIds: readonly ShapeId[], target: DropTarget): DropPlan | null {
  const moved = dragRoots(shapes, movedIds);
  if (!moved.length) return null;
  const set = new Set(moved);
  const finish = (p: Omit<DropPlan, 'noop'>): DropPlan | null => {
    if (p.parent && (shapes.get(p.parent)?.locked || !shapes.get(p.parent))) return null;
    return { ...p, noop: isNoop(children, shapes, set, p.parent, p.at) };
  };
  if (target.id === null) return finish({ mode: 'root', parent: null, at: 'top', row: null, depth: 0 });
  const x = shapes.get(target.id);
  if (!x || insideMoved(shapes, set, x.id)) return null;
  const container = isContainer(x);
  const zone = container ? (target.frac < 1 / 3 ? 'above' : target.frac > 2 / 3 ? 'below' : 'into') : target.frac < 0.5 ? 'above' : 'below';
  const depth = depthOf(shapes, x.id);
  if (zone === 'into' || (zone === 'below' && container && target.expanded && (children.get(x.id)?.length ?? 0) > 0)) {
    const line = zone === 'below';
    return finish({ mode: line ? 'after' : 'into', parent: x.id, at: 'top', row: x.id, depth: line ? depth + 1 : depth });
  }
  const parent = parentOf(x);
  if (zone === 'above') return finish({ mode: 'before', parent, at: { after: x.id }, row: x.id, depth });
  const sibs = children.get(parent) ?? [];
  let prev: ShapeId | undefined;
  for (let i = sibs.indexOf(x.id) - 1; i >= 0 && prev === undefined; i--) if (!set.has(sibs[i])) prev = sibs[i];
  return finish({ mode: 'after', parent, at: prev ? { after: prev } : 'bottom', row: x.id, depth });
}

/** Would placing `moved` at (parent, at) reproduce today's sibling order? */
function isNoop(children: Children, shapes: Shapes, moved: ReadonlySet<ShapeId>, parent: ShapeId | null, at: At): boolean {
  for (const id of moved) if (parentOf(shapes.get(id)) !== parent) return false;
  const sibs = children.get(parent) ?? [];
  const rest = sibs.filter((id) => !moved.has(id));
  const mine = sibs.filter((id) => moved.has(id));
  const i = at === 'top' ? rest.length : at === 'bottom' ? 0 : rest.indexOf(at.after) + 1;
  const next = [...rest.slice(0, i), ...mine, ...rest.slice(i)];
  return next.length === sibs.length && next.every((id, n) => id === sibs[n]);
}

// ---- drag state (shared with the rows, which read only their own slice) ----

interface DragState { moved: ReadonlySet<ShapeId>; plan: DropPlan | null; refused: boolean }
let state: DragState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** What row `id` shows: 'drag' (being dragged), 'before:2' / 'after:2' (line at depth 2), 'into', or ''. */
export function rowDropState(id: ShapeId): string {
  if (!state) return '';
  if (state.moved.has(id)) return 'drag';
  const p = state.plan;
  if (p && p.row === id) return p.mode === 'into' ? 'into' : `${p.mode}:${p.depth}`;
  return '';
}
export function useRowDropState(id: ShapeId): string {
  return useSyncExternalStore(subscribe, () => rowDropState(id), () => '');
}

// ---- controller ----

export interface RowDragOptions {
  /** Rows to move when the dragged row is part of the selection. */
  selection: readonly ShapeId[];
  /** Expand a collapsed parent (called once per hover, only when it is collapsed). */
  onExpand: (id: ShapeId) => void;
}

let active: (() => void) | null = null;

/** Call from a row's pointerdown. Starts tracking; a drag begins after DRAG_THRESHOLD px. */
export function beginRowDrag(ev: { clientX: number; clientY: number; button: number; target: EventTarget | null; currentTarget: EventTarget | null }, id: ShapeId, opts: RowDragOptions): void {
  if (ev.button !== 0 || active) return;
  const env = activeBoard();
  const rowEl = ev.currentTarget as HTMLElement | null;
  const list = rowEl?.closest('[data-virtual-list]') as HTMLElement | null;
  if (!env || !list) return;
  const board = env.board;
  const x0 = ev.clientX, y0 = ev.clientY;
  let px = x0, py = y0;
  let dragging = false;
  let ghost: HTMLDivElement | null = null;
  let raf = 0;
  let expandTimer = 0, expandFor: ShapeId | null = null;
  let movedIds: ShapeId[] = [];

  const finish = (commit: boolean) => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onCancel);
    cancelAnimationFrame(raf);
    clearTimeout(expandTimer);
    active = null;
    if (!dragging) return;
    const plan = state?.plan;
    ghost?.remove();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    list.style.boxShadow = '';
    state = null;
    emit();
    // The click that follows pointerup must not select or toggle anything.
    const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    if (commit && plan && !plan.noop) commitDrop(plan, movedIds);
  };

  const commitDrop = (plan: DropPlan, ids: ShapeId[]) => {
    // Re-resolve at commit time: skip ids that vanished meanwhile (an agent may have deleted them).
    const shapes = board.doc.getState().shapes;
    const live = dragRoots(shapes, ids);
    if (!live.length) return;
    const parent = plan.parent;
    if (parent && (!shapes.get(parent) || shapes.get(parent)!.locked)) { toast('Layer is locked', { variant: 'warn', key: 'layers.dnd', onceMs: 1500 }); return; }
    let at = plan.at;
    if (typeof at === 'object' && !shapes.get(at.after)) at = 'top';
    const r = board.exec({ actor: board.me, opId: opId(board.me), commands: [{ t: 'shape.reparent', ids: live, parent, at, keepWorld: true }] });
    if (!r.ok) {
      const bad = r.results.find((x) => !x.ok);
      toast(bad && !bad.ok ? (bad.error === 'locked' ? 'Layer is locked' : bad.message) : 'Could not move layer', { variant: 'warn', key: 'layers.dnd', onceMs: 1500 });
      return;
    }
    const p = parent ? shapes.get(parent) : undefined;
    if (p && p.kind === 'frame' && p.clip !== false) {
      toast('Frames clip their content: layers outside the frame are hidden.', { key: 'layers.dnd.clip', onceMs: 600000 });
    }
  };

  const hit = (): DropPlan | null => {
    const r = list.getBoundingClientRect();
    if (px < r.left || px > r.right || py < r.top || py > r.bottom) return null;
    const el = document.elementFromPoint(px, py)?.closest('[data-layer]') as HTMLElement | null;
    const st = board.doc.getState();
    if (!el || !list.contains(el)) return planDrop(st.shapes, st.children, movedIds, { id: null, frac: 0 });
    const rr = el.getBoundingClientRect();
    return planDrop(st.shapes, st.children, movedIds, {
      id: el.dataset.layer as ShapeId, frac: Math.min(1, Math.max(0, (py - rr.top) / rr.height)), expanded: el.dataset.expanded === 'true',
    });
  };

  const update = () => {
    if (!state) return;
    const plan = hit();
    const el = plan?.row ? list.querySelector(`[data-layer="${CSS.escape(plan.row)}"]`) as HTMLElement | null : null;
    state = { ...state, plan, refused: !plan };
    list.style.boxShadow = plan?.mode === 'root' ? 'inset 0 0 0 1.5px var(--pg-sel)' : '';
    document.body.style.cursor = plan ? '' : 'not-allowed';
    emit();
    // Auto-expand a collapsed parent after hovering its middle for a moment.
    const want = plan?.mode === 'into' && el?.dataset.expanded === 'false' && el.dataset.haschildren === 'true' ? plan.row : null;
    if (want !== expandFor) {
      clearTimeout(expandTimer);
      expandFor = want;
      if (want) expandTimer = window.setTimeout(() => { opts.onExpand(want); expandFor = null; }, EXPAND_DELAY_MS);
    }
  };

  const tick = () => {
    const r = list.getBoundingClientRect();
    let dy = 0;
    if (py < r.top + AUTOSCROLL_EDGE) dy = -AUTOSCROLL_MAX * Math.min(1, (r.top + AUTOSCROLL_EDGE - py) / AUTOSCROLL_EDGE);
    else if (py > r.bottom - AUTOSCROLL_EDGE) dy = AUTOSCROLL_MAX * Math.min(1, (py - (r.bottom - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE);
    if (dy && px >= r.left && px <= r.right) { list.scrollTop += dy; update(); }
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    const st = board.doc.getState();
    const base = opts.selection.includes(id) ? opts.selection : [id];
    movedIds = dragRoots(st.shapes, base);
    if (!movedIds.includes(id) && !insideMoved(st.shapes, new Set(movedIds), id)) movedIds = [id];
    if (!movedIds.length) { finish(false); return; }
    // Keep the current visual order (store order, paint order of siblings is preserved by the command).
    dragging = true;
    state = { moved: new Set(movedIds), plan: null, refused: false };
    ghost = document.createElement('div');
    const first = st.shapes.get(movedIds[0]);
    ghost.textContent = (first?.name ?? '') + (movedIds.length > 1 ? `  +${movedIds.length - 1}` : '');
    Object.assign(ghost.style, {
      position: 'fixed', zIndex: '9999', pointerEvents: 'none', opacity: '0.6', padding: '4px 10px', borderRadius: '6px',
      font: '12px system-ui, sans-serif', background: 'var(--pg-panel)', color: 'var(--pg-ink)', border: '1px solid var(--pg-sel)',
      boxShadow: 'var(--pg-shadow-pop)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });
    document.body.appendChild(ghost);
    document.body.style.userSelect = 'none';
    raf = requestAnimationFrame(tick);
    place();
    update();
  };
  const place = () => { if (ghost) { ghost.style.left = `${px + 12}px`; ghost.style.top = `${py + 8}px`; } };

  const onMove = (e: PointerEvent) => {
    px = e.clientX; py = e.clientY;
    if (!dragging) {
      if (Math.hypot(px - x0, py - y0) < DRAG_THRESHOLD) return;
      start();
      return;
    }
    place();
    update();
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); e.preventDefault();
    finish(false);
  };

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onCancel);
  active = () => finish(false);
}
