// Stub (replaced by the ALIGN work package): returns the input unchanged, no guides.
import type { SnapCtx, SnapResult } from '../snap';
import type { Rect } from '../types';

export function snapMoveImpl(_box: Rect, _ctx: SnapCtx): SnapResult {
  return { dx: 0, dy: 0, lines: [], gaps: [] };
}
