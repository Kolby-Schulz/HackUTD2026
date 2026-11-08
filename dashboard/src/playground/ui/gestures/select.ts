// Click selection: the hit shape (Cmd/Ctrl = deepest), Shift toggles it in the selection, empty canvas clears.
import type { ShapeId } from '../../core/types';
import { selectIds, selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import { shapeAt } from './pipeline';
import type { PointerInfo } from './pipeline';

/** Updates the human's selection for a click at `p`; returns the hit shape (null on empty canvas). */
export function selectAt(env: BoardEnv, p: PointerInfo): ShapeId | null {
  const hit = shapeAt(env, p.world, p.mod);
  const cur = selectedIds(env.board);
  if (!hit) { if (!p.shift && cur.length) selectIds(env.board, []); return null; }
  if (p.shift) selectIds(env.board, cur.includes(hit) ? cur.filter((id) => id !== hit) : [...cur, hit]);
  else if (!cur.includes(hit)) selectIds(env.board, [hit]);
  return hit;
}
