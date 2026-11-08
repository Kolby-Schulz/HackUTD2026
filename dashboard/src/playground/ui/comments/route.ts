// Comment routing: which agent a note on a layer goes to, and how a layer is labelled in chat.
import type { AgentRuntime } from '../../agents/runtime';
import type { BoardKit } from '../../core/commands';
import { absRect, ancestors } from '../../core/tree';
import type { ActorId, ShapeId } from '../../core/types';

/** A comment pin, anchored to a layer (offset from its top-left) so it follows the layer around. */
export type Pin = { id: string; n: number; shapeId: string; dx: number; dy: number; thread: string; done: boolean };
export type Route = { thread: string; how: 'author' | 'nearest' | 'none' };

/** "Frame › Layer" for the nearest frame above a layer. */
export function ctxLabel(board: BoardKit, id: ShapeId): string {
  const st = board.doc.getState();
  const s = st.shapes.get(id);
  if (!s) return '';
  const f = ancestors(st, id).map((a) => st.shapes.get(a)!).find((a) => a.kind === 'frame');
  return f ? `${f.name} › ${s.name}` : s.name;
}

/** A note about a layer goes to the agent that made it, else its frame's maker, else the nearest agent. */
export function routeFor(board: BoardKit, rt: AgentRuntime | null, id: ShapeId): Route {
  const live = new Set(rt?.agentIds() ?? []);
  const st = board.doc.getState();
  for (const sid of [id, ...ancestors(st, id)]) {
    const s = st.shapes.get(sid);
    const owner = [s?.author, s?.createdBy].find((a) => a && live.has(a));
    if (owner) return { thread: owner, how: 'author' };
  }
  const r = absRect(st, id);
  let best: ActorId | null = null, bd = Infinity;
  for (const a of live) {
    const p = board.presence.get(a);
    if (!r || p?.x === undefined || p.y === undefined) continue;
    const d = Math.hypot(p.x - (r.x + r.w / 2), p.y - (r.y + r.h / 2));
    if (d < bd) { bd = d; best = a; }
  }
  return best ? { thread: best, how: 'nearest' } : { thread: 'general', how: 'none' };
}
