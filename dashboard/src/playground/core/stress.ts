// window.board.stress({agents, shapes}) (CANVAS-42): seeds a grid of rects and spawns lightweight wandering
// cursors that also edit now and then. Read frame stats from the HUD (`board.debug(true)`, `board.perf()`).
//
//   board.stress({ agents: 50, shapes: 2000 })   -> { ok, stop() }
//   board.stress()                               -> usage
//   board.stress.stop()  /  board.stress({ stop: true })
//
// One scheduler subscription drives every cursor (O(agents) work per tick, positions published at ~20 Hz,
// staggered so each frame touches 1/3 of the agents). stop() removes the cursors, the shapes and the callback.
import { createShapes, layout } from './bench';
import type { BoardKit } from './commands';
import { scheduler } from './raf';
import type { AgentState, ShapeId } from './types';

export interface StressOpts { agents?: number; shapes?: number; editsPerSec?: number; seed?: number; stop?: boolean }
export interface StressHandle { ok: true; agents: number; shapes: number; stop(): void }

const STATES: AgentState[] = ['drawing', 'thinking', 'idle', 'drawing', 'waiting_user'];
const TOOLS = ['select', 'rect', 'text', 'pen', 'ellipse'];
const PUBLISH_EVERY = 3;       // frames between a given agent's publishes
const MAX_AGENTS = 500;

/** Small deterministic PRNG so runs are repeatable. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Next wander target: a point inside the extent, biased to move 150..700 units from where it is. */
export function nextTarget(rng: () => number, from: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
  const ang = rng() * Math.PI * 2, d = 150 + rng() * 550;
  return { x: Math.min(w, Math.max(0, from.x + Math.cos(ang) * d)), y: Math.min(h, Math.max(0, from.y + Math.sin(ang) * d)) };
}

let current: StressHandle | null = null;

export function startStress(board: BoardKit, o: StressOpts = {}): StressHandle {
  current?.stop();
  const nAgents = Math.max(0, Math.min(MAX_AGENTS, Math.floor(o.agents ?? 50)));
  const nShapes = Math.max(0, Math.floor(o.shapes ?? 0));
  const rng = mulberry(o.seed ?? 1);
  const L = layout(Math.max(nShapes, 60));
  const hadConsole = !!board.actors.get('api-console');
  const shapeIds: ShapeId[] = nShapes ? createShapes(board, nShapes) : [];

  const agents = Array.from({ length: nAgents }, (_, i) => {
    const a = board.actors.spawn({ kind: 'api', name: `Stress ${i + 1}` });
    const pos = { x: rng() * L.w, y: rng() * L.h };
    const st: AgentState = STATES[i % STATES.length];
    board.presence.publish({ actor: a.id, x: pos.x, y: pos.y, down: false, state: st, tool: TOOLS[i % TOOLS.length] });
    return { id: a.id, pos, to: nextTarget(rng, pos, L.w, L.h), speed: 120 + rng() * 280, st };
  });

  const edits = o.editsPerSec ?? 20;
  let frame = 0, editAcc = 0, stopped = false;
  const sub = scheduler.register((dt) => {
    const sec = dt / 1000;
    frame++;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const dx = a.to.x - a.pos.x, dy = a.to.y - a.pos.y, dist = Math.hypot(dx, dy), step = a.speed * sec;
      if (dist <= step) { a.pos = a.to; a.to = nextTarget(rng, a.pos, L.w, L.h); } else { a.pos = { x: a.pos.x + (dx / dist) * step, y: a.pos.y + (dy / dist) * step }; }
      if ((frame + i) % PUBLISH_EVERY === 0) board.presence.publish({ actor: a.id, x: a.pos.x, y: a.pos.y });
    }
    if (shapeIds.length && agents.length) {
      editAcc += edits * sec;
      while (editAcc >= 1) {
        editAcc -= 1;
        const who = agents[Math.floor(rng() * agents.length)], id = shapeIds[Math.floor(rng() * shapeIds.length)];
        board.exec({ actor: who.id, opId: `stress-${frame}-${editAcc.toFixed(3)}-${id}`, commands: [{ t: 'shape.update', ids: [id], patch: { fills: [{ type: 'solid', color: `hsl(${Math.floor(rng() * 360)} 40% 82%)` }] } }] });
      }
    }
    return true;    // keep running every frame
  });
  sub.wake();

  const handle: StressHandle = {
    ok: true, agents: nAgents, shapes: shapeIds.length,
    stop() {
      if (stopped) return;
      stopped = true;
      sub.dispose();
      for (const a of agents) { board.presence.remove?.(a.id); board.actors.remove(a.id); }
      for (let i = 0; i < shapeIds.length; i += 500) {
        board.exec({ actor: 'api-console', opId: `stress-del-${Date.now()}-${i}`, commands: [{ t: 'shape.delete', ids: shapeIds.slice(i, i + 500) }] });
      }
      if (!hadConsole && shapeIds.length) board.actors.remove('api-console');
      if (current === handle) current = null;
    },
  };
  current = handle;
  return handle;
}

/** The console entry: `board.stress({agents: 50, shapes: 2000})`. Dev-only (reachable only through window.board). */
export function stress(o?: StressOpts): StressHandle | { ok: boolean; note: string } {
  const board: (BoardKit & { presence: { remove?: (a: string) => void } }) | undefined = (globalThis as any).board?.core;
  if (o?.stop) { current?.stop(); return { ok: true, note: 'stopped' }; }
  if (!o || !board) return { ok: false, note: 'usage: board.stress({ agents: 50, shapes: 2000 })  then board.debug(true); stop with board.stress({ stop: true })' };
  return startStress(board, o);
}
stress.stop = () => { current?.stop(); };
