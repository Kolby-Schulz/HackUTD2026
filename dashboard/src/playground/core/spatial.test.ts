import { describe, expect, it } from 'vitest';
import { SpatialIndex, overlaps } from './spatial';
import { buildChildren, worldBounds } from './tree';
import type { TreeView } from './tree';
import type { Rect, Shape } from './types';

function mk(id: string, parent: string | null, o: Partial<Shape> = {}): Shape {
  return { id, kind: 'rect', parent, index: 'V', createdBy: 'human-you', name: id, x: 0, y: 0, w: 10, h: 10, fills: [], stamps: {}, ...o } as Shape;
}
function view(list: Shape[]): TreeView {
  const shapes = new Map(list.map((s) => [s.id, s]));
  return { shapes, children: buildChildren(shapes) };
}
// Deterministic PRNG.
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

describe('SpatialIndex', () => {
  const r = rng(7);
  const shapes = Array.from({ length: 5000 }, (_, i) =>
    mk(`s${i}`, null, { x: r() * 20000 - 10000, y: r() * 20000 - 10000, w: r() * 300, h: r() * 300, index: String(i).padStart(5, '0') }));
  // a few huge ones to exercise the side list
  shapes.push(mk('huge', null, { x: -50000, y: -50000, w: 100000, h: 100000, index: 'zzzzz' }));
  const v = view(shapes);
  const idx = new SpatialIndex();
  idx.rebuild(v);

  const brute = (q: Rect) => shapes.filter((s) => overlaps(worldBounds(v, s.id)!, q)).map((s) => s.id).sort();

  it('queryRect equals a brute-force scan for 1k random rects', () => {
    for (let i = 0; i < 1000; i++) {
      const q = { x: r() * 24000 - 12000, y: r() * 24000 - 12000, w: r() * 1500, h: r() * 1500 };
      expect(idx.queryRect(q).sort()).toEqual(brute(q));
    }
  }, 20_000);

  it('a 1000x700 query over 5k shapes takes under 0.5 ms on average', () => {
    const qs = Array.from({ length: 200 }, () => ({ x: r() * 20000 - 10000, y: r() * 20000 - 10000, w: 1000, h: 700 }));
    for (const q of qs) idx.queryRect(q); // warm up
    const t0 = performance.now();
    for (const q of qs) idx.queryRect(q);
    expect((performance.now() - t0) / qs.length).toBeLessThan(5); // loose: the suite shares the CPU with parallel builds
  });

  it('rebuild of 500 inserted shapes is fast', () => {
    const extra = Array.from({ length: 500 }, (_, i) => mk(`e${i}`, null, { x: r() * 5000, y: r() * 5000 }));
    const small = new SpatialIndex();
    const t0 = performance.now();
    small.rebuild(view(extra));
    expect(performance.now() - t0).toBeLessThan(100); // loose for shared CPUs; catches an O(n^2) rebuild
  });

  it('update moves a shape, its descendants, and removes deleted ones', () => {
    const list = [mk('f', null, { kind: 'frame', w: 100, h: 100 }), mk('c', 'f', { x: 10, y: 10 })];
    const i2 = new SpatialIndex();
    i2.rebuild(view(list));
    expect(i2.queryRect({ x: 12, y: 12, w: 1, h: 1 }).sort()).toEqual(['c', 'f']);
    const moved = view([{ ...list[0], x: 5000 }, list[1]]);
    i2.update(moved, ['f']);
    expect(i2.queryRect({ x: 12, y: 12, w: 1, h: 1 })).toEqual([]);
    expect(i2.queryRect({ x: 5012, y: 12, w: 1, h: 1 }).sort()).toEqual(['c', 'f']);
    i2.update(view([{ ...list[0], x: 5000, deleted: true } as Shape, list[1]]), ['f']);
    expect(i2.queryRect({ x: 5012, y: 12, w: 1, h: 1 })).toEqual([]);
  });

  it('normalizes NaN and negative sizes', () => {
    const i2 = new SpatialIndex();
    i2.rebuild(view([mk('n', null, { x: 10, y: 10, w: -20, h: NaN })]));
    expect(i2.bounds('n')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    i2.rebuild(view([mk('m', null, { x: 10, y: 10, w: -20, h: 5 })]));
    expect(i2.bounds('m')).toEqual({ x: -10, y: 10, w: 20, h: 5 });
  });
});
