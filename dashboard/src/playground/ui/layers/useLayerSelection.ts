// Layer-panel selection logic: click / Cmd-toggle / Shift-range over visible rows, keyboard moves, and reveal.
// The pure functions are tested; the hook wires them to the board. Only the human's selection (`board.me`) is
// ever read here, so agent selections never expand, scroll or highlight the panel (LAYERS-30).
import { useCallback, useEffect, useRef } from 'react';
import type { BoardKit } from '../../core/commands';
import type { Shape, ShapeId } from '../../core/types';
import { selectIds } from '../board/state';
import type { ExpandedMap, LayerRowData } from './treeView';
import type { VirtualListHandle } from './VirtualList';

export interface ClickMods { shift: boolean; toggle: boolean }
export interface PickResult { ids: ShapeId[]; anchor: ShapeId | null }

/** Ancestors of `id`, nearest first. */
export function ancestorsOf(shapes: ReadonlyMap<ShapeId, Shape>, id: ShapeId): ShapeId[] {
  const out: ShapeId[] = [];
  let p = shapes.get(id)?.parent ?? null;
  for (let n = 0; p && n < 1000; n++) { out.push(p); p = shapes.get(p)?.parent ?? null; }
  return out;
}

/** `overrides` with every ancestor of `ids` set open; returns the same map when nothing changes. */
export function withAncestorsOpen(
  overrides: ExpandedMap, shapes: ReadonlyMap<ShapeId, Shape>, ids: readonly ShapeId[], isOpen: (s: Shape) => boolean,
): ExpandedMap {
  let next: Map<ShapeId, boolean> | null = null;
  for (const id of ids) {
    for (const a of ancestorsOf(shapes, id)) {
      const s = shapes.get(a);
      if (!s || (next ?? overrides).get(a) === true || (!(next ?? overrides).has(a) && isOpen(s))) continue;
      next ??= new Map(overrides);
      next.set(a, true);
    }
  }
  return next ?? overrides;
}

/** What a row click does. Range runs over the visible rows only, so a collapsed parent is selected without its hidden children. */
export function pick(rows: readonly LayerRowData[], current: readonly ShapeId[], anchor: ShapeId | null, id: ShapeId, mods: ClickMods): PickResult {
  if (mods.shift) {
    const a = rows.findIndex((r) => r.id === (anchor ?? current[current.length - 1]));
    const b = rows.findIndex((r) => r.id === id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const ids = rows.slice(lo, hi + 1).map((r) => r.id);
      if (a > b) ids.reverse();       // clicked row last = primary
      return { ids, anchor: rows[a].id };
    }
  }
  if (mods.toggle) {
    const ids = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    return { ids, anchor: id };
  }
  return { ids: [id], anchor: id };
}

/** Keyboard move: the row `dir` steps from the primary selected row (or first/last when nothing is visible-selected). */
export function stepRow(rows: readonly LayerRowData[], current: readonly ShapeId[], dir: 1 | -1): ShapeId | null {
  if (!rows.length) return null;
  const at = rows.findIndex((r) => r.id === current[current.length - 1]);
  if (at < 0) return rows[dir === 1 ? 0 : rows.length - 1].id;
  return rows[Math.min(rows.length - 1, Math.max(0, at + dir))].id;
}

/** Row index of the topmost selected row (multi-select scrolls to the topmost), or -1. */
export function topmostIndex(rows: readonly LayerRowData[], selected: readonly ShapeId[]): number {
  const set = new Set(selected);
  return rows.findIndex((r) => set.has(r.id));
}

interface Args {
  board: BoardKit;
  rows: readonly LayerRowData[];
  selected: readonly ShapeId[];
  shapes: ReadonlyMap<ShapeId, Shape>;
  listRef: React.RefObject<VirtualListHandle | null>;
  /** Open the ancestors of these ids in the panel's expand state. */
  expand: (ids: readonly ShapeId[]) => void;
}

export function useLayerSelection({ board, rows, selected, shapes, listRef, expand }: Args) {
  const anchor = useRef<ShapeId | null>(null);
  const mods = useRef<ClickMods>({ shift: false, toggle: false });
  const live = useRef({ rows, selected });
  live.current = { rows, selected };
  const pending = useRef(false);

  // Canvas (or any) selection change of the human: open ancestors, then scroll once the rows exist.
  useEffect(() => {
    if (!selected.length) return;
    anchor.current = selected[selected.length - 1];
    expand(selected);
    pending.current = true;
  }, [selected, expand]);
  useEffect(() => {
    if (!pending.current) return;
    const at = topmostIndex(rows, selected);
    if (at < 0) return;             // ancestors still opening: the next rows change retries
    pending.current = false;
    listRef.current?.scrollToIndex(at, 'auto');
  }, [rows, selected, listRef]);

  /** Record modifiers on the capture phase; LayerRow's click handler only passes the id. */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    mods.current = { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey };
  }, []);
  const onPick = useCallback((id: ShapeId) => {
    const r = pick(live.current.rows, live.current.selected, anchor.current, id, mods.current);
    mods.current = { shift: false, toggle: false };
    anchor.current = r.anchor;
    pending.current = false;        // a click inside the panel needs no scroll
    selectIds(board, r.ids);
  }, [board]);
  /** Click on empty panel space clears. */
  const onBackgroundClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-layer]')) return;
    selectIds(board, []);
  }, [board]);
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const { rows: rs, selected: sel } = live.current;
    const id = stepRow(rs, sel, e.key === 'ArrowDown' ? 1 : -1);
    if (!id) return;
    const r = pick(rs, sel, anchor.current ?? sel[sel.length - 1] ?? null, id, { shift: e.shiftKey, toggle: false });
    anchor.current = r.anchor;
    selectIds(board, r.ids);
    listRef.current?.scrollToIndex(rs.findIndex((x) => x.id === id), 'auto');
  }, [board, listRef]);

  // `shapes` is accepted for symmetry with expand's closure; selection pruning is handled by the store.
  void shapes;
  return { onPick, onClickCapture, onBackgroundClick, onKeyDown };
}
