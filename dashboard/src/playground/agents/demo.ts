// Demo script runner (AGENT-17): a deterministic list of timed steps that drives the board and the agents
// ONLY through public APIs (board.exec, the agent runtime, chat.say, camera goTo). No React, no DOM.
// Steps are skippable (abort signal) and never open a gesture themselves, so a skip cannot leave one half-open.
// The seed/reset of the starting board is WP-67's job: it registers `demoHooks.seed` / `demoHooks.reset`.
import { opId } from '../core/ids';
import { union } from '../core/geom';
import { worldBounds } from '../core/tree';
import type { BoardKit } from '../core/commands';
import type { ActorId, Cam, Pt, Rect, ShapeId } from '../core/types';
import type { AgentRuntime } from './runtime';

// ---- steps ----------------------------------------------------------------------------------------------
export type CameraTarget = { fit: 'all' } | { rect: Rect } | { cam: Cam } | { agent: string } | { shape: string };
export type Step = { id: string; beat: string } & (
  | { t: 'spawn'; name: string; role?: string; color?: string }
  | { t: 'say'; as: 'human' | 'coordinator'; text: string; mention?: string }
  | { t: 'wait'; ms: number }
  | { t: 'wait-idle'; timeoutMs: number }
  | { t: 'agent-task'; agent: string; text: string; target?: string; timeoutMs: number }
  | { t: 'conflict-inject'; a: string; b: string; frame: ShapeId }
  | { t: 'camera'; to: CameraTarget; ms?: number }
  | { t: 'caption'; text: string | null }
  | { t: 'assert'; what: 'agents' | 'conflict' | 'card'; min?: number }
  | { t: 'create-frame'; shapeId: ShapeId; name: string; box: Rect }
  | { t: 'stage'; on: boolean }
);
export interface DemoScript { id: string; title: string; seed: number; steps: Step[] }

/** The 3-minute pitch (REQUIREMENTS section 2): three agents spawn, two claim one frame, the coordinator rules, a human asks. */
export const CANONICAL: DemoScript = {
  id: 'contract-pitch', title: 'Contract pitch', seed: 7,
  steps: [
    { id: 's1', beat: '1 · Three agents join', t: 'caption', text: 'Three agents join the board' },
    { id: 's2', beat: '1 · Three agents join', t: 'spawn', name: 'Iris', role: 'Layout' },
    { id: 's3', beat: '1 · Three agents join', t: 'wait', ms: 500 },
    { id: 's4', beat: '1 · Three agents join', t: 'spawn', name: 'Juno', role: 'Copy' },
    { id: 's5', beat: '1 · Three agents join', t: 'wait', ms: 500 },
    { id: 's6', beat: '1 · Three agents join', t: 'spawn', name: 'Milo', role: 'Components' },
    { id: 's7', beat: '2 · They build in parallel', t: 'caption', text: 'Each one builds its own frame, in parallel' },
    { id: 's8', beat: '2 · They build in parallel', t: 'wait-idle', timeoutMs: 40000 },
    { id: 's9', beat: '2 · They build in parallel', t: 'camera', to: { fit: 'all' }, ms: 700 },
    { id: 's10', beat: '3 · A conflict', t: 'caption', text: 'Two agents reach for the same frame' },
    { id: 's11', beat: '3 · A conflict', t: 'create-frame', shapeId: 'demo-hero', name: 'Landing hero', box: { x: -620, y: 40, w: 480, h: 300 } },
    { id: 's12', beat: '3 · A conflict', t: 'camera', to: { shape: 'demo-hero' }, ms: 600 },
    { id: 's13', beat: '3 · A conflict', t: 'conflict-inject', a: 'Iris', b: 'Juno', frame: 'demo-hero' },
    { id: 's14', beat: '3 · A conflict', t: 'assert', what: 'conflict' },
    { id: 's15', beat: '4 · The coordinator rules', t: 'caption', text: 'The coordinator rules: Iris keeps it' },
    { id: 's16', beat: '4 · The coordinator rules', t: 'say', as: 'coordinator', text: 'Iris holds Landing hero. Juno, take the pricing copy instead.' },
    { id: 's17', beat: '4 · The coordinator rules', t: 'wait', ms: 1500 },
    { id: 's18', beat: '5 · A human steps in', t: 'caption', text: 'A human asks for a change' },
    { id: 's19', beat: '5 · A human steps in', t: 'camera', to: { agent: 'Iris' }, ms: 600 },
    { id: 's20', beat: '5 · A human steps in', t: 'say', as: 'human', mention: 'Iris', text: '@Iris make it purple' },
    { id: 's21', beat: '5 · A human steps in', t: 'agent-task', agent: 'Iris', text: 'make it purple', target: 'Button', timeoutMs: 25000 },
    { id: 's22', beat: '5 · A human steps in', t: 'assert', what: 'card' },
    { id: 's23', beat: '6 · Undo', t: 'caption', text: 'One click on the action card undoes it' },
    { id: 's24', beat: '6 · Undo', t: 'wait', ms: 2500 },
    { id: 's25', beat: '6 · Undo', t: 'caption', text: null },
  ],
};

// ---- environment (everything the runner touches comes in here, so tests use fakes) -------------------------
export interface DemoClock { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }
export const realDemoClock: DemoClock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); };
    const t = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  }),
};

export interface DemoEnv {
  board: BoardKit;
  rt: AgentRuntime | null;
  clock: DemoClock;
  /** Camera move (wire to core/goto goTo). Absent = no camera (tests). */
  goTo?: (target: Rect | Cam | Pt, o: { animate?: boolean | number; pulse?: boolean }) => void;
  /** View size for `fit: all` is handled by goTo itself; this only exists so tests can observe camera calls. */
  toast?: (text: string) => void;
  /** Cards seen so far (the page counts action cards posted by agents; tests count `rt` onAction). */
  cards?: () => number;
}

/** WP-67 registers these. `seed` fills the starting board; `reset` returns to it (default: clear agents and layers). */
export const demoHooks: { seed?: (env: DemoEnv) => void; reset?: (env: DemoEnv) => void } = {};

// ---- small stores: what the bar and actions share ----------------------------------------------------------
export interface DemoUi { stage: boolean; visible: boolean }
let ui: DemoUi = { stage: false, visible: false };
const uiSubs = new Set<() => void>();
export const demoUi = {
  get: () => ui,
  set(p: Partial<DemoUi>) { ui = { ...ui, ...p }; [...uiSubs].forEach((f) => f()); },
  subscribe(f: () => void) { uiSubs.add(f); return () => { uiSubs.delete(f); }; },
};

export interface RunnerState {
  status: 'idle' | 'playing' | 'paused' | 'done';
  index: number;            // next step to run
  total: number;
  running: boolean;         // a step is in flight
  beat: string;
  caption: string | null;
  note: string | null;      // last timeout / skip remark
}

export interface DemoRunner {
  getState(): RunnerState;
  subscribe(f: () => void): () => void;
  play(): void;
  pause(): void;
  next(): void;
  reset(): void;
  dispose(): void;
}

let active: DemoRunner | null = null;
export const activeRunner = () => active;
export const setActiveRunner = (r: DemoRunner | null) => { active = r; };

// ---- helpers ------------------------------------------------------------------------------------------------
const byName = (env: DemoEnv, name: string): ActorId | undefined => env.board.actors.list().find((a) => a.name === name && a.kind === 'agent')?.id;

function findShape(env: DemoEnv, name: string, author?: ActorId): ShapeId | undefined {
  const st = env.board.doc.getState();
  const walk = (parent: ShapeId | null): ShapeId | undefined => {
    for (const id of st.children.get(parent) ?? []) {
      const s = st.shapes.get(id);
      if (!s || s.deleted) continue;
      if (s.name === name && (!author || s.author === author)) return id;
      const inner = walk(id);
      if (inner) return inner;
    }
    return undefined;
  };
  return walk(null);
}

function allIdle(env: DemoEnv): boolean {
  const ids = env.rt?.agentIds() ?? [];
  const st = env.board.doc.getState();
  // every agent has put its first frame on the board and is no longer working
  const built = new Set((st.children.get(null) ?? []).map((id) => st.shapes.get(id)).filter((s) => s && !s.deleted).map((s) => s!.createdBy));
  return ids.every((id) => {
    const s = env.board.presence.get(id)?.state;
    return built.has(id) && (s === 'idle' || s === 'stopped' || s === 'waiting_user');
  });
}

function boardSay(env: DemoEnv, actor: ActorId, text: string, to?: ActorId[]) {
  env.board.exec({ actor, opId: opId(actor), commands: [{ t: 'chat.say', thread: 'general', body: { kind: 'text', text }, ...(to?.length ? { to } : {}) }] });
}

const COORDINATOR = 'system-coordinator';
function coordinator(env: DemoEnv): ActorId {
  if (!env.board.actors.get(COORDINATOR)) env.board.actors.register({ id: COORDINATOR, kind: 'system', name: 'Coordinator', color: '#d97757', caps: ['read', 'write', 'comment', 'claim'] });
  return COORDINATOR;
}

/** Poll `cond` every 250 ms until true, aborted or `timeoutMs`. Returns whether it became true. */
async function waitUntil(env: DemoEnv, signal: AbortSignal, timeoutMs: number, cond: () => boolean): Promise<boolean> {
  const t0 = env.clock.now();
  while (!signal.aborted) {
    if (cond()) return true;
    if (env.clock.now() - t0 >= timeoutMs) return false;
    await env.clock.sleep(250, signal);
  }
  return true;
}

export interface StepOutcome { note?: string }

/** Run one step. Resolves when done or when `signal` aborts (a skip); never throws for a missing agent, it reports a note. */
export async function runStep(env: DemoEnv, step: Step, signal: AbortSignal, setCaption: (c: string | null) => void): Promise<StepOutcome> {
  const { board, rt } = env;
  switch (step.t) {
    case 'caption': setCaption(step.text); return {};
    case 'stage': demoUi.set({ stage: step.on }); return {};
    case 'wait': await env.clock.sleep(step.ms, signal); return {};
    case 'spawn': {
      if (!rt) return { note: 'No agent runtime' };
      const at = { x: 600, y: 300 };
      rt.spawn({ name: step.name, role: step.role, color: step.color, at });
      return {};
    }
    case 'wait-idle': {
      const ok = await waitUntil(env, signal, step.timeoutMs, () => allIdle(env));
      return ok ? {} : { note: 'Agents were still busy, continuing' };
    }
    case 'create-frame': {
      if (board.doc.getState().shapes.has(step.shapeId)) return {};
      board.exec({ actor: board.me, opId: opId(board.me), label: `Demo: ${step.name}`, commands: [{ t: 'shape.create', kind: 'frame', id: step.shapeId, props: { ...step.box, name: step.name, fills: [{ type: 'solid', color: '#f4f2ec' }] } }] });
      return {};
    }
    case 'camera': {
      if (!env.goTo) return {};
      const to = step.to;
      const o = { animate: step.ms ?? 600, pulse: false };
      if ('fit' in to) {
        const st = board.doc.getState();
        const r = union((st.children.get(null) ?? []).map((id) => worldBounds(st, id)).filter((x): x is Rect => !!x));
        if (r) env.goTo(r, o);
      } else if ('rect' in to) env.goTo(to.rect, o);
      else if ('cam' in to) env.goTo(to.cam, o);
      else if ('shape' in to) {
        const r = worldBounds(board.doc.getState(), to.shape);
        if (r) env.goTo(r, o);
      } else {
        const id = byName(env, to.agent);
        const p = id ? board.presence.get(id) : undefined;
        if (p && typeof p.x === 'number' && typeof p.y === 'number') env.goTo({ x: p.x, y: p.y }, o);
      }
      await env.clock.sleep(step.ms ?? 600, signal);
      return {};
    }
    case 'say': {
      const to = step.mention ? byName(env, step.mention) : undefined;
      const actor = step.as === 'human' ? board.me : coordinator(env);
      boardSay(env, actor, step.text, to ? [to] : undefined);
      return {};
    }
    case 'agent-task': {
      const id = byName(env, step.agent);
      if (!rt || !id) return { note: `${step.agent} is not on the board` };
      const shapeId = step.target ? findShape(env, step.target, id) ?? findShape(env, step.target) : undefined;
      let finished = false;
      const run = rt.request(id, { text: step.text, shapeId, from: board.me }).then(() => { finished = true; });
      void run;
      const ok = await waitUntil(env, signal, step.timeoutMs, () => finished);
      return ok ? {} : { note: `${step.agent} took too long, continuing` };
    }
    case 'conflict-inject': {
      // Two agents ask for one frame. The first is granted; the second is denied three times (spaced past the
      // 200 ms dedupe) which opens a claim_contention conflict. The coordinator's ruling comes in a later step.
      const a = byName(env, step.a), b = byName(env, step.b);
      if (!a || !b) return { note: 'Conflict needs both agents' };
      const target = { kind: 'frame' as const, id: step.frame };
      const acquire = (actor: ActorId) => board.exec({ actor, opId: opId(actor), commands: [{ t: 'claim.acquire', target, reason: 'demo' }] });
      acquire(a);
      for (let i = 0; i < 3 && !signal.aborted; i++) {
        acquire(b);
        await env.clock.sleep(320, signal);
      }
      return {};
    }
    case 'assert': {
      if (step.what === 'agents') return (rt?.agentIds().length ?? 0) >= (step.min ?? 1) ? {} : { note: 'Expected agents are missing' };
      if (step.what === 'conflict') return board.claims.conflicts().some((c) => c.state === 'open') ? {} : { note: 'No conflict opened' };
      return (env.cards?.() ?? 1) > 0 ? {} : { note: 'No action card appeared' };
    }
  }
}

// ---- the runner --------------------------------------------------------------------------------------------
export function createDemoRunner(env: DemoEnv, script: DemoScript = CANONICAL): DemoRunner {
  const subs = new Set<() => void>();
  let st: RunnerState = { status: 'idle', index: 0, total: script.steps.length, running: false, beat: script.steps[0]?.beat ?? '', caption: null, note: null };
  let ctl: AbortController | null = null;
  let epoch = 0;
  let loop: Promise<void> | null = null;
  let disposed = false;
  const set = (p: Partial<RunnerState>) => { st = { ...st, ...p }; [...subs].forEach((f) => f()); };
  const beatOf = (i: number) => script.steps[Math.min(i, script.steps.length - 1)]?.beat ?? '';

  /** One step with its own abort controller; `next()` aborts it to skip. */
  async function one(): Promise<void> {
    const my = epoch;
    const step = script.steps[st.index];
    if (!step) { set({ status: 'done', running: false }); return; }
    ctl = new AbortController();
    set({ running: true, beat: step.beat, note: null });
    let out: StepOutcome = {};
    try {
      out = await runStep(env, step, ctl.signal, (c) => { if (my === epoch) set({ caption: c }); });
    } catch (e) {
      out = { note: e instanceof Error ? e.message : 'Step failed' };
    }
    ctl = null;
    if (my !== epoch || disposed) return;            // reset or dispose happened meanwhile
    if (out.note) { set({ note: out.note }); env.toast?.(out.note); }
    const index = st.index + 1;
    set({ index, running: false, beat: beatOf(index), ...(index >= script.steps.length ? { status: 'done' as const } : {}) });
  }

  function start(mode: 'play' | 'once') {
    if (loop || disposed) return;
    if (st.status === 'done') return;
    if (mode === 'play') set({ status: 'playing' });
    const my = epoch;
    loop = (async () => {
      do { await one(); } while (mode === 'play' && my === epoch && !disposed && st.status === 'playing' && st.index < script.steps.length);
      if (my === epoch && st.status === 'playing') set({ status: st.index >= script.steps.length ? 'done' : 'paused' });
    })().finally(() => { if (my === epoch) loop = null; });
  }

  return {
    getState: () => st,
    subscribe(f) { subs.add(f); return () => { subs.delete(f); }; },
    play() {
      if (st.status === 'done') return;
      if (!st.index && !st.running) demoHooks.seed?.(env);
      start('play');
    },
    pause() { if (st.status === 'playing') set({ status: 'paused' }); },   // the step in flight finishes, then the loop stops
    next() {
      if (ctl) { ctl.abort(); return; }              // skip the step in flight (play mode continues on its own)
      if (st.status === 'playing') return;
      if (!st.index) demoHooks.seed?.(env);
      set({ status: 'paused' });
      start('once');
    },
    reset() {
      epoch++;
      ctl?.abort(); ctl = null; loop = null;
      // stop every agent so no gesture of theirs stays open, then return to the seed
      if (env.rt) { for (const id of env.rt.agentIds()) env.board.presence.remove(id); env.rt.reset(); }
      for (const c of env.board.claims.conflicts()) env.board.claims.dismissConflict(c.id);
      if (demoHooks.reset) demoHooks.reset(env);
      else clearBoard(env);
      st = { status: 'idle', index: 0, total: script.steps.length, running: false, beat: beatOf(0), caption: null, note: null };
      [...subs].forEach((f) => f());
    },
    dispose() { disposed = true; epoch++; ctl?.abort(); subs.clear(); },
  };
}

/** Default reset when WP-67's seed is not registered: delete every top-level layer (one undoable batch). */
function clearBoard(env: DemoEnv) {
  const roots = [...(env.board.doc.getState().children.get(null) ?? [])];
  if (roots.length) env.board.exec({ actor: env.board.me, opId: opId(env.board.me), label: 'Demo: reset', commands: [{ t: 'shape.delete', ids: roots }] });
}
