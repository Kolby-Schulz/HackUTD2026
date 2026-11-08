import { describe, expect, it } from 'vitest';
import { IDENTITY, applyMat, boxMatrix, clampCoord, containsPoint, containsRect, intersection, intersects, invert, multiply, norm, normAngle, rectFromPoints, rotatePoint, rotatedBounds, union } from './geom';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('rects', () => {
  it('norm flips negative sizes', () => {
    expect(norm({ x: 10, y: 10, w: -4, h: -6 })).toEqual({ x: 6, y: 4, w: 4, h: 6 });
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 1, y: 9 })).toEqual({ x: 1, y: 5, w: 4, h: 4 });
  });
  it('union, intersects, contains', () => {
    expect(union([])).toBeNull();
    expect(union([{ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 5, w: 1, h: 1 }])).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    expect(intersects({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(intersection({ x: 0, y: 0, w: 3, h: 3 }, { x: 2, y: 2, w: 3, h: 3 })).toEqual({ x: 2, y: 2, w: 1, h: 1 });
    expect(containsPoint({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 1 })).toBe(true);
    expect(containsRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 1, y: 1, w: 9, h: 9 })).toBe(true);
  });
  it('clamps and normalizes angles', () => {
    expect(clampCoord(1e9)).toBe(1e7);
    expect(normAngle(190)).toBe(-170);
    expect(normAngle(-180)).toBe(180);
    expect(normAngle(720)).toBe(0);
  });
});

describe('rotation and matrices', () => {
  it('rotatePoint is clockwise on screen', () => {
    const p = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
    close(p.x, 0); close(p.y, 1);
  });
  it('rotatedBounds of a 45 degree square', () => {
    const b = rotatedBounds({ x: 0, y: 0, w: 10, h: 10 }, 45);
    close(b.w, Math.SQRT2 * 10); close(b.h, Math.SQRT2 * 10);
  });
  it('box matrix keeps the center fixed and inverts', () => {
    const m = boxMatrix({ x: 10, y: 20, w: 40, h: 20 }, 30);
    const c = applyMat(m, { x: 20, y: 10 });
    close(c.x, 30); close(c.y, 30);
    const back = applyMat(invert(m)!, applyMat(m, { x: 7, y: 3 }));
    close(back.x, 7); close(back.y, 3);
    expect(multiply(IDENTITY, m)).toEqual(m);
    expect(invert([0, 0, 0, 0, 0, 0])).toBeNull();
  });
});
