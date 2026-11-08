// CSS cursor for the human's own pointer per tool / hover target (CANVAS-22). Native cursors only;
// remote and agent cursors are still drawn by ui/Cursors.tsx. Resize handles carry their own cursors.
import type { Tool } from './state';

export interface CursorState { dragging?: boolean; space?: boolean; alt?: boolean }

export function cursorFor(tool: Tool, hover?: string | null, mods: CursorState = {}): string {
  if (hover === 'locked') return 'not-allowed';
  if (tool === 'hand' || mods.space) return mods.dragging ? 'grabbing' : 'grab';
  if (tool === 'frame' || tool === 'rect' || tool === 'ellipse') return 'crosshair';
  if (tool === 'text') return 'text';
  if (tool === 'comment') return commentCursor;
  if (mods.dragging) return mods.alt ? 'copy' : 'default';
  return 'default';
}

// Speech-bubble cursor (SVG data URL, hotspot at the bubble's tail).
const SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M3 21V11a8 8 0 1 1 8 8H3z' fill='white' stroke='black' stroke-width='2' stroke-linejoin='round'/></svg>";
export const commentCursor = `url("data:image/svg+xml,${encodeURIComponent(SVG)}") 3 21, crosshair`;
