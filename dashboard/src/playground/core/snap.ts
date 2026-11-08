// Snap facade (D6, ALIGN-10). FROZEN after WP-06: signatures below are the contract.
// Gestures call with thresholdWorld = 5 / z; agents call with 2. Real logic lands in snap/move.ts and snap/resize.ts.
import type { ActorId, Pt, Rect, ShapeId } from './types';
import { snapMoveImpl } from './snap/move';
import { snapResizeImpl, snapCreateImpl } from './snap/resize';

export type SnapCtx = {
  actor: ActorId;
  /** Shapes that must not act as candidates (the moving shapes and their descendants). */
  ignore: Set<ShapeId>;
  /** Snap distance in world units. */
  thresholdWorld: number;
  /** Parent of the moving shape (candidates come from this parent's space); null = root. */
  parent: ShapeId | null;
};

/** A guide line: `axis: 'x'` is a vertical line at x = `at`, spanning y from `from` to `to`; 'y' is the transpose. */
export type SnapLine = { axis: 'x' | 'y'; at: number; from: number; to: number; kind?: 'edge' | 'center' };
/** An equal-gap marker between two boxes along `axis`, `size` world units wide, drawn at `at` on the other axis. */
export type SnapGap = { axis: 'x' | 'y'; from: number; to: number; at: number; size: number };
/** dx, dy: nudge to add to the input so it lands on the snap (0 when nothing snapped). */
export type SnapResult = { dx: number; dy: number; lines: SnapLine[]; gaps: SnapGap[] };

export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export function snapMove(box: Rect, ctx: SnapCtx): SnapResult { return snapMoveImpl(box, ctx); }
export function snapResize(box: Rect, handle: ResizeHandle, ctx: SnapCtx): SnapResult { return snapResizeImpl(box, handle, ctx); }
export function snapCreate(pt: Pt, ctx: SnapCtx): SnapResult { return snapCreateImpl(pt, ctx); }

// ---- guide store: gestures publish, the overlay subscribes ----
const EMPTY: SnapResult = { dx: 0, dy: 0, lines: [], gaps: [] };
let current: SnapResult = EMPTY;
const listeners = new Set<() => void>();

export const snapResult = {
  get(): SnapResult { return current; },
  set(r: SnapResult): void { current = r; listeners.forEach((l) => l()); },
  clear(): void { if (current !== EMPTY) { current = EMPTY; listeners.forEach((l) => l()); } },
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
};
