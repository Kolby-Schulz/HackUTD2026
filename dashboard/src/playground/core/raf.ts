// One shared frame scheduler (CANVAS-34). No DOM access at import time: the frame source is injected,
// and the default one only looks at browser globals when it is first used.

export interface FrameSource {
  request(cb: (t: number) => void): number;
  cancel(id: number): void;
  now(): number;
  hidden(): boolean;
  /** Called when the tab becomes visible again. Returns an unsubscribe. */
  onVisible(cb: () => void): () => void;
}

/** Browser globals when present, else a 16 ms timer (Node). Looked up lazily on every call. */
export function defaultFrameSource(): FrameSource {
  const g = globalThis as any;
  return {
    request: (cb) => (typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame(cb) : (setTimeout(() => cb(Date.now()), 16) as unknown as number)),
    cancel: (id) => (typeof g.cancelAnimationFrame === 'function' ? g.cancelAnimationFrame(id) : clearTimeout(id as any)),
    now: () => (g.performance?.now ? g.performance.now() : Date.now()),
    hidden: () => typeof g.document !== 'undefined' && g.document.visibilityState === 'hidden',
    onVisible: (cb) => {
      const d = g.document;
      if (!d?.addEventListener) return () => {};
      const h = () => { if (d.visibilityState !== 'hidden') cb(); };
      d.addEventListener('visibilitychange', h);
      return () => d.removeEventListener('visibilitychange', h);
    },
  };
}

/** Test double: advance time by hand. */
export interface FakeFrameSource extends FrameSource {
  step(ms?: number): void;           // runs the pending frame (if any) at time+ms
  setHidden(h: boolean): void;       // fires onVisible listeners when un-hiding
  pending(): number;                 // 0 or 1
  time: number;
}
export function createFakeFrameSource(): FakeFrameSource {
  let id = 0, cb: ((t: number) => void) | null = null, cbId = 0, hidden = false;
  const listeners = new Set<() => void>();
  const s: FakeFrameSource = {
    time: 0,
    request(f) { cb = f; cbId = ++id; return cbId; },
    cancel(i) { if (i === cbId) cb = null; },
    now: () => s.time,
    hidden: () => hidden,
    onVisible(f) { listeners.add(f); return () => listeners.delete(f); },
    step(ms = 16) { s.time += ms; const f = cb; cb = null; f?.(s.time); },
    setHidden(h) { hidden = h; if (!h) [...listeners].forEach((l) => l()); },
    pending: () => (cb ? 1 : 0),
  };
  return s;
}

/** Return true to be called again next frame (tween, moving cursor); otherwise it sleeps until woken. */
export type FrameFn = (dt: number, now: number) => boolean | void;
export interface FrameSub { wake(): void; dispose(): void }
export interface Perf { fps: number; frameMs: number; degraded: boolean }

export const MAX_DT = 100;          // ms, clamp after a hidden tab or a stall
export const SLOW_FRAME_MS = 12;
export const SLOW_FRAMES_TO_DEGRADE = 30;
const FAST_FRAMES_TO_RECOVER = 60;

export interface Scheduler {
  register(fn: FrameFn, priority?: number): FrameSub;   // lower priority number runs first
  perf(): Perf;
  onPerf(cb: (p: Perf) => void): () => void;            // fires when `degraded` flips
  running(): boolean;                                   // a frame is requested
}

export function createScheduler(source?: FrameSource): Scheduler {
  let src: FrameSource | null = source ?? null;
  const get = () => (src ??= defaultFrameSource());
  type Sub = { fn: FrameFn; priority: number; dirty: boolean };
  let subs: Sub[] = [];
  let handle: number | null = null;
  let last: number | null = null;
  let unVis: (() => void) | null = null;
  let slow = 0, fast = 0, fps = 60, frameMs = 0, degraded = false;
  const perfCbs = new Set<(p: Perf) => void>();
  const perf = (): Perf => ({ fps, frameMs, degraded });

  const anyDirty = () => subs.some((s) => s.dirty);

  function schedule() {
    if (handle !== null || !anyDirty()) return;
    const s = get();
    if (s.hidden()) {                         // sleep entirely; resume on visibilitychange
      unVis ??= s.onVisible(() => { last = s.now(); schedule(); });
      return;
    }
    handle = s.request(frame);
  }

  function frame(t: number) {
    handle = null;
    const s = get();
    if (s.hidden()) { schedule(); return; }
    const dt = last === null ? 16 : Math.min(MAX_DT, Math.max(0, t - last));
    last = t;
    const t0 = s.now();
    for (const sub of subs) {
      if (!sub.dirty) continue;
      sub.dirty = false;
      if (sub.fn(dt, t) === true) sub.dirty = true;   // a wake() inside fn also sets dirty
    }
    frameMs = s.now() - t0;
    if (dt > 0) fps = fps * 0.9 + (1000 / dt) * 0.1;
    if (frameMs > SLOW_FRAME_MS) { slow++; fast = 0; } else { fast++; slow = 0; }
    if (!degraded && slow >= SLOW_FRAMES_TO_DEGRADE) { degraded = true; perfCbs.forEach((c) => c(perf())); }
    else if (degraded && fast >= FAST_FRAMES_TO_RECOVER) { degraded = false; perfCbs.forEach((c) => c(perf())); }
    if (!anyDirty()) last = null;             // slept: next wake starts with a normal dt
    schedule();
  }

  return {
    register(fn, priority = 0) {
      const sub: Sub = { fn, priority, dirty: false };
      subs = [...subs, sub].sort((a, b) => a.priority - b.priority);
      return {
        wake() { sub.dirty = true; schedule(); },
        dispose() {
          subs = subs.filter((x) => x !== sub);
          if (!anyDirty() && handle !== null) { get().cancel(handle); handle = null; }
        },
      };
    },
    perf,
    onPerf(cb) { perfCbs.add(cb); return () => perfCbs.delete(cb); },
    running: () => handle !== null,
  };
}

/** The app-wide scheduler. Creating it touches nothing; the frame source is resolved on first use. */
export const scheduler: Scheduler = createScheduler();
