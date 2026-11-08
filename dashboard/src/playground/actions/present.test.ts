import { describe, expect, it } from 'vitest';
import { nextIndex, orderFrames, planPresentCam, prevIndex } from './present';

const f = (id: string, x: number, y: number, h = 100) => ({ id, x, y, h });

describe('present', () => {
  it('orders rows top to bottom and left to right inside a row', () => {
    const out = orderFrames([f('d', 400, 210), f('b', 300, 10), f('a', 0, 0), f('c', 0, 200)]);
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('steps stay in range', () => {
    expect(nextIndex(2, 3)).toBe(2);
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(0, 0)).toBe(0);
    expect(prevIndex(0)).toBe(0);
    expect(prevIndex(2)).toBe(1);
  });
  it('fits a frame into the view', () => {
    const cam = planPresentCam({ x: 0, y: 0, w: 1000, h: 500 }, { w: 1000, h: 500 });
    expect(cam.z).toBeGreaterThan(0.9);
    expect(cam.z).toBeLessThan(1);
  });
});
