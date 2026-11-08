// Comment routing: which agent a note on a layer goes to (via agents/router.ts), and how a layer is labelled in chat.
import { route as decide, GENERAL } from '../../agents/router';
import type { RouteWhy, RouterAgent, RouterInput } from '../../agents/router';
import type { AgentRuntime } from '../../agents/runtime';
import type { BoardKit } from '../../core/commands';
import { ancestors } from '../../core/tree';
import type { ShapeId } from '../../core/types';

/** Legacy per-send pin shape; the page still passes `chat.pins` (always empty now) to <Pins>. Real pins are `commentThreads`. */
export type Pin = { id: string; n: number; shapeId: string; dx: number; dy: number; thread: string; done: boolean };
export type Route = { thread: string; how: RouteWhy; label: string };

/** "Frame › Layer" for the nearest frame above a layer. */
export function ctxLabel(board: BoardKit, id: ShapeId): string {
  const st = board.doc.getState();
  const s = st.shapes.get(id);
  if (!s) return '';
  const f = ancestors(st, id).map((a) => st.shapes.get(a)!).find((a) => a.kind === 'frame');
  return f ? `${f.name} › ${s.name}` : s.name;
}

/** The agents the runtime hosts, as the router sees them (name, role, stopped, queue length). */
export function routerAgents(board: BoardKit, rt: AgentRuntime | null): RouterAgent[] {
  return (rt?.agentIds() ?? []).map((id) => {
    const a = board.actors.get(id);
    return { id, name: a?.name ?? id, ...(a?.role ? { role: a.role } : {}), stopped: rt!.isStopped(id), load: rt!.tasks(id).length };
  });
}

export function routerInput(board: BoardKit, rt: AgentRuntime | null, shapeId?: ShapeId): RouterInput {
  return { agents: routerAgents(board, rt), doc: board.doc.getState(), shapeId, claims: board.claims, presence: board.presence };
}

/** A note about a layer: mention-free routing by claim, author, frame author, role, then the nearest idle agent. */
export function routeFor(board: BoardKit, rt: AgentRuntime | null, id: ShapeId): Route {
  const d = decide(routerInput(board, rt, id));
  return { thread: d.to, how: d.why, label: d.label };
}

export { GENERAL };
