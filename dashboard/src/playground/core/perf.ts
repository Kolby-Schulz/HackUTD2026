// Performance budget (SHELL-19) and the numbers behind the debug HUD (CANVAS-44, SHELL-20). Pure TS, no DOM/React.
//
// BUDGET (ms, not fps, so 120 Hz screens work too):
//   pan/zoom with 50 agent cursors + 3,000 shapes: p95 frame <= 16.7, p99 <= 25
//   shape drag with 500 selected: >= 55 fps
//   keydown -> visible change <= 50; palette open <= 100; export of 500 shapes <= 1000
//   playground chunk <= 300 KB gzip; memory growth <= 50 MB over 10 minutes
// HOW TO MEASURE: open `#/playground?debug` (or run action view.toggleDebug / window.board.debug(true)), run
//   window.board.stress(...), read the HUD. `window.board.perf()` returns the same numbers as an object.
// HUD COST RULES: the sampler is one scheduler callback that only pushes a number into a ring buffer; percentiles are
//   computed at 4 Hz by the HUD timer, never per frame; the HUD writes text nodes directly, no React render per frame.
import type { BoardEvent } from './types';
import { flag } from './flags';
import { scheduler as defaultScheduler, type Scheduler } from './raf';

export const BUDGET = { p95Ms: 16.7, p99Ms: 25, dragFps: 55, keyLatencyMs: 50 } as const;
/** A frame longer than this counts as a long frame (same threshold as the browser's long task). */
export const LONG_FRAME_MS = 50;

/** Value at quantile q (0..1) of an ascending-sorted array, nearest-rank. 0 for an empty array. */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

export interface FrameStats { fps: number; avgMs: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number; longFrames: number; frames: number }

/** Ring buffer of the last `size` frame times (ms). */
export function createFrameStats(size = 240) {
  const buf: number[] = [];
  let head = 0, long = 0;
  return {
    push(ms: number) {
      if (!(ms >= 0) || !Number.isFinite(ms)) return;
      if (ms > LONG_FRAME_MS) long++;
      if (buf.length < size) buf.push(ms); else { buf[head] = ms; head = (head + 1) % size; }
    },
    reset() { buf.length = 0; head = 0; long = 0; },
    snapshot(): FrameStats {
      if (!buf.length) return { fps: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, longFrames: long, frames: 0 };
      const sorted = [...buf].sort((a, b) => a - b);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      return { fps: avg > 0 ? 1000 / avg : 0, avgMs: avg, p50Ms: quantile(sorted, 0.5), p95Ms: quantile(sorted, 0.95), p99Ms: quantile(sorted, 0.99), maxMs: sorted[sorted.length - 1], longFrames: long, frames: buf.length };
    },
  };
}

/** Counts board events per actor, plus a rolling ops/sec. Shape events count once per shape id touched. */
export function createOpCounter(windowMs = 1000) {
  const perActor = new Map<string, number>();
  let recent: { at: number; n: number }[] = [];
  let total = 0;
  return {
    record(e: Pick<BoardEvent, 't' | 'actor' | 'at'> & { ids?: string[] }) {
      if (e.t !== 'shape.created' && e.t !== 'shape.updated' && e.t !== 'shape.deleted') return;
      const n = Math.max(1, e.ids?.length ?? 1);
      perActor.set(e.actor, (perActor.get(e.actor) ?? 0) + n);
      total += n;
      recent.push({ at: e.at, n });
    },
    opsPerSec(now: number): number {
      recent = recent.filter((r) => now - r.at <= windowMs);
      return recent.reduce((a, r) => a + r.n, 0) * (1000 / windowMs);
    },
    perActor: (): Record<string, number> => Object.fromEntries(perActor),
    total: () => total,
    reset() { perActor.clear(); recent = []; total = 0; },
  };
}

/** Live sampler: frame stats from the scheduler plus op counts from an event bus. */
export interface PerfSampler { stats: ReturnType<typeof createFrameStats>; ops: ReturnType<typeof createOpCounter>; stop(): void }
export function startSampler(
  events: { subscribe(f: Record<string, never>, cb: (e: BoardEvent) => void): () => void },
  sched: Scheduler = defaultScheduler,
): PerfSampler {
  const stats = createFrameStats();
  const ops = createOpCounter();
  // Returning true keeps the scheduler ticking while the HUD is up, so fps reflects the real display rate.
  const sub = sched.register((dt) => { stats.push(dt); return true; }, 1000);
  sub.wake();
  const off = events.subscribe({}, (e) => ops.record(e as never));
  return { stats, ops, stop() { off(); sub.dispose(); } };
}

// ---- debug toggle: `?debug` / `?hud=1` in the URL or hash, the perfHud flag, or a runtime override ----
let override: boolean | null = null;
const listeners = new Set<() => void>();
export function urlWantsDebug(search: string): boolean {
  const q = search.includes('?') ? search.slice(search.indexOf('?') + 1) : search.replace(/^[#?]/, '');
  const p = new URLSearchParams(q);
  return p.has('debug') ? p.get('debug') !== '0' && p.get('debug') !== 'false' : p.get('hud') === '1';
}
export function debugOn(): boolean {
  if (override !== null) return override;
  const l = (globalThis as { location?: { search: string; hash: string } }).location;
  return (l ? urlWantsDebug(`${l.search}${l.hash}`) || urlWantsDebug(l.hash) || urlWantsDebug(l.search) : false) || flag('perfHud');
}
export function setDebug(on: boolean) { override = on; listeners.forEach((f) => f()); }
export function toggleDebug() { setDebug(!debugOn()); }
export function subscribeDebug(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
/** Test helper. */
export function resetDebug() { override = null; }

let live: PerfSampler | null = null;
export function setLiveSampler(s: PerfSampler | null) { live = s; }

/** `window.board.perf()` : the live numbers while the HUD runs, else a note on how to start it. */
export function perf(..._args: unknown[]): unknown {
  if (!live) return { ok: false, note: 'Turn the HUD on first: ?debug, action view.toggleDebug, or board.debug(true)' };
  return { ok: true, ...live.stats.snapshot(), opsPerSec: live.ops.opsPerSec(Date.now()), opsByActor: live.ops.perActor(), budget: BUDGET };
}
