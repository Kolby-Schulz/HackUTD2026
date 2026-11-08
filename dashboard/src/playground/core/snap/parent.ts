// Parent frame as a snap candidate (ALIGN-8): the immediate parent's left/centre/right and top/middle/bottom.
// Pure: no React or DOM. Its box spans the whole frame, so guides to it run the frame's full height or width.
import { absRect } from '../tree';
import type { Rect, ShapeId } from '../types';
import type { Candidate, SnapSource } from './candidates';

/** The parent frame as a candidate, or null at root, when the parent is gone/hidden/empty or is itself being edited. */
export function parentCandidate(src: SnapSource, parent: ShapeId | null, ignore: ReadonlySet<ShapeId>): Candidate | null {
  if (parent === null || ignore.has(parent)) return null;
  const s = src.view.shapes.get(parent);
  if (!s || s.deleted || s.hidden) return null;
  const box: Rect | null = src.index.bounds(parent) ?? absRect(src.view, parent);
  if (!box || !(box.w > 0) || !(box.h > 0)) return null;
  return { id: parent, box };
}

/**
 * Sibling candidates plus the parent frame (first, so equal-distance ties keep the frame).
 * Only the immediate parent counts, never a grandparent.
 */
export function withParent(cands: Candidate[], src: SnapSource, parent: ShapeId | null, ignore: ReadonlySet<ShapeId>): Candidate[] {
  const p = parentCandidate(src, parent, ignore);
  return p ? [p, ...cands.filter((c) => c.id !== p.id)] : cands;
}
