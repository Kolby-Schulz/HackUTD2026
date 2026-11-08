// Live design claims on this board (design_claim rows), and the rule for which frames show a loading state:
// a frame an agent holds a live claim on that has no layers yet is still being designed.
import type { DocState, ShapeId } from '../core/types';
import type { DesignClaimRow, RowChange } from './types';

/** design_claim target for a board frame. */
export const frameTarget = (boardId: string, frameId: ShapeId) => `board:${boardId}/${frameId}`;

export interface LoadingFrame { frameId: ShapeId; holder: string }

/** Frames being designed: a live claim (not expired at `nowMicros`) by an agent actor, on a frame with no live child. */
export function loadingFrames(claims: Iterable<DesignClaimRow>, st: Pick<DocState, 'shapes' | 'children'>, boardId: string, nowMicros: bigint): LoadingFrame[] {
  const prefix = `board:${boardId}/`;
  const out: LoadingFrame[] = [];
  for (const c of claims) {
    if (!c.target.startsWith(prefix) || !c.holder.startsWith('agent-') || c.expiresAt.microsSinceUnixEpoch <= nowMicros) continue;
    const frameId = c.target.slice(prefix.length);
    const f = st.shapes.get(frameId);
    if (!f || f.deleted || f.kind !== 'frame') continue;
    const hasChild = (st.children.get(frameId) ?? []).some((id) => !st.shapes.get(id)?.deleted);
    if (!hasChild) out.push({ frameId, holder: c.holder });
  }
  return out;
}

/** The page's copy of this board's claims, fed by the live session and read by the loading overlay. */
function createDesignClaimStore() {
  const rows = new Map<string, DesignClaimRow>();
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  return {
    apply(c: RowChange<DesignClaimRow>) {
      for (const k of c.removed) rows.delete(k);
      for (const r of c.added) rows.set(r.target, r);
      emit();
    },
    clear() { rows.clear(); emit(); },
    list: () => [...rows.values()],
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  };
}
export const designClaims = createDesignClaimStore();
