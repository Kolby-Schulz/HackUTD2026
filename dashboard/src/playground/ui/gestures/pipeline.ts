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
import { selectAt } from './select';
import { placeText } from './text';

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

export function createPipeline(env: BoardEnv) {
  let mode: Mode | null = null;

  function down(p: PointerInfo) {
    mode?.cancel();
    mode = null;
    const { tool, space } = env.ui.get();
    if (p.button === 1 || tool === 'hand' || space) { mode = startPan(env, p); return; }
    if (p.button !== 0) return;
    if (tool === 'frame' || tool === 'rect' || tool === 'ellipse') { mode = startCreate(env, p, tool); return; }
    if (tool === 'comment') { commentClick(env, p); return; }
    if (tool === 'text') { placeText(env, p.world); return; }
    if (p.handle) { mode = startResize(env, p); if (mode) return; }
    const hit = selectAt(env, p);
    if (hit) { mode = startMove(env, p); return; }
    // empty canvas: marquee once it exists (WP-17), pan until then
    mode = startMarquee(env, p) ?? startPan(env, p);
  }

  function move(p: PointerInfo) {
    if (mode) { mode.move(p); return; }
    if (env.ui.get().tool === 'comment') commentHover(env, p);
  }

  function up(p: PointerInfo) {
    const m = mode;
    mode = null;
    m?.up(p);
  }

  /** Escape mid-drag. True when a gesture was cancelled. */
  function cancel(): boolean {
    if (!mode) return false;
    const m = mode;
    mode = null;
    m.cancel();
    return true;
  }

  return { down, move, up, cancel, active: () => mode !== null };
}
export type Pipeline = ReturnType<typeof createPipeline>;
