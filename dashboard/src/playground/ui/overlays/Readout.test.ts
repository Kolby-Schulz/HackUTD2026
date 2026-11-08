import { describe, expect, it } from 'vitest';
import { fmt, placePill, readoutText } from './Readout';

const box = { x: 10, y: 20, w: 100, h: 50 };
const start = { box, x: 10, y: 20, rot: 0, ids: 'a', draw: false };
const now = (o: object) => ({ box, x: 10, y: 20, rot: 0, ids: 'a', ...o });

describe('readout', () => {
  it('rounds and switches to a decimal past 400%', () => {
    expect(fmt(10.6, 1)).toBe('11');
    expect(fmt(10.66, 5)).toBe('10.7');
    expect(fmt(-0.2, 1)).toBe('0');
  });
  it('shows size on resize and draw', () => {
    expect(readoutText(start, now({ box: { ...box, w: 120.4 } }), 1)).toBe('120 × 50');
    expect(readoutText({ ...start, draw: true }, now({ ids: 'new' }), 1)).toBe('100 × 50');
  });
  it('shows X/Y on move, only the changed axis', () => {
    expect(readoutText(start, now({ x: 30, y: 25 }), 1)).toBe('X: 30  Y: 25');
    expect(readoutText(start, now({ x: 30 }), 1)).toBe('X: 30');
  });
  it('shows rotation, and nothing for click, marquee or idle', () => {
    expect(readoutText(start, now({ rot: -26 }), 1)).toBe('334°');
    expect(readoutText(start, now({}), 1)).toBeNull();
    expect(readoutText(start, now({ ids: 'a,b' }), 1)).toBeNull();
  });
  it('flips above at the bottom and clamps sideways', () => {
    expect(placePill({ x: 0, y: 0, w: 100, h: 100 }, 60, 16, 800, 600).top).toBe(108);
    expect(placePill({ x: 0, y: 500, w: 100, h: 95 }, 60, 16, 800, 600).top).toBe(476);
    expect(placePill({ x: -200, y: 0, w: 100, h: 10 }, 60, 16, 800, 600).cx).toBe(32);
  });
});
