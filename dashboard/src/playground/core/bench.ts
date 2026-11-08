// window.board.bench(n) (CANVAS-33): creates n rects, auto-pans across them and reports frame time.
//
//   await board.bench(2000)                  -> one result
//   await board.bench([500, 2000, 5000])     -> array of results
//   board.bench(2000, { ms: 6000, keep: true, zoom: 0.55 })
//
// Frame time = gap between consecutive requestAnimationFrame timestamps while the camera moves every frame
// (this includes React work, style, layout and paint, which is what the user feels). `workMs` is the scheduler's
// own per-frame callback cost (camera, culling tick, cursors, overlays) and excludes browser layout/paint.
// Pass criterion: p95 < 16.7 ms at 2000 shapes, < 25 ms at 5000. Vsync jitter is about 0.5 ms, so 60 Hz
// screens that hold every frame report p95 of 16.7 to 17.2; read `droppedPct` (frames over 20 ms) as well.
import { camera } from './camera';
import type { BoardKit } from './commands';
import { scheduler } from './raf';
import type { Cam, Command, ShapeId } from './types';

export interface BenchOpts {
  /** Auto-pan duration. Default 4000. */
  ms?: number;
  /** Camera zoom while panning. Default 0.55 (about 2000 x 1300 world units on screen). */
  zoom?: number;
  /** Leave the shapes on the board afterwards. Default false (deleted, camera restored). */
  keep?: boolean;
  /** Counts mounted shape nodes; defaults to counting `.pg-shape` elements when a DOM exists. */
  mounted?: () => number;
}

export interface BenchResult {
  ok: true;
  n: number;
  frames: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  fps: number;
  /** Percent of frames slower than 20 ms. */
  droppedPct: number;
  /** p95 of the scheduler's per-frame callback time. */
  workP95Ms: number;
  /** Shape DOM nodes mounted at the end of the run (culling working = far below n). */
  mounted: number | null;
  createMs: number;
  pass: boolean;
  budgetMs: number;
}

const CONSOLE = 'api-console';
const BATCH = 500;

const q = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Grid of 120 x 80 rects, 160 x 120 apart, about 1.5:1 wide. Returns the extent in world units. */
export function layout(n: number): { cols: number; w: number; h: number; pos(i: number): { x: number; y: number } } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.5)));
  const rows = Math.ceil(n / cols);
  return { cols, w: cols * 160, h: rows * 120, pos: (i) => ({ x: (i % cols) * 160, y: Math.floor(i / cols) * 120 }) };
}

function nodeCount(): number | null {
  const d = (globalThis as any).document;
  return d?.querySelectorAll ? d.querySelectorAll('.pg-shape').length : null;
}

export function percentiles(samples: number[]): { median: number; p95: number; max: number } {
  const s = [...samples].sort((a, b) => a - b);
  return { median: q(s, 0.5), p95: q(s, 0.95), max: s[s.length - 1] ?? 0 };
}

/** Creates `n` rects under the bench actor in batches; returns their ids. */
export function createShapes(board: BoardKit, n: number): ShapeId[] {
  if (!board.actors.get(CONSOLE)) board.actors.spawn({ id: CONSOLE, kind: 'api', name: 'Console' });
  const L = layout(n);
  const ids: ShapeId[] = [];
  for (let from = 0; from < n; from += BATCH) {
    const commands: Command[] = [];
    for (let i = from; i < Math.min(n, from + BATCH); i++) {
      const { x, y } = L.pos(i);
      commands.push({ t: 'shape.create', kind: 'rect', props: { name: `bench-${i}`, x, y, w: 120, h: 80, fills: [{ type: 'solid', color: '#cfd8e3' }] } });
    }
    const r = board.exec({ actor: CONSOLE, opId: `bench-${Date.now()}-${from}`, commands });
    for (const x of r.results) if (x.ok && x.id) ids.push(x.id);
  }
  return ids;
}

async function runOne(board: BoardKit, n: number, o: BenchOpts): Promise<BenchResult> {
  const g = globalThis as any;
  const raf: (cb: (t: number) => void) => number = g.requestAnimationFrame?.bind(g) ?? ((cb) => setTimeout(() => cb(Date.now()), 16) as any);
  const saved: Cam = camera.getCam();
  const t0 = performance.now();
  const ids = createShapes(board, n);
  const createMs = performance.now() - t0;
  const L = layout(n);
  const z = o.zoom ?? 0.55;
  const view = camera.getViewSize();
  const span = Math.max(0, L.w - (view.w || 1200) / z);
  const duration = o.ms ?? 4000;

  const frames: number[] = [], work: number[] = [];
  await new Promise<void>((done) => {
    let start = 0, last = 0;
    const step = (t: number) => {
      if (!start) { start = last = t; }
      else { frames.push(t - last); work.push(scheduler.perf().frameMs); last = t; }
      const k = (t - start) / duration;
      if (k >= 1) return done();
      // ping-pong left to right and back so the whole board streams past the view
      const tri = 1 - Math.abs(1 - 2 * k);
      camera.setCam({ x: 40 - span * tri * z, y: 40 - (L.h / 3) * k * z, z });
      raf(step);
    };
    camera.setCam({ x: 40, y: 40, z });
    raf(step);
  });

  const mounted = (o.mounted ?? nodeCount)();
  const f = percentiles(frames);
  const budget = n <= 2000 ? 16.7 : 25;
  const res: BenchResult = {
    ok: true, n, frames: frames.length, medianMs: r2(f.median), p95Ms: r2(f.p95), maxMs: r2(f.max),
    fps: r2(1000 / (frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length))),
    droppedPct: r2((100 * frames.filter((x) => x > 20).length) / Math.max(1, frames.length)),
    workP95Ms: r2(percentiles(work).p95), mounted, createMs: r2(createMs),
    pass: f.p95 < budget + 0.6, budgetMs: budget,
  };
  if (!o.keep) {
    for (let i = 0; i < ids.length; i += BATCH) {
      board.exec({ actor: CONSOLE, opId: `bench-del-${Date.now()}-${i}`, commands: [{ t: 'shape.delete', ids: ids.slice(i, i + BATCH) }] });
    }
    camera.setCam(saved);
  }
  return res;
}

export function bench(n?: number | number[], opts: BenchOpts = {}): any {
  const board: BoardKit | undefined = (globalThis as any).board?.core;
  if (n === undefined || !board) {
    return { ok: false, note: 'usage: await board.bench(2000)  or  board.bench([500, 2000, 5000], { ms: 4000, keep: false })' };
  }
  if (Array.isArray(n)) return (async () => { const out: BenchResult[] = []; for (const x of n) out.push(await runOne(board, x, opts)); return out; })();
  return runOne(board, n, opts);
}
