import { describe, expect, it } from 'vitest';
import { camCentered, clampPt, containsRect, fitBounds, fromMap, shouldHide, toMap, unionRect } from './Minimap';

describe('Minimap math', () => {
  it('fits bounds inside the map and round-trips', () => {
    const t = fitBounds({ x: -500, y: -100, w: 2000, h: 600 });
    const a = toMap(t, { x: -500, y: -100 }), b = toMap(t, { x: 1500, y: 500 });
    expect(a.x).toBeGreaterThanOrEqual(0); expect(b.x).toBeLessThanOrEqual(180); expect(b.y).toBeLessThanOrEqual(120);
    const p = fromMap(t, toMap(t, { x: 123, y: 45 }));
    expect(p.x).toBeCloseTo(123); expect(p.y).toBeCloseTo(45);
  });
  it('unions and contains', () => {
    const u = unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 });
    expect(u).toEqual({ x: 0, y: -5, w: 25, h: 15 });
    expect(containsRect(u, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
  });
  it('hides when empty or content fits the view', () => {
    const vp = { x: 0, y: 0, w: 1000, h: 800 };
    expect(shouldHide(null, vp)).toBe(true);
    expect(shouldHide({ x: 10, y: 10, w: 100, h: 100 }, vp)).toBe(true);
    expect(shouldHide({ x: 10, y: 10, w: 5000, h: 100 }, vp)).toBe(false);
  });
  it('clamps off-map points to the edge', () => {
    expect(clampPt({ x: 500, y: 50 })).toEqual({ p: { x: 177, y: 50 }, off: true });
    expect(clampPt({ x: 50, y: 50 }).off).toBe(false);
  });
  it('centres the camera on a world point', () => {
    const c = camCentered({ x: 100, y: 50 }, 2, { w: 800, h: 600 });
    expect(c).toEqual({ z: 2, x: 200, y: 200 });
  });
});
