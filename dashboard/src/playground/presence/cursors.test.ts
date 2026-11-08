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
