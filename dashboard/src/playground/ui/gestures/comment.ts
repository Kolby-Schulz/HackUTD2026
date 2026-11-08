// Comment tool: hovering outlines the layer under the pointer (the Hover overlay labels it
// "Layer → Agent"); a click opens the popover on that layer. Sending is the shell's job.
import type { BoardEnv } from '../board/state';
import { shapeAt } from './pipeline';
import type { PointerInfo } from './pipeline';

export function commentHover(env: BoardEnv, p: PointerInfo) {
  if (env.ui.get().pop) return;
  env.ui.set({ hover: shapeAt(env, p.world) });
}

export function commentClick(env: BoardEnv, p: PointerInfo) {
  const hit = shapeAt(env, p.world);
  env.ui.set({ pop: hit ? { shapeId: hit, wx: p.world.x, wy: p.world.y } : null, hover: null });
}
