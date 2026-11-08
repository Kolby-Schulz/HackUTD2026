import { describe, expect, it } from 'vitest';
import { createSmoother } from './cursors';

describe('smoother', () => {
  it('moves monotonically along a 20 Hz feed with jitter', () => {
    const s = createSmoother();
    let last = -Infinity;
    const arrivals = [0, 55, 98, 160, 195, 260, 300, 355];
    let i = 0;
    for (let now = 0; now <= 500; now += 16) {
      while (i < arrivals.length && arrivals[i] <= now) { s.push(arrivals[i] * 2, 0, arrivals[i]); i++; }
      const p = s.at(now);
      if (!p) continue;
      expect(p.x).toBeGreaterThanOrEqual(last - 1e-6);
      last = p.x;
    }
  });
  it('snaps on teleport with a fade', () => {
    const s = createSmoother();
    s.push(0, 0, 0); s.push(10, 0, 50); s.at(100);
    s.push(5000, 0, 120);
    const p = s.at(130)!;
    expect(p.x).toBeGreaterThan(4000);
    expect(p.fade).toBeLessThan(1);
    expect(s.at(400)!.fade).toBe(1);
  });
  it('glides to sparse samples instead of jumping', () => {
    const s = createSmoother();
    s.push(0, 0, 0); s.at(0);
    s.push(100, 0, 1000);
    const p = s.at(1016)!;
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(100);
    expect(s.at(1500)!.x).toBeGreaterThan(99);
  });
  it('returns null before any sample', () => { expect(createSmoother().at(0)).toBeNull(); });
});

import { cursorScale, layoutTags, MAX_TAGS, DOT_MODE_AT } from './cursors';
import type { TagItem } from './cursors';

const item = (n: number, x: number, y: number, extra: Partial<TagItem> = {}): TagItem => ({ id: 'a' + n, x, y, name: 'Agent' + n, kind: 'agent', hasStatus: true, ...extra });
const view = { w: 1400, h: 900 };

describe('cursorScale', () => {
  it('is 1 at normal zoom and shrinks to 0.7', () => {
    expect(cursorScale(1)).toBe(1);
    expect(cursorScale(0.05)).toBeCloseTo(0.73);
    expect(cursorScale(0.0001)).toBeCloseTo(0.7, 1);
  });
});

describe('layoutTags', () => {
  it('10 cursors on one spot: one tag, the rest dots with a +n count', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(i, 500, 400));
    const plan = layoutTags(items, { zoom: 1, view });
    const full = [...plan.values()].filter((p) => p.mode !== 'dot');
    expect(full).toHaveLength(1);
    expect(full[0].hidden).toBe(9);
  });
  it('boosted (hovered) cursor wins the spot', () => {
    const items = Array.from({ length: 5 }, (_, i) => item(i, 500, 400, i === 3 ? { boosted: true } : {}));
    expect(layoutTags(items, { zoom: 1, view }).get('a3')!.mode).not.toBe('dot');
  });
  it('caps at 12 full tags when spread out', () => {
    const items = Array.from({ length: 30 }, (_, i) => item(i, (i % 6) * 220, Math.floor(i / 6) * 60));
    const plan = layoutTags(items, { zoom: 1, view });
    expect([...plan.values()].filter((p) => p.mode !== 'dot').length).toBe(MAX_TAGS);
  });
  it('drops status text when crowded or zoomed out', () => {
    const few = [item(0, 100, 100), item(1, 600, 100)];
    expect(layoutTags(few, { zoom: 1, view }).get('a0')!.mode).toBe('full');
    expect(layoutTags(few, { zoom: 0.3, view }).get('a0')!.mode).toBe('short');
    const many = Array.from({ length: 8 }, (_, i) => item(i, i * 170, 100));
    expect(layoutTags(many, { zoom: 1, view }).get('a0')!.mode).toBe('short');
  });
  it('dots only beyond the dot-mode threshold', () => {
    const items = Array.from({ length: DOT_MODE_AT + 1 }, (_, i) => item(i, (i * 7) % 1300, (i * 13) % 800));
    expect([...layoutTags(items, { zoom: 1, view }).values()].every((p) => p.mode === 'dot')).toBe(true);
  });
  it('is stable with previous-frame plan (no flicker between equals)', () => {
    const items = [item(0, 500, 400), item(1, 505, 402)];
    const p1 = layoutTags(items, { zoom: 1, view });
    const winner = items.find((i) => p1.get(i.id)!.mode !== 'dot')!.id;
    const p2 = layoutTags([...items].reverse(), { zoom: 1, view, prev: p1 });
    expect(p2.get(winner)!.mode).not.toBe('dot');
  });
});
