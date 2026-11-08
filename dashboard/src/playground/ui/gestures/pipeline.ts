// Pointer state machine (skeleton). One pointer-down picks a gesture mode from the tool, the
// modifiers and what is under the pointer; the mode then owns move / up / cancel until release.
// Every document change a mode makes goes through board.gesture (continuous) or board.exec.
import { hitTest } from '../../core/hittest';
import type { Pt, ShapeId } from '../../core/types';
import type { BoardEnv } from '../board/state';
import { commentClick, commentHover } from './comment';
import { startCreate } from './create';
import { startMarquee } from './marquee';
import { startMove } from './move';
import { startPan } from './pan';
import { startResize } from './resize';
import { clearPress, finishClick, selectAt } from './select';
import { commitText, startTextTool } from './text';
import { selectIds, selectedIds } from '../board/state';

/** Screen px a press must travel before it becomes a drag; less is a click (SELECT-9). */
export const DRAG_PX = 3;
/** Two clicks within this many ms and px are a double-click (SELECT-9). */
export const DBL_MS = 300;
export const DBL_PX = 4;

export interface PointerInfo {
  clientX: number; clientY: number;
  world: Pt;                 // world coordinates
  button: number;
  shift: boolean; alt: boolean; mod: boolean;
  /** Resize handle under the pointer ('nw' | 'ne' | 'sw' | 'se'), if any. */
  handle?: string;
}

/** A running gesture. `cancel` restores the document to how it was at pointer-down. */
export interface Mode {
  move(p: PointerInfo): void;
  up(p: PointerInfo): void;
  cancel(): void;
}

/** Topmost shape under a world point, using the one hit-test (D6). */
export function shapeAt(env: BoardEnv, p: Pt, deep = false): ShapeId | null {
  return hitTest(env.board.doc.getState(), env.board.index, p, { z: env.camera.getCam().z, deep });
}

/**
 * Escape, one rung per press (SELECT-10): cancel a drag, else close the comment popover, else
 * leave text editing, else move up one level (select the container), else clear the selection,
 * else back to the Move tool. Returns true if a rung ran.
 */
export function escapeLadder(env: BoardEnv): boolean {
  if (env.cancelGesture()) return true;
  const ui = env.ui.get();
  if (ui.pop) { env.ui.set({ pop: null }); return true; }
  if (ui.editing) {
    const id = ui.editing;
    const a = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
    if (a && a !== document.body && a.closest('.pg')) a.blur();        // the editor commits itself on blur
    if (env.ui.get().editing === id) {                                 // no editor was focused: finish it here
      if (env.pendingText?.id === id) commitText(env, id, '');
      env.ui.set({ editing: null });
    }
    return true;
  }
  const sel = selectedIds(env.board);
  if (sel.length) {
    const shapes = env.board.doc.getState().shapes;
    const parents = new Set(sel.map((id) => shapes.get(id)?.parent ?? null));
    const [parent] = parents;
    const pShape = parent != null ? shapes.get(parent) : undefined;
    if (parents.size === 1 && pShape && !pShape.deleted) selectIds(env.board, [parent!]);
    else selectIds(env.board, []);
    return true;
  }
  if (ui.tool !== 'select') { env.ui.set({ tool: 'select', hover: null }); return true; }
  return false;
}

export function createPipeline(env: BoardEnv) {
  let mode: Mode | null = null;
  let downAt: PointerInfo | null = null;   // where the press started
  let dragging = false;                    // moved past DRAG_PX
  let lastClick: { t: number; x: number; y: number; n: number } | null = null;
  const clickFns = new Set<(p: PointerInfo, count: number) => void>();
  const hasWin = typeof window !== 'undefined';

  // losing the window mid-drag aborts it (the pointer-up will never arrive)
  const onBlur = () => { cancel(); };
  function end() { mode = null; downAt = null; dragging = false; if (hasWin) window.removeEventListener('blur', onBlur); }
  function begin(m: Mode | null, p: PointerInfo) {
    mode = m; downAt = p; dragging = false;
    if (m && hasWin) window.addEventListener('blur', onBlur);
  }

  function down(p: PointerInfo) {
    const prev = mode;
    end();
    prev?.cancel();
    clearPress();
    if (p.button === 2) return;   // right-click only opens the context menu: no select / move / pan gesture
    const { tool, space } = env.ui.get();
    if (p.button === 1 || tool === 'hand' || space) { begin(startPan(env, p), p); return; }
    if (p.button !== 0) return;
    if (tool === 'frame' || tool === 'rect' || tool === 'ellipse') { begin(startCreate(env, p, tool), p); return; }
    if (tool === 'comment') { commentClick(env, p); return; }
    if (tool === 'text') { begin(startTextTool(env, p), p); return; }
    if (p.handle) { const m = startResize(env, p); if (m) { begin(m, p); return; } }
    const hit = selectAt(env, p);
    if (hit) { begin(startMove(env, p), p); return; }
    // empty canvas: marquee once it exists (WP-17), pan until then
    begin(startMarquee(env, p) ?? startPan(env, p), p);
  }

  function move(p: PointerInfo) {
    if (mode) {
      // under DRAG_PX the press is still a click: modes see nothing, so a jittery click never moves a shape
      if (!dragging && downAt) {
        if (Math.hypot(p.clientX - downAt.clientX, p.clientY - downAt.clientY) < DRAG_PX) return;
        dragging = true;
      }
      mode.move(p);
      return;
    }
    if (env.ui.get().tool === 'comment') commentHover(env, p);
  }

  function up(p: PointerInfo) {
    const m = mode, d0 = downAt, wasDrag = dragging;
    end();
    if (!m) return;
    if (wasDrag || !d0) { clearPress(); m.up(p); return; }
    m.up(d0);                                // a click: release exactly where it was pressed
    finishClick(env, p);
    const now = Date.now();
    const n = lastClick && now - lastClick.t <= DBL_MS && Math.hypot(p.clientX - lastClick.x, p.clientY - lastClick.y) <= DBL_PX ? lastClick.n + 1 : 1;
    lastClick = { t: now, x: p.clientX, y: p.clientY, n: n >= 2 ? 0 : n };   // a third click starts over
    clickFns.forEach((f) => f(p, n));
  }

  /** Escape mid-drag, window blur, pointercancel. True when a gesture was cancelled. */
  function cancel(): boolean {
    if (!mode) return false;
    const m = mode;
    end();
    clearPress();
    m.cancel();
    return true;
  }

  return {
    down, move, up, cancel, active: () => mode !== null,
    /** True once the press has moved past the drag threshold. */
    dragging: () => dragging,
    /** Called after a press that never became a drag; count 2 = double-click (300 ms, 4 px). */
    onClick(fn: (p: PointerInfo, count: number) => void) { clickFns.add(fn); return () => { clickFns.delete(fn); }; },
    /** The Escape ladder for this board. */
    escape: () => escapeLadder(env),
  };
}
export type Pipeline = ReturnType<typeof createPipeline>;
