// Stub (replaced by the ALIGN work package): returns the input unchanged, no guides.
import type { ResizeHandle, SnapCtx, SnapResult } from '../snap';
import type { Pt, Rect } from '../types';

export function snapResizeImpl(_box: Rect, _handle: ResizeHandle, _ctx: SnapCtx): SnapResult {
  return { dx: 0, dy: 0, lines: [], gaps: [] };
}
export function snapCreateImpl(_pt: Pt, _ctx: SnapCtx): SnapResult {
  return { dx: 0, dy: 0, lines: [], gaps: [] };
}
