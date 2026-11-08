// Viewport culling (CANVAS-18). Purely a render concern: the document, the spatial index, Cmd+A, the layers
// panel and export never see it. Only which ShapeViews are MOUNTED changes.
//
// How it works
//  - One Culler per mounted board (WeakMap on the BoardEnv). It owns `mounted`, the set of ids to render:
//    every shape whose world box overlaps the padded view rect `Q` (spatial index `queryRect`), plus the shapes
//    that must stay mounted (selected by anyone, being edited, locked by someone), plus all their ancestors
//    (nested rendering: a child can only mount inside a mounted parent). Culling is therefore per tree level:
//    each parent filters its own child list through `has`.
//  - `tick` runs in the board's paint frame (env.paint), so at most once per frame and with no React render
//    per camera frame. It does O(1) work unless the camera left `Q`, the zoom changed a lot, the keep-set
//    changed, or a changed shape touches `Q`. Only then does it re-query, diff, and bump the per-parent stamp of
//    the parents whose visible child list changed. Those parents (and only those) re-render.
//  - `Q` is the view padded by MARGIN_PX (256 screen px) so a pan of up to ~192 px needs no recompute at all;
//    the spec minimum (64 px) is the "need" rect that must stay inside Q.
//  - Before the board is measured (view size 0) everything is visible.
//
// Wiring (needs edits in ShapeView.tsx and Board.tsx, see the WP-32 report): replace
//   `kids.filter(isVisible)` with `useVisible(id, kids)` (call it BEFORE the early return in ShapeView) and
//   `ids.filter(isVisible)` in RootShapes with `useVisible(null, ids)`.
// Until those edits land `isVisible` stays `true`, so nothing is ever wrongly hidden.
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CameraStore } from '../../core/camera';
import type { BoardKit } from '../../core/commands';
import { overlaps } from '../../core/spatial';
import { worldBounds } from '../../core/tree';
import type { Rect, ShapeId } from '../../core/types';
import { useBoardEnv } from './context';
import { activeBoard } from './state';
import type { BoardEnv, UiStore } from './state';

/** Screen px of padding around the view that is mounted (hysteresis for panning). */
export const MARGIN_PX = 256;
/** Screen px that must always be covered; when the view gets closer to the edge of Q than this, re-query. */
export const NEED_PX = 64;
/** Selected shapes beyond this many per actor are only mounted when they are on screen (Cmd+A on 5k shapes). */
export const MAX_KEPT_SELECTED = 300;

const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export interface CullStats { mounted: number; total: number; recomputes: number; lastQueryMs: number }

export interface Culler {
  /** Should this shape be mounted? (children of an unmounted parent are never asked.) */
  has(id: ShapeId): boolean;
  /** Changes whenever the visible child list of `parent` (null = root) changed. */
  stamp(parent: ShapeId | null): number;
  subscribe(parent: ShapeId | null, cb: () => void): () => void;
  /** Run in the paint frame. */
  tick(): void;
  stats(): CullStats;
  /** True once a component subscribed through `useVisible`; `isVisible` only culls then. */
  readonly reactive: boolean;
  dispose(): void;
}

type CullEnv = Pick<BoardEnv, 'camera' | 'ui' | 'paint'> & { board: BoardKit };
export interface CullOpts { marginPx?: number; needPx?: number; isStale?: () => boolean }

export function createCuller(env: CullEnv, opts: CullOpts = {}): Culler {
  const { board, camera, ui, paint } = env;
  const marginPx = opts.marginPx ?? MARGIN_PX;
  const needPx = opts.needPx ?? NEED_PX;

  let mounted: Set<ShapeId> | null = null;        // null = view not measured yet: everything visible
  let Q: Rect | null = null;
  let qScale = 0;                                 // 1 / zoom when Q was computed
  let keep: ShapeId[] = [];
  let dirty = true;
  let reactive = false;
  let recomputes = 0, lastQueryMs = 0;
  const stamps = new Map<ShapeId | null, number>();
  const listeners = new Map<ShapeId | null, Set<() => void>>();

  const bump = (parent: ShapeId | null) => {
    stamps.set(parent, (stamps.get(parent) ?? 0) + 1);
    listeners.get(parent)?.forEach((l) => l());
  };

  /** Ids that stay mounted wherever the camera is: selection of every actor, the text being edited, locked shapes. */
  function keepIds(): ShapeId[] {
    const out = new Set<ShapeId>();
    for (const a of board.actors.list()) {
      const ids = board.selection.get(a.id).ids;
      for (let i = 0; i < ids.length && i < MAX_KEPT_SELECTED; i++) out.add(ids[i]);
    }
    const editing = ui.get().editing;
    if (editing) out.add(editing);
    for (const l of board.locks.list()) out.add(l.shapeId);
    return [...out];
  }
  const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

  function recompute(q: Rect) {
    const t0 = performance.now();
    const view = board.doc.getState();
    const next = new Set<ShapeId>();
    const addWithAncestors = (id: ShapeId) => {
      for (let cur: ShapeId | null = id; cur !== null && !next.has(cur); cur = view.shapes.get(cur)?.parent ?? null) {
        if (!view.shapes.has(cur)) break;
        next.add(cur);
      }
    };
    for (const id of board.index.queryRect(q)) addWithAncestors(id);
    for (const id of keep) if (view.shapes.has(id) && !view.shapes.get(id)!.deleted) addWithAncestors(id);

    const prev = mounted;
    mounted = next;
    lastQueryMs = performance.now() - t0;
    recomputes++;
    if (!prev) { for (const p of [...listeners.keys()]) bump(p); return; }
    const touched = new Set<ShapeId | null>();
    const parentOf = (id: ShapeId) => view.shapes.get(id)?.parent ?? null;
    for (const id of next) if (!prev.has(id)) touched.add(parentOf(id));
    for (const id of prev) if (!next.has(id)) touched.add(parentOf(id));
    touched.forEach(bump);
  }

  function tick() {
    const size = camera.getViewSize();
    if (size.w <= 0 || size.h <= 0) return;
    const cam = camera.getCam();
    const vr = camera.visibleRect();
    const k = keepIds();
    if (!sameList(k, keep)) { keep = k; dirty = true; }
    const scale = 1 / cam.z;
    if (!dirty && Q && contains(Q, grow(vr, needPx * scale)) && qScale <= scale * 2.5 && scale <= qScale * 2.5) return;
    dirty = false;
    Q = grow(vr, marginPx * scale);
    qScale = scale;
    recompute(Q);
  }

  /** A document change matters when a mounted shape changed (moved out, deleted, restyled children) or a changed shape reaches Q. */
  const offDoc = board.doc.onChange((ids) => {
    if (opts.isStale?.()) { dispose(); return; }
    if (dirty || !mounted || !Q) return;
    for (const id of ids) {
      const b = board.index.bounds(id);
      if (mounted.has(id) || !b || overlaps(b, Q)) { dirty = true; break; }
    }
    if (dirty) paint.wake();
  });
  const offSel = board.selection.subscribe(() => paint.wake());
  const offUi = ui.subscribe(() => paint.wake());
  const offPaint = paint.add(() => {
    if (opts.isStale?.()) { dispose(); return; }
    tick();
  });

  function dispose() { offDoc(); offSel(); offUi(); offPaint(); listeners.clear(); }

  return {
    has(id) {
      if (!mounted || !Q) return true;
      if (mounted.has(id)) return true;
      // not mounted yet but new or just moved into Q: show it now instead of one frame late
      // (the index is updated after React's listeners run, so fall back to the document for brand new ids)
      const b = board.index.bounds(id) ?? worldBounds(board.doc.getState(), id);
      return !!b && overlaps(b, Q);
    },
    stamp: (p) => stamps.get(p) ?? 0,
    subscribe(p, cb) {
      reactive = true;
      let set = listeners.get(p);
      if (!set) listeners.set(p, (set = new Set()));
      set.add(cb);
      return () => { set!.delete(cb); };
    },
    tick,
    stats: () => ({ mounted: mounted?.size ?? board.index.size, total: board.index.size, recomputes, lastQueryMs }),
    get reactive() { return reactive; },
    dispose,
  };
}

// ---- per-board instance and React binding ----
const cullers = new WeakMap<object, Culler>();

/** The culler of a mounted board (created on first use). */
export function cullerFor(env: BoardEnv): Culler {
  let c = cullers.get(env);
  if (!c) {
    c = createCuller(env, { isStale: () => activeBoard() !== null && activeBoard() !== env });
    cullers.set(env, c);
  }
  return c;
}

/** Mounted / total shape counts of the active board, for the debug HUD (CANVAS-44) and the benchmark. */
export function cullStats(): CullStats | null {
  const env = activeBoard();
  return env ? cullerFor(env).stats() : null;
}

/** Filter a parent's child list to the ones that should be mounted. Re-renders only when that list changes. */
export function useVisible(parent: ShapeId | null, kids: readonly ShapeId[]): readonly ShapeId[] {
  const env = useBoardEnv();
  const culler = cullerFor(env);
  const sub = useCallback((l: () => void) => culler.subscribe(parent, l), [culler, parent]);
  const get = useCallback(() => culler.stamp(parent), [culler, parent]);
  const stamp = useSyncExternalStore(sub, get, get);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => kids.filter(culler.has), [kids, stamp, culler]);
}

/**
 * Legacy non-reactive filter used by `kids.filter(isVisible)`. It only culls once some component uses
 * `useVisible` (otherwise nothing would ever remount a shape that scrolls into view).
 */
export function isVisible(id: ShapeId): boolean {
  const env = activeBoard();
  if (!env) return true;
  const c = cullerFor(env);
  return !c.reactive || c.has(id);
}
