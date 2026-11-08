// Agent runtime: spawn / stop / pause / speed and the task queue. Each agent is an Actor on the
// board plus a driver; the runtime builds its AgentContext (choreographer, say, setState) and
// never touches the store directly. No React, no DOM.
import { opId } from '../core/ids';
import type { Actor, ActorId, AgentContext, AgentDriver, AgentState, Board, Pt, Task } from '../core/types';
import { createChoreographer, realClock, seededRng } from './choreographer';
import type { Choreographer, Clock } from './choreographer';
import { createScriptedDriver, createSlots } from './scripted';
import type { Slots } from './scripted';

export const NAMES = ['Iris', 'Juno', 'Milo', 'Nova', 'Otto', 'Pia', 'Rex', 'Sol', 'Tess', 'Vik', 'Wren', 'Zed'];
export const COLORS = ['#f24e1e', '#a259ff', '#14ae5c', '#ff7262', '#0fa5e9', '#e8a700', '#ec4899', '#6366f1', '#10b981', '#f97316', '#8b5cf6', '#06b6d4'];

export interface RuntimeOpts {
  board: Board;
  clock?: Clock;
  seed?: number;                          // seeds every agent's rng (agent n uses seed + n)
  makeDriver?: (kind: 'scripted' | 'llm', slots: Slots) => AgentDriver;
  frameMs?: number;
  animate?: boolean;
  maxAgents?: number;
}
export interface SpawnOpts { name?: string; color?: string; at?: Pt; role?: string; driver?: 'scripted' | 'llm' }
export interface NoteReq { text: string; shapeId?: string; threadId?: string; from?: ActorId; priority?: 0 | 1 | 2 | 3 }

type Agent = { actor: Actor; driver: AgentDriver; ctrl: AbortController; choreo: Choreographer; paused: boolean; queue: Task[] };

export function createRuntime(opts: RuntimeOpts) {
  const { board } = opts;
  const clock = opts.clock ?? realClock;
  const slots = createSlots();
  const agents = new Map<ActorId, Agent>();
  const makeDriver = opts.makeDriver ?? ((kind, s) => {
    if (kind !== 'scripted') throw new Error('only the scripted driver exists yet');
    return createScriptedDriver({ slots: s });
  });
  let speed = 1;
  let spawned = 0;
  let taskN = 0;
  let allPaused = false;

  function setState(a: Actor, s: AgentState, detail?: string) {
    board.presence.publish({ actor: a.id, state: s, detail, lastInputAt: clock.now() });
    board.exec({ actor: a.id, opId: opId(a.id), commands: [{ t: 'status.set', state: s, detail }] });
  }

  function spawn(o: SpawnOpts = {}): ActorId {
    const n = spawned++;
    if (agents.size >= (opts.maxAgents ?? 200)) throw new Error('agent roster is full');
    const kind = o.driver ?? 'scripted';
    const id = `agent-${n.toString(36)}`;
    const lap = Math.floor(n / NAMES.length);
    const actor: Actor = {
      id, kind: 'agent', driver: kind, role: o.role,
      name: o.name ?? NAMES[n % NAMES.length] + (lap ? ` ${lap + 1}` : ''),
      color: o.color ?? COLORS[n % COLORS.length],
      caps: ['read', 'write', 'comment', 'claim'],
    };
    const rng = seededRng((opts.seed ?? 1) + n);
    const start = { x: (o.at?.x ?? 600) + (rng() - 0.5) * 300, y: (o.at?.y ?? 300) + (rng() - 0.5) * 200 };
    board.actors.register(actor);
    board.presence.publish({ actor: id, x: start.x, y: start.y, down: false, state: 'idle', lastInputAt: clock.now() });
    const ctrl = new AbortController();
    const agent: Agent = { actor, driver: makeDriver(kind, slots), ctrl, paused: allPaused, queue: [], choreo: undefined as unknown as Choreographer };
    agent.choreo = createChoreographer({
      actor: id, presence: board.presence, rng, clock, speed: () => speed, paused: () => agent.paused, signal: ctrl.signal,
      frameMs: opts.frameMs, animate: opts.animate, start,
    });
    agents.set(id, agent);
    const ctx: AgentContext & { choreo: Choreographer } = {
      me: actor, board, choreo: agent.choreo, signal: ctrl.signal, rng,
      intent: (i) => agent.choreo.intent(i),
      setState: (s, d) => setState(actor, s, d),
      say: (text) => { board.exec({ actor: id, opId: opId(id), commands: [{ t: 'chat.say', thread: id, body: { kind: 'text', text } }] }); },
      paused: () => agent.paused,
    };
    setState(actor, allPaused ? 'paused' : 'idle', 'joining');
    void agent.driver.start(ctx);
    return id;
  }

  /** Stop: abort in-flight work, keep the actor and its cursor, state `stopped`. */
  function stop(id: ActorId) {
    const a = agents.get(id);
    if (!a || a.ctrl.signal.aborted) return;
    a.ctrl.abort();
    a.driver.stop();
    a.queue.length = 0;
    setState(a.actor, 'stopped');
  }

  function remove(id: ActorId) {
    stop(id);
    agents.delete(id);
    board.actors.remove(id);
  }

  function setPaused(id: ActorId, paused: boolean) {
    const a = agents.get(id);
    if (!a || a.ctrl.signal.aborted) return;
    a.paused = paused;
    setState(a.actor, paused ? 'paused' : 'idle', paused ? 'paused' : undefined);
  }
  function setAllPaused(paused: boolean) {
    allPaused = paused;
    for (const id of agents.keys()) setPaused(id, paused);
  }

  /** Queue a note for an agent (higher priority first, FIFO within a priority). Resolves when handled. */
  function request(id: ActorId, r: NoteReq): Promise<void> {
    const a = agents.get(id);
    if (!a || a.ctrl.signal.aborted) return Promise.resolve();   // no script to act on it
    const task: Task = { id: `t${++taskN}`, agent: id, kind: 'note', text: r.text, shapeId: r.shapeId, threadId: r.threadId, priority: r.priority ?? 1, from: r.from ?? 'human-you', state: 'queued' };
    a.queue.push(task);
    a.queue.sort((x, y) => y.priority - x.priority);
    return a.driver.onTask(task).then(() => { task.state = 'done'; a.queue = a.queue.filter((t) => t !== task); });
  }

  /** The human cleared the board: forget the slot grid so agents start laying out from cell 0 again. */
  function resetSlots() { slots.clear(); }

  function reset() {
    for (const id of [...agents.keys()]) remove(id);
    slots.clear();
    spawned = 0;
  }

  return {
    spawn, stop, remove, setPaused, setAllPaused, request, resetSlots, reset,
    setSpeed(s: number) { speed = s; },
    getSpeed: () => speed,
    agentIds: () => [...agents.keys()],
    has: (id: ActorId) => agents.has(id),
    choreographer: (id: ActorId) => agents.get(id)?.choreo,
  };
}
export type AgentRuntime = ReturnType<typeof createRuntime>;
