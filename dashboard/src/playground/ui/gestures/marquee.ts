// Marquee selection (WP-17). Skeleton: not implemented, so empty-canvas drags fall back to pan.
import type { BoardEnv } from '../board/state';
import type { Mode, PointerInfo } from './pipeline';

export function startMarquee(_env: BoardEnv, _p: PointerInfo): Mode | null {
  return null;
}
