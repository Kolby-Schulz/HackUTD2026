import { describe, expect, it } from 'vitest';
import { MAX_PER_EDGE, planChips } from './OffscreenChips';

const view = { w: 1000, h: 600 };
describe('planChips', () => {
  it('skips on-screen items and picks the right edge', () => {
    const c = planChips([{ id: 'a', x: 500, y: 300 }, { id: 'b', x: 1500, y: 300 }, { id: 'c', x: -50, y: 100 }, { id: 'd', x: 400, y: -900 }], view);
    expect(c.map((k) => [k.ids[0], k.edge]).sort()).toEqual([['b', 'right'], ['c', 'left'], ['d', 'top']]);
  });
  it('points toward the item and clamps inside the inset', () => {
    const [c] = planChips([{ id: 'b', x: 1500, y: 300 }], view);
    expect(c.angle).toBeCloseTo(0);
    expect(c.x).toBe(1000 - 25);
    const [t] = planChips([{ id: 'x', x: -9999, y: 300 }], view);
    expect(t.y).toBe(300);
    expect(t.x).toBe(25);
  });
  it('merges nearby chips into one group', () => {
    const c = planChips([{ id: 'a', x: 1100, y: 200 }, { id: 'b', x: 1100, y: 210 }, { id: 'c', x: 1100, y: 400 }], view);
    expect(c.map((k) => k.ids.length).sort()).toEqual([1, 2]);
  });
  it('collapses 50 cursors to at most 8 chips per edge without losing any', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, x: 1200, y: i * 12 }));
    const c = planChips(items, view);
    expect(c.length).toBeLessThanOrEqual(MAX_PER_EDGE);
    expect(c.flatMap((k) => k.ids).length).toBe(50);
  });
});
