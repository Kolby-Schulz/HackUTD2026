import { describe, expect, it } from 'vitest';
import { bench, createShapes, layout, percentiles } from './bench';
import { createBoard } from './commands';
import type { Command } from './types';

describe('bench helpers', () => {
  it('bench() without a board explains its usage', () => { expect((bench() as any).ok).toBe(false); });
  it('layout is a grid with unique positions', () => {
    const L = layout(100);
    const seen = new Set(Array.from({ length: 100 }, (_, i) => `${L.pos(i).x},${L.pos(i).y}`));
    expect(seen.size).toBe(100);
  });
  it('percentiles', () => { expect(percentiles([1, 2, 3, 4, 100])).toEqual({ median: 3, p95: 100, max: 100 }); });
  it('createShapes creates n rects', async () => {
    const board = createBoard({ me: 'human-you' });
    expect(createShapes(board, 120)).toHaveLength(120);
  });
});

/** Cost of one gesture frame (full re-plan from the base) on a 2000-shape board. Prints; asserts only a loose ceiling. */
describe('gesture re-plan cost at 2000 shapes', () => {
  const time = (label: string, fn: () => void, frames = 60) => {
    for (let i = 0; i < 5; i++) fn();
    const ts: number[] = [];
    for (let i = 0; i < frames; i++) { const t = performance.now(); fn(); ts.push(performance.now() - t); }
    const p = percentiles(ts);
    console.log(`[replan 2k] ${label}: median ${p.median.toFixed(2)} ms, p95 ${p.p95.toFixed(2)} ms`);
    return p;
  };
  it('measures human drag and agent drags of 1 / 20 / 100 shapes', async () => {
    const board = createBoard({ me: 'human-you' });
    board.actors.spawn({ id: 'agent-t', kind: 'agent', name: 'T' });
    const ids = createShapes(board, 2000);
    await Promise.resolve();
    const mk = (actor: string, n: number) => {
      const g = board.gesture(actor, 'bench');
      let k = 0;
      return { g, step: () => { k++; const cmds: Command[] = ids.slice(0, n).map((id) => ({ t: 'shape.update', ids: [id], patch: { x: k, y: k } })); g.update(cmds); } };
    };
    const h1 = mk('human-you', 1);
    const a1 = time('human, 1 shape', h1.step); h1.g.abort();
    const ag1 = mk('agent-t', 1);
    time('agent, 1 shape', ag1.step); ag1.g.abort();
    const ag20 = mk('agent-t', 20);
    time('agent, 20 shapes', ag20.step); ag20.g.abort();
    const ag100 = mk('agent-t', 100);
    const p100 = time('agent, 100 shapes', ag100.step); ag100.g.abort();
    expect(a1.p95).toBeLessThan(50);
    expect(p100.p95).toBeLessThan(200);
  }, 60000);
});
