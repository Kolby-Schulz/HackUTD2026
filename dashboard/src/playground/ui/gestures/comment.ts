// Comment tool: hovering outlines the layer under the pointer (the Hover overlay labels it
// "Layer → Agent"); a click opens the popover on that layer. Sending is the shell's job.
import type { BoardEnv } from '../board/state';
import { commentThreads } from '../../comments/threads';
import { CLAUDE } from '../constants';
import { shapeAt } from './pipeline';
import type { PointerInfo } from './pipeline';

export function commentHover(env: BoardEnv, p: PointerInfo) {
  if (env.ui.get().pop) return;
  env.ui.set({ hover: shapeAt(env, p.world) });
}

export function commentClick(env: BoardEnv, p: PointerInfo) {
  const hit = shapeAt(env, p.world);
  env.ui.set({ pop: hit ? { shapeId: hit, wx: p.world.x, wy: p.world.y } : null, hover: null });
  // Empty canvas: a free pin at the clicked world point, opened for its first note (general chat).
  if (!hit) {
    commentThreads.discardEmpty();
    const t = commentThreads.addAtPoint({ x: p.world.x, y: p.world.y }, { chat: 'general', color: CLAUDE.color });
    commentThreads.open(t.id);
  }
}
