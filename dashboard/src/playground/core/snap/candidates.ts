// Snap candidates (ALIGN-9): which shapes can a move snap to. Pure: no React or DOM.
// The frozen SnapCtx carries no document, so whoever owns the board binds a source once (bindSnapSource).
import { overlaps } from '../spatial';
import type { SpatialIndex } from '../spatial';
import type { TreeView } from '../tree';
import type { Rect, ShapeId } from '../types';

/** Where candidates come from. `viewport` is the visible world rect; `zoom` feeds the hysteresis margin. */
export interface SnapSource {
  view: TreeView;
  index: SpatialIndex;
  viewport?: () => Rect | null;
  zoom?: () => number;
  /** Round snapped positions to integers (ALIGN-7). Default true. */
  round?: () => boolean;
}

let source: SnapSource | null = null;
/** Bind the board's tree view and spatial index (pass null to unbind). Until bound, snapMove returns no snap. */
export function bindSnapSource(s: SnapSource | null): void { source = s; }
export function getSnapSource(): SnapSource | null { return source; }

/** Considered candidates per query, nearest first (ALIGN-9). */
export const MAX_CANDIDATES = 2000;

export interface Candidate { id: ShapeId; box: Rect }

/**
 * Candidate boxes (world AABBs) for a move: live, visible, non-empty siblings under `parent`,
 * overlapping `region`, not in `ignore` and not descending from it. Nearest to `near` first, capped.
 */
export function collectCandidates(
  src: SnapSource, region: Rect, ignore: ReadonlySet<ShapeId>, parent: ShapeId | null, near: Rect, cap = MAX_CANDIDATES,
): Candidate[] {
  const out: Candidate[] = [];
  for (const id of src.index.queryRect(region)) {
    if (ignore.has(id)) continue;
    const s = src.view.shapes.get(id);
    if (!s || s.deleted || s.hidden || s.parent !== parent) continue;
    const box = src.index.bounds(id);
    if (!box || box.w <= 0 || box.h <= 0 || !overlaps(box, region)) continue;
    if (underIgnored(src.view, id, ignore)) continue;
    out.push({ id, box });
  }
  if (out.length > cap) {
    const cx = near.x + near.w / 2, cy = near.y + near.h / 2;
    const d = (c: Candidate) => (c.box.x + c.box.w / 2 - cx) ** 2 + (c.box.y + c.box.h / 2 - cy) ** 2;
    out.sort((a, b) => d(a) - d(b));
    out.length = cap;
  }
  return out;
}

function underIgnored(view: TreeView, id: ShapeId, ignore: ReadonlySet<ShapeId>): boolean {
  if (ignore.size === 0) return false;
  let p = view.shapes.get(id)?.parent ?? null;
  for (let n = 0; p !== null && n < 1000; n++) {
    if (ignore.has(p)) return true;
    p = view.shapes.get(p)?.parent ?? null;
  }
  return false;
}
