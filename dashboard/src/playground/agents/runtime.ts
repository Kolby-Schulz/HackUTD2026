// Agent runtime: spawn / stop / pause / speed and the task queue. Each agent is an Actor on the
// board plus a driver; the runtime builds its AgentContext (choreographer, say, setState) and
// never touches the store directly. No React, no DOM.
import { opId } from '../core/ids';
import type { Actor, ActorId, AgentContext, AgentDriver, AgentState, Board, Pt, Task } from '../core/types';
import { createChoreographer, realClock, seededRng } from './choreographer';
import type { Choreographer, Clock } from './choreographer';
import { createTaskQueue } from './queue';
import type { TaskQueue } from './queue';
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
  /** Chat lines go here (the board's chat.say command needs a handler the page owns). */
  onSay?: (agent: Actor, text: string) => void;
  /** false = this browser does not host agents: spawn/request do nothing (see startAgents). */
  host?: boolean;
}
export interface SpawnOpts { name?: string; color?: string; at?: Pt; role?: string; driver?: 'scripted' | 'llm' }
export interface NoteReq { text: string; shapeId?: string; threadId?: string; from?: ActorId; priority?: 0 | 1 | 2 | 3 }
export interface StatusEvent { t: 'status.changed'; who: ActorId; state: AgentState; seq: number; at: number; actor: ActorId }

/**
 * Legal status transitions (AGENT-8). The only hard rule: a stopped agent leaves `stopped` only by
 * a restart (to `idle`). Everything else is allowed, because drivers move freely between work states
 * and the control layer (pause / stop) overrides them.
 */
export function canTransition(from: AgentState | undefined, to: AgentState): boolean {
  return from !== 'stopped' || to === 'stopped' || to === 'idle';
}

const TAKEOVER_LINE = "You took that over, I'll work elsewhere.";

type Held = { s: AgentState; d?: string };
type Agent = {
  actor: Actor; driver: AgentDriver; ctrl: AbortController; choreo: Choreographer;
  rng: () => number; kind: 'scripted' | 'llm';
  paused: boolean; stopped: boolean;
  queue: TaskQueue; waiters: Map<string, Array<() => void>>;
  state?: AgentState; detail?: string;
  held?: Held;               // what the driver last asked for while the control layer shows `paused`
  gen: number;               // bumps on every (re)launch; stale drivers cannot set state or talk
  mult: number;              // per-agent speed multiplier
  credit: number;            // step mode: commands this agent may still run
  claims: Set<string>;       // claim ids this agent holds, released when it is aborted
};

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
  let stepMode = false;
  let spawned = 0;
  let taskN = 0;
  let allPaused = false;
  const statusListeners = new Set<(e: StatusEvent) => void>();

  /** The one place a status changes: presence + status.set + a `status.changed` event for listeners. */
  function transition(a: Agent, s: AgentState, detail?: string) {
    if (!canTransition(a.state, s)) {
      console.warn(`[agents] illegal transition ${a.state} -> ${s} for ${a.actor.name}`);
      return;
    }
    const changed = a.state !== s;
    a.state = s; a.detail = detail;
    board.presence.publish({ actor: a.actor.id, state: s, detail, lastInputAt: clock.now() });
    board.exec({ actor: a.actor.id, opId: opId(a.actor.id), commands: [{ t: 'status.set', state: s, detail }] });
    if (changed) {
      const e: StatusEvent = { t: 'status.changed', who: a.actor.id, state: s, seq: 0, at: clock.now(), actor: a.actor.id };
      for (const f of [...statusListeners]) f(e);
    }
  }

  /** A driver asks for a state: stored while paused, ignored once stopped. */
  function driverState(a: Agent, s: AgentState, detail?: string) {
    if (a.stopped) return;
    if (stepMode && a.credit > 0) a.credit--;   // one driver step = one command in step mode
    if (a.paused) { a.held = { s, d: detail }; return; }
    transition(a, s, detail);
  }

  const hosting = opts.host !== false;
  const say = (a: Agent, text: string) => { opts.onSay?.(a.actor, text); };

  // ---- claims: remember what each agent holds so an abort can release it ----
  function releaseClaims(a: Agent) {
    for (const claimId of [...a.claims]) {
      a.claims.delete(claimId);
      board.exec({ actor: a.actor.id, opId: opId(a.actor.id), commands: [{ t: 'claim.release', claimId }] });
    }
  }

  // ---- queue pump: the driver sees one task at a time, highest priority first ----
  function settle(a: Agent, t: Task) {
    const ws = a.waiters.get(t.id);
    a.waiters.delete(t.id);
    ws?.forEach((w) => w());
  }
  function pump(a: Agent) {
    if (a.stopped || a.queue.running()) return;
    const t = a.queue.next();
    if (!t) return;
    const gen = a.gen;
    const done = (state: 'done' | 'failed') => {
      if (a.queue.running() !== t) return;      // cancelled or the run was replaced meanwhile
      a.queue.finish(state);
      settle(a, t);
      if (gen === a.gen) pump(a);
    };
    a.driver.onTask(t).then(() => done('done'), () => done('failed'));
  }
  function cancelAllTasks(a: Agent) {
    const running = a.queue.running();
    if (running) { a.queue.finish('cancelled'); settle(a, running); }
    for (const t of a.queue.clear()) settle(a, t);
  }

  // ---- (re)starting the driver for an agent ----
  function launch(a: Agent) {
    const gen = ++a.gen;
    a.ctrl = new AbortController();
    a.choreo = createChoreographer({
      actor: a.actor.id, presence: board.presence, rng: a.rng, clock, signal: a.ctrl.signal,
      speed: () => (stepMode ? 1 : speed) * a.mult,
      paused: () => a.paused || (stepMode && a.credit <= 0),
      frameMs: opts.frameMs, animate: opts.animate,
    });
    a.driver = makeDriver(a.kind, slots);
    const live = () => gen === a.gen;
    const ctx: AgentContext & { choreo: Choreographer } = {
      me: a.actor, board, choreo: a.choreo, signal: a.ctrl.signal, rng: a.rng,
      intent: (i) => a.choreo.intent(i),
      setState: (s, d) => { if (live()) driverState(a, s, d); },
      say: (text) => { if (live()) say(a, text); },
      paused: () => a.paused,
    };
    void a.driver.start(ctx);
    pump(a);
  }

  /** Abort in-flight work only: signal, driver, claims. The agent stays alive (see interrupt / stop). */
  function abortRun(a: Agent) {
    a.ctrl.abort();
    a.driver.stop();
    releaseClaims(a);
  }

  function spawn(o: SpawnOpts = {}): ActorId {
    if (!hosting) return '';
    if (agents.size >= (opts.maxAgents ?? 200)) throw new Error('agent roster is full');
    const n = spawned++;
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
    const agent: Agent = {
      actor, kind, rng, paused: allPaused, stopped: false, queue: createTaskQueue(), waiters: new Map(),
      gen: 0, mult: 1, credit: 0, claims: new Set(),
      ctrl: undefined as unknown as AbortController, driver: undefined as unknown as AgentDriver, choreo: undefined as unknown as Choreographer,
    };
    agents.set(id, agent);
    if (allPaused) { agent.held = { s: 'idle', d: 'joining' }; transition(agent, 'paused', 'paused'); }
    else transition(agent, 'idle', 'joining');
    launch(agent);
    return id;
  }

  /** Stop: abort in-flight work, release locks and claims, keep the actor and its cursor, state `stopped`. */
  function stop(id: ActorId, by?: string) {
    const a = agents.get(id);
    if (!a || a.stopped) return;
    a.stopped = true;
    abortRun(a);
    cancelAllTasks(a);
    a.held = undefined;
    transition(a, 'stopped');
    if (by) say(a, `Stopped by ${by}`);
  }
  function stopAll(by?: string) { for (const id of agents.keys()) stop(id, by); }

  /** Bring a stopped agent back with a fresh, empty task queue. */
  function restart(id: ActorId) {
    const a = agents.get(id);
    if (!a || !a.stopped) return;
    a.stopped = false;
    a.paused = allPaused;
    a.held = undefined;
    transition(a, 'idle', 'restarted');
    if (a.paused) { a.held = { s: 'idle', d: 'restarted' }; transition(a, 'paused', 'paused'); }
    launch(a);
  }

  function remove(id: ActorId) {
    const a = agents.get(id);
    if (a) { stop(id); releaseClaims(a); }
    agents.delete(id);
    board.actors.remove(id);
  }

  function setPaused(id: ActorId, paused: boolean) {
    const a = agents.get(id);
    if (!a || a.stopped || a.paused === paused) return;
    a.paused = paused;
    if (paused) {
      a.held = { s: a.state ?? 'idle', d: a.detail };
      transition(a, 'paused', 'paused');
    } else {
      const h = a.held ?? { s: 'idle' as AgentState };
      a.held = undefined;
      transition(a, h.s === 'paused' ? 'idle' : h.s, h.d);
    }
  }
  function setAllPaused(paused: boolean) {
    allPaused = paused;
    for (const id of agents.keys()) setPaused(id, paused);
  }

  /** A human took the agent's shape: end the current gesture, say so, and carry on elsewhere. */
  function interrupt(a: Agent, line: string) {
    if (a.stopped) return;
    abortRun(a);
    const running = a.queue.running();
    if (running) { a.queue.finish('cancelled'); settle(a, running); }
    say(a, line);
    if (!a.paused) transition(a, 'thinking', 'finding another spot');
    else a.held = { s: 'thinking', d: 'finding another spot' };
    launch(a);       // fresh driver: the next slot / the next queued task
  }

  // ---- board events: lock takeovers and claims ----
  const offEvents = hosting ? board.subscribe({ kinds: ['lock.revoked', 'claim.granted', 'claim.released'] }, (e) => {
    if (e.t === 'claim.granted' || e.t === 'claim.released') {
      const a = e.holder ? agents.get(e.holder) : undefined;
      if (a) { if (e.t === 'claim.granted') a.claims.add(e.claimId); else a.claims.delete(e.claimId); }
      return;
    }
    if (e.t !== 'lock.revoked') return;
    // the victim is the agent named on the event, else any agent that has the shapes selected
    // presence/locks.ts names the revoked agent as `holder` (the human is `actor`/`by`)
    const holder = (e as { holder?: ActorId }).holder;
    const named = agents.get(holder ?? e.actor);
    const victims = named && named.actor.id !== e.by ? [named]
      : agents.get(e.by) ? []
      : [...agents.values()].filter((a) => (board.presence.get(a.actor.id)?.selection ?? []).some((s) => e.ids.includes(s)));
    for (const a of victims) interrupt(a, TAKEOVER_LINE);
  }) : () => {};

  /** Queue a note for an agent (higher priority first, FIFO within a priority). Resolves when handled. */
  function request(id: ActorId, r: NoteReq): Promise<void> {
    const a = agents.get(id);
    if (!hosting || !a || a.stopped) return Promise.resolve();   // no script to act on it
    const task: Task = { id: `t${++taskN}`, agent: id, kind: 'note', text: r.text, shapeId: r.shapeId, threadId: r.threadId, priority: r.priority ?? 1, from: r.from ?? 'human-you', state: 'queued' };
    const res = a.queue.enqueue(task);
    if (!res.ok) { say(a, 'My queue is full (50 tasks), please try again in a moment.'); return Promise.resolve(); }
    const p = new Promise<void>((resolve) => { a.waiters.set(res.task.id, [...(a.waiters.get(res.task.id) ?? []), resolve]); });
    pump(a);
    return p;
  }

  /** Cancel a task by id. A queued one is dropped; the running one aborts the current work and re-plans. */
  function cancelTask(taskId: string): boolean {
    for (const a of agents.values()) {
      const q = a.queue.cancel(taskId);
      if (q) { settle(a, q); return true; }
      const run = a.queue.running();
      if (run?.id === taskId) { interrupt(a, 'Cancelled.'); return true; }
    }
    return false;
  }
  function promoteTask(taskId: string): boolean {
    for (const a of agents.values()) if (a.queue.promote(taskId)) return true;
    return false;
  }
  /** Running task first, then queued ones in the order they will run. */
  function tasks(id: ActorId): Task[] {
    const a = agents.get(id);
    if (!a) return [];
    const run = a.queue.running();
    return run ? [run, ...a.queue.queued()] : [...a.queue.queued()];
  }

  function setSpeed(s: number) {
    stepMode = s === 0;
    speed = stepMode ? speed : Math.max(0.25, Math.min(4, s));
    if (stepMode) for (const a of agents.values()) a.credit = 0;
  }
  /** Step mode (speed 0): let every live agent run one more command. */
  function step() {
    if (!stepMode) return;
    for (const a of agents.values()) if (!a.stopped && !a.paused) a.credit = 1;
  }
  function setAgentSpeed(id: ActorId, m: number) {
    const a = agents.get(id);
    if (a) a.mult = Math.max(0.25, Math.min(4, m));
  }

  /** The human cleared the board: forget the slot grid so agents start laying out from cell 0 again. */
  function resetSlots() { slots.clear(); }

  function reset() {
    for (const id of [...agents.keys()]) remove(id);
    slots.clear();
    spawned = 0;
  }

  return {
    hosting, spawn, stop, stopAll, restart, remove, setPaused, setAllPaused, request, resetSlots, reset,
    cancelTask, promoteTask, tasks, step, setSpeed, setAgentSpeed,
    getSpeed: () => (stepMode ? 0 : speed),
    getAgentSpeed: (id: ActorId) => agents.get(id)?.mult ?? 1,
    isStopped: (id: ActorId) => agents.get(id)?.stopped ?? false,
    /** Subscribe to `status.changed` events for the agents this runtime hosts. */
    onStatus(cb: (e: StatusEvent) => void) { statusListeners.add(cb); return () => { statusListeners.delete(cb); }; },
    dispose() { offEvents(); statusListeners.clear(); },
    agentIds: () => [...agents.keys()],
    has: (id: ActorId) => agents.has(id),
    choreographer: (id: ActorId) => agents.get(id)?.choreo,
  };
}
export type AgentRuntime = ReturnType<typeof createRuntime>;

export interface StartAgentsOpts extends Omit<RuntimeOpts, 'board'> {
  /**
   * Only ONE browser should host agents on a networked board, or every viewer would run its own
   * copy of every agent. Pass `host: false` on the others: they get an inert runtime and simply
   * see the hosting browser's agents through the shared document and presence.
   */
  host?: boolean;
}

/**
 * The single entry point the page calls to run scripted agents on a board.
 * Agents act only through `board.exec` / `board.gesture` and presence.
 *
 * NOTE for viewers: text and frames written by agents carry their final size from the author.
 * A viewer must not re-measure agent text and write the size back (that would make every viewer
 * rewrite the same layer); only a human editing a text layer may trigger auto-size writes.
 */
export function startAgents(board: Board, opts: StartAgentsOpts = {}): AgentRuntime {
  return createRuntime({ ...opts, board });
}
