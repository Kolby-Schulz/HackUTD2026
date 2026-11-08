import { describe, expect, it } from 'vitest';
import type { Rect } from '../types';
import type { Candidate } from './candidates';
import { measureBetween, snapSpacing } from './spacing';

const c = (id: string, x: number, y: number, w = 50, h = 50): Candidate => ({ id, box: { x, y, w, h } });
const box = (x: number, y: number, w = 50, h = 50): Rect => ({ x, y, w, h });

describe('snapSpacing', () => {
  it('extends a rhythm of 24 gaps to the right and marks every gap', () => {
    const row = [c('a', 0, 0), c('b', 74, 0), c('c', 148, 0)];
    const r = snapSpacing(box(225, 0), row, 5, true, ['x']);
    expect(r.dx).toBe(-3); // 222 = 198 + 24
    expect(r.gaps.map((g) => g.size)).toEqual([24, 24, 24]);
    expect(r.gaps.every((g) => g.axis === 'x')).toBe(true);
  });
  it('snaps to the midpoint between two shapes', () => {
    const r = snapSpacing(box(128, 0), [c('a', 0, 0), c('b', 250, 0)], 5, true, ['x']);
    expect(r.dx).toBe(-3); // a.right=50, b.left=250, w=50 -> x=125
    expect(r.gaps.map((g) => g.size)).toEqual([75, 75]);
  });
  it('works vertically', () => {
    const r = snapSpacing(box(0, 127), [c('a', 0, 0), c('b', 0, 250)], 5, true, ['y']);
    expect(r.dy).toBe(-2);
    expect(r.gaps.every((g) => g.axis === 'y' && g.size === 75)).toBe(true);
  });
  it('ignores shapes that do not overlap on the perpendicular axis', () => {
    expect(snapSpacing(box(103, 0), [c('a', 0, 200), c('b', 250, 200)], 5, true, ['x'])).toMatchObject({ dx: 0, gaps: [] });
  });
  it('does nothing outside the threshold or when overlapping', () => {
    expect(snapSpacing(box(110, 0), [c('a', 0, 0), c('b', 250, 0)], 5, true, ['x']).gaps).toEqual([]);
    expect(snapSpacing(box(30, 0), [c('a', 0, 0), c('b', 60, 0)], 5, true, ['x']).gaps).toEqual([]);
  });
  it('respects the allowed axes', () => {
    const r = snapSpacing(box(103, 0), [c('a', 0, 0), c('b', 250, 0)], 5, true, ['y']);
    expect(r).toMatchObject({ dx: 0, gaps: [] });
  });
  it('allows touching (gap 0) rhythms', () => {
    const r = snapSpacing(box(102, 0), [c('a', 0, 0), c('b', 50, 0)], 5, true, ['x']);
    expect(r.dx).toBe(-2);
    expect(r.gaps.map((g) => g.size)).toEqual([0, 0]);
  });
  it('caps marked gaps', () => {
    const row = Array.from({ length: 14 }, (_, i) => c(`s${i}`, i * 60, 0));
    expect(snapSpacing(box(14 * 60 + 2, 0), row, 5, true, ['x']).gaps.length).toBeLessThanOrEqual(8);
  });
});

describe('measureBetween', () => {
  it('measures the gap to a shape on the right', () => {
    const m = measureBetween(box(0, 0), box(80, 10));
    expect(m).toEqual([{ x1: 50, y1: 30, x2: 80, y2: 30, size: 30 }]);
  });
  it('gives four distances for a contained shape', () => {
    const m = measureBetween(box(20, 30, 10, 10), box(0, 0, 100, 100));
    expect(m.map((l) => l.size).sort((p, q) => p - q)).toEqual([20, 30, 60, 70]);
  });
  it('measures both axes for a diagonal neighbour', () => {
    expect(measureBetween(box(0, 0), box(80, 90)).map((l) => l.size).sort()).toEqual([30, 40]);
  });
});
