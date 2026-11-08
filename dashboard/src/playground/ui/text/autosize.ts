// Text resize modes and autosize (TEXT-4, SELECT-43). Pure helpers plus ONE write-back function.
// Rule (networking scope): only the AUTHOR of an edit writes the measured size back. The author is the human who is
// editing (TextEditor) or the agent host for agent text (role 'host', written as the `system-measure` actor). Viewers
// never re-measure and write: their render follows the synced w/h. Everything funnels through `writeMeasuredSize`.
import { opId } from '../../core/ids';
import type { Board, Shape, ShapeId } from '../../core/types';
import { fitSize } from '../../render/measure';

export type TextMode = NonNullable<Shape['textMode']>;
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const SYSTEM_MEASURE_ACTOR = 'system-measure';
export const MIN_EM = 1; // minimum width = one em

/** Mode after the user drags `handle` on a text box (Figma): width edges -> auto-h, height edges and corners -> fixed. */
export function modeAfterResize(mode: TextMode | undefined, handle: ResizeHandle): TextMode {
  const cur = mode ?? 'auto-h';
  if (handle === 'e' || handle === 'w') return cur === 'fixed' ? 'fixed' : 'auto-h';
  return 'fixed';
}
/** Double-clicking a resize handle resets to auto width. */
export const modeAfterHandleDoubleClick = (): TextMode => 'auto-w';

/** The w/h patch that makes a text shape fit its content, or null if nothing changes (fixed, or already fitted). */
export function sizePatch(shape: Shape): { w?: number; h?: number } | null {
  const fit = fitSize({ ...shape, w: Math.max(shape.w, (shape.fontSize ?? 16) * MIN_EM) });
  if (!fit) return null;
  const w = shape.text ? fit.w : Math.max(2, fit.w); // empty auto-width keeps a 2px caret box
  const patch: { w?: number; h?: number } = {};
  if (w !== shape.w && (shape.textMode ?? 'auto-h') === 'auto-w') patch.w = w;
  if (fit.h !== shape.h) patch.h = fit.h;
  return patch.w === undefined && patch.h === undefined ? null : patch;
}

export type Author =
  | { role: 'editor'; actor: string }   // the local human editing this text (or changing its font/mode)
  | { role: 'host' };                    // the agent host, for text an agent created
/** May this peer write the measured size? Editors only for their own session; the host only for agent-made text. */
export function mayWriteMeasured(shape: Shape, by: Author, localIsHost: boolean): boolean {
  if (by.role === 'editor') return by.actor.startsWith('human-');
  return localIsHost && shape.createdBy.startsWith('agent-');
}

/**
 * THE write-back. Measures `id` and writes w/h in one exec. Returns true if something was written.
 * Call sites: TextEditor (role 'editor', done here), the agent host after each agent text create/update/font change
 * (role 'host', localIsHost true), and the inspector after font/size/line-height/mode changes (role 'editor').
 * Never call it from a render path or a subscription that runs on remote ops.
 */
export function writeMeasuredSize(board: Pick<Board, 'exec'> & { doc: { getState(): { shapes: ReadonlyMap<ShapeId, Shape> } } },
  id: ShapeId, by: Author, localIsHost = false): boolean {
  const s = board.doc.getState().shapes.get(id);
  if (!s || s.deleted || s.kind !== 'text' || !mayWriteMeasured(s, by, localIsHost)) return false;
  const patch = sizePatch(s);
  if (!patch) return false;
  const actor = by.role === 'host' ? SYSTEM_MEASURE_ACTOR : by.actor;
  const r = board.exec({ actor, opId: opId(actor), commands: [{ t: 'shape.update', ids: [id], patch }], label: 'Fit text' });
  return r.ok;
}
