// Choreographer: turns Intents into believable cursor motion published on the presence bus.
// Drivers (scripted or LLM) emit Intents; this owns easing, press/drag, typing cadence and
// think-pauses. Time comes from an injectable Clock and randomness from a seeded rng, so tests
// run with no real timers. Pure TS: no React, no DOM.
import type { ActorId, Intent, PresenceBus, Pt, Rect, ShapeId } from '../core/types';

/** Thrown inside a run when the agent is stopped; callers catch it and unwind. */
export const CANCEL = Symbol('cancel');

export interface Clock { now(): number; sleep(ms: number): Promise<void> }
export const realClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Small seeded generator (mulberry32) so cursor paths repeat for a given seed. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the driver wants shape changes applied while the cursor moves (the visual moments). */
export interface Sink {
  /** World-space box of the intent's target, for shapes that are not in the document yet. */
  rect?: Rect;
  onDrag?(world: Rect): void;       // the layer grows with the cursor; final call is the full box
  onType?(typed: string): void;     // text typed so far
}

export interface ChoreoOpts {
  actor: ActorId;
  presence: PresenceBus;
  rng?: () => number;
  clock?: Clock;
  speed?: () => number;             // 1 = normal; scales motion, typing and waits
  paused?: () => boolean;
  signal?: AbortSignal;
  frameMs?: number;                 // presence publish cadence while moving (default 16)
  animate?: boolean;                // false = jump straight to each end state
  start?: Pt;                       // used only when the bus has no position for the actor yet
  shapeRect?: (id: ShapeId) => Rect | undefined;   // world box of a document shape
}

export const PLAN_BUDGET_MS = 20000;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface Choreographer {
  intent(i: Intent, sink?: Sink): Promise<void>;
  moveTo(x: number, y: number, o?: { dur?: number; straight?: boolean; step?: (x: number, y: number) => void }): Promise<void>;
  press(down: boolean): void;
  wait(ms: number): Promise<void>;
  pos(): Pt;
  /** Announce a plan of `layers` layers: durations shrink if it would not finish within the budget. */
  beginPlan(layers: number, budgetMs?: number): void;
  endPlan(): void;
}

export function createChoreographer(o: ChoreoOpts): Choreographer {
  const clock = o.clock ?? realClock;
  const rng = o.rng ?? Math.random;
  const speed = () => Math.max(0.05, o.speed?.() ?? 1);
  const frameMs = o.frameMs ?? 16;
  const animate = o.animate !== false;
  let cur: Pt = { x: o.presence.get(o.actor)?.x ?? o.start?.x ?? 0, y: o.presence.get(o.actor)?.y ?? o.start?.y ?? 0 };
  let down = false;
  let plan: { start: number; total: number; done: number; nominal: number; budget: number } | null = null;

  const publish = (extra: { typing?: string; focus?: Rect } = {}) =>
    o.presence.publish({ actor: o.actor, x: cur.x, y: cur.y, down, lastInputAt: clock.now(), ...extra });
  const check = () => { if (o.signal?.aborted) throw CANCEL; };
  async function hold() {
    check();
    while (o.paused?.()) { await clock.sleep(80); check(); }
  }

  /** Real milliseconds for a nominal duration: speed, plus the plan's budget squeeze. */
  function dur(ms: number): number {
    let scale = 1;
    if (plan) {
      plan.nominal += ms;
      const avg = plan.done ? plan.nominal / plan.done : 1000;
      const need = avg * Math.max(1, plan.total - plan.done);
      const allowed = plan.budget / speed() - (clock.now() - plan.start);
      scale = clamp(allowed / need, 0.1, 1);
    }
    return (ms * scale) / speed();
  }
  const layerDone = () => { if (plan) plan.done++; };

  /** Sleep in small slices; time spent paused does not count. */
  async function wait(ms: number) {
    let left = dur(ms);
    await hold();
    while (left > 0) {
      const slice = Math.min(left, 40);
      await clock.sleep(slice);
      await hold();
      left -= slice;
    }
    check();
  }

  async function moveTo(x: number, y: number, m: { dur?: number; straight?: boolean; step?: (x: number, y: number) => void } = {}) {
    await hold();
    const from = { ...cur };
    const dist = Math.hypot(x - from.x, y - from.y);
    const total = dur(m.dur ?? clamp(200 + dist * 0.8, 200, 1100));
    const bend = m.straight ? 0 : (rng() - 0.5) * 0.3;
    if (animate) {
      let elapsed = 0;
      while (elapsed < total) {
        const slice = Math.min(frameMs, total - elapsed);
        await clock.sleep(slice);
        await hold();                       // paused time is not added to elapsed
        elapsed += slice;
        const e = ease(clamp(elapsed / total, 0, 1));
        const dx = x - from.x, dy = y - from.y, arc = Math.sin(Math.PI * e) * bend;
        cur = { x: from.x + dx * e - dy * arc, y: from.y + dy * e + dx * arc };
        publish();
        m.step?.(cur.x, cur.y);
      }
    }
    cur = { x, y };
    publish();
    m.step?.(x, y);
  }

  function press(d: boolean) { down = d; publish(); }

  async function intent(i: Intent, sink: Sink = {}) {
    await hold();
    switch (i.t) {
      case 'move':
        return moveTo(i.x, i.y);
      case 'think':
        return wait(i.ms ?? 600);
      case 'point': {
        const r = sink.rect ?? o.shapeRect?.(i.shapeId);
        if (r) await moveTo(r.x + r.w / 2, r.y + r.h / 2);
        return;
      }
      case 'drag': {
        const t = i.to;
        press(true);
        publish({ focus: t });
        await moveTo(t.x + t.w, t.y + t.h, {
          straight: true,
          step: (cx, cy) => sink.onDrag?.({ x: t.x, y: t.y, w: Math.max(1, cx - t.x), h: Math.max(1, cy - t.y) }),
        });
        sink.onDrag?.(t);
        press(false);
        layerDone();
        return;
      }
      case 'type': {
        const r = sink.rect ?? o.shapeRect?.(i.shapeId);
        if (r) {
          const fs = r.h / 1.3;
          await moveTo(r.x, r.y + fs * 0.6);
          press(true); await wait(90); press(false);
          for (let k = 1; k <= i.text.length; k++) {
            await wait(25 + rng() * 45);
            sink.onType?.(i.text.slice(0, k));
            cur = { x: r.x + Math.min(r.w, (k * fs * 0.56) % (r.w + 1)), y: cur.y };
            publish({ typing: i.text.slice(0, k) });
          }
        } else {
          for (let k = 1; k <= i.text.length; k++) { await wait(25 + rng() * 45); sink.onType?.(i.text.slice(0, k)); }
        }
        publish({ typing: undefined });
        layerDone();
        return;
      }
    }
  }

  return {
    intent, moveTo, press, wait,
    pos: () => ({ ...cur }),
    beginPlan(layers, budgetMs = PLAN_BUDGET_MS) { plan = { start: clock.now(), total: layers, done: 0, nominal: 0, budget: budgetMs }; },
    endPlan() { plan = null; },
  };
}
