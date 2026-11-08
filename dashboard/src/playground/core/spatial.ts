// Uniform-grid spatial index over world AABBs (D5, CANVAS-19, ALIGN-9, SELECT-47). Pure: no store, React or DOM.
// Wiring (WP-08): after `store.load` call `index.rebuild(state)`; in `store.onChange(ids => index.update(store.getState(), ids))`.
import { ancestors, worldBounds, descendants } from './tree';
import type { TreeView } from './tree';
import type { Pt, Rect, ShapeId } from './types';

export const CELL = 512;
/** Shapes touching more cells than this live in a side list instead of the grid. */
const MAX_CELLS = 64;

const cellOf = (v: number) => Math.floor(v / CELL);
const key = (cx: number, cy: number) => `${cx},${cy}`;

/** Normalize NaN / negative sizes so every indexed box is finite with w, h >= 0. */
function clean(r: Rect): Rect {
  const f = (n: number) => (Number.isFinite(n) ? n : 0);
  let { x, y, w, h } = { x: f(r.x), y: f(r.y), w: f(r.w), h: f(r.h) };
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, w, h };
}

/** Inclusive overlap (touching counts, so zero-size shapes and point queries work). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

const deadAncestor = (view: TreeView, id: ShapeId) => ancestors(view, id).some((a) => view.shapes.get(a)?.deleted);

export class SpatialIndex {
  private cells = new Map<string, Set<ShapeId>>();
  private big = new Set<ShapeId>();
  private boxes = new Map<ShapeId, Rect>();
  private orderCache: Map<ShapeId, number> | null = null;

  get size(): number { return this.boxes.size; }
  bounds(id: ShapeId): Rect | undefined { return this.boxes.get(id); }

  /** Drop everything and index every live shape of the document. */
  rebuild(view: TreeView): void {
    this.cells.clear(); this.big.clear(); this.boxes.clear(); this.orderCache = null;
    for (const s of view.shapes.values()) {
      if (s.deleted || deadAncestor(view, s.id)) continue;
      const b = worldBounds(view, s.id);
      if (b) this.insert(s.id, clean(b));
    }
  }

  /** Re-index changed ids and their descendants (a moved parent moves its children). Deleted or unknown ids are removed. */
  update(view: TreeView, ids: readonly ShapeId[]): void {
    this.orderCache = null;
    const todo = new Set<ShapeId>();
    for (const id of ids) {
      todo.add(id);
      if (view.shapes.has(id)) descendants(view, id).forEach((d) => todo.add(d));
    }
    for (const id of todo) {
      this.remove(id);
      const s = view.shapes.get(id);
      if (!s || s.deleted || deadAncestor(view, id)) continue;
      const b = worldBounds(view, id);
      if (b) this.insert(id, clean(b));
    }
  }

  /** Ids whose world AABB overlaps `rect` (inclusive). Unordered, no duplicates. */
  queryRect(rect: Rect): ShapeId[] {
    const q = clean(rect);
    const out: ShapeId[] = [];
    const seen = new Set<ShapeId>();
    const x0 = cellOf(q.x), x1 = cellOf(q.x + q.w), y0 = cellOf(q.y), y1 = cellOf(q.y + q.h);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      // Query covers more cells than exist: walk the occupied cells instead.
      for (const [k, set] of this.cells) {
        const [cx, cy] = k.split(',').map(Number);
        if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
        this.collect(set, q, seen, out);
      }
    } else {
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const set = this.cells.get(key(cx, cy));
        if (set) this.collect(set, q, seen, out);
      }
    }
    this.collect(this.big, q, seen, out);
    return out;
  }

  /** Ids within `tolerance` world units of a point. */
  queryPoint(pt: Pt, tolerance = 0): ShapeId[] {
    return this.queryRect({ x: pt.x - tolerance, y: pt.y - tolerance, w: tolerance * 2, h: tolerance * 2 });
  }

  /** Paint-order rank of every live shape (depth-first, later = on top). Cached until the next update. */
  order(view: TreeView, flat: (v: TreeView) => ShapeId[]): Map<ShapeId, number> {
    if (!this.orderCache) {
      const m = new Map<ShapeId, number>();
      flat(view).forEach((id, i) => m.set(id, i));
      this.orderCache = m;
    }
    return this.orderCache;
  }

  private collect(set: Set<ShapeId>, q: Rect, seen: Set<ShapeId>, out: ShapeId[]) {
    for (const id of set) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (overlaps(this.boxes.get(id)!, q)) out.push(id);
    }
  }

  private insert(id: ShapeId, b: Rect) {
    this.boxes.set(id, b);
    const x0 = cellOf(b.x), x1 = cellOf(b.x + b.w), y0 = cellOf(b.y), y1 = cellOf(b.y + b.h);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) { this.big.add(id); return; }
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const k = key(cx, cy);
      let set = this.cells.get(k);
      if (!set) this.cells.set(k, (set = new Set()));
      set.add(id);
    }
  }

  private remove(id: ShapeId) {
    const b = this.boxes.get(id);
    if (!b) return;
    this.boxes.delete(id);
    if (this.big.delete(id)) return;
    const x0 = cellOf(b.x), x1 = cellOf(b.x + b.w), y0 = cellOf(b.y), y1 = cellOf(b.y + b.h);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const k = key(cx, cy), set = this.cells.get(k);
      if (set) { set.delete(id); if (set.size === 0) this.cells.delete(k); }
    }
  }
}
