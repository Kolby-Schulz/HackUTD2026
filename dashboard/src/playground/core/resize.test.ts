import { describe, expect, it } from 'vitest';
import { HANDLES, resizeBox, resizeBoxFlip, scaleInto } from './resize';
import type { Rect } from './types';

const R: Rect = { x: 100, y: 100, w: 200, h: 100 };

describe('resizeBox', () => {
  it('moves the dragged side and keeps the opposite one for every corner', () => {
    expect(resizeBox(R, 'se', 350, 250)).toEqual({ x: 100, y: 100, w: 250, h: 150 });
    expect(resizeBox(R, 'nw', 50, 60)).toEqual({ x: 50, y: 60, w: 250, h: 140 });
    expect(resizeBox(R, 'ne', 320, 80)).toEqual({ x: 100, y: 80, w: 220, h: 120 });
    expect(resizeBox(R, 'sw', 80, 230)).toEqual({ x: 80, y: 100, w: 220, h: 130 });
  });
  it('edge handles change one dimension only', () => {
    expect(resizeBox(R, 'e', 400, 999)).toEqual({ x: 100, y: 100, w: 300, h: 100 });
    expect(resizeBox(R, 'w', 50, 999)).toEqual({ x: 50, y: 100, w: 250, h: 100 });
    expect(resizeBox(R, 's', -9, 260)).toEqual({ x: 100, y: 100, w: 200, h: 160 });
    expect(resizeBox(R, 'n', -9, 40)).toEqual({ x: 100, y: 40, w: 200, h: 160 });
  });
  it('Shift keeps the original ratio on corners, dominant axis wins', () => {
    expect(resizeBox(R, 'se', 500, 150, { shift: true })).toEqual({ x: 100, y: 100, w: 400, h: 200 });
    expect(resizeBox(R, 'se', 300, 400, { shift: true })).toEqual({ x: 100, y: 100, w: 600, h: 300 });
    expect(resizeBox(R, 'nw', 0, 0, { shift: true })).toEqual({ x: -100, y: 0, w: 400, h: 200 });
  });
  it('Shift does nothing on edges', () => {
    expect(resizeBox(R, 'e', 400, 0, { shift: true })).toEqual({ x: 100, y: 100, w: 300, h: 100 });
  });
  it('lockRatio makes edges proportional about the centre', () => {
    expect(resizeBox(R, 'e', 400, 0, { lock: true })).toEqual({ x: 100, y: 75, w: 300, h: 150 });
  });
  it('Alt resizes from the centre', () => {
    const c = { x: -50, y: -50, w: 100, h: 100 };
    expect(resizeBox(c, 'se', 70, 70, { alt: true })).toEqual({ x: -70, y: -70, w: 140, h: 140 });
    expect(resizeBox(R, 'e', 400, 0, { alt: true })).toEqual({ x: 0, y: 100, w: 400, h: 100 });
  });
  it('Alt+Shift is centred and proportional', () => {
    expect(resizeBox(R, 'se', 400, 200, { alt: true, shift: true })).toEqual({ x: 0, y: 50, w: 400, h: 200 });
  });
  it('flips past the anchor', () => {
    const r = resizeBoxFlip(R, 'se', 40, 250);
    expect(r.box).toEqual({ x: 40, y: 100, w: 60, h: 150 });
    expect(r.flipX).toBe(true);
    expect(r.flipY).toBe(false);
    expect(resizeBox(R, 'w', 350, 0)).toEqual({ x: 300, y: 100, w: 50, h: 100 });
  });
  it('never goes below the minimum size', () => {
    expect(resizeBox(R, 'se', 100, 100)).toEqual({ x: 100, y: 100, w: 1, h: 1 });
    expect(resizeBox(R, 'e', 100.2, 0, { min: 5 }).w).toBe(5);
  });
  it('is free for zero-height boxes with Shift', () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 0 }, 'se', 200, 50, { shift: true })).toEqual({ x: 0, y: 0, w: 200, h: 50 });
  });
  it('covers all eight handles', () => {
    for (const h of HANDLES) expect(resizeBox(R, h, 200, 150).w).toBeGreaterThanOrEqual(1);
  });
});

describe('scaleInto', () => {
  it('scales members about the anchor', () => {
    const u = { x: 0, y: 0, w: 100, h: 100 };
    const res = resizeBoxFlip(u, 'se', 200, 200);
    expect(scaleInto(u, res, { x: 50, y: 50, w: 50, h: 50 })).toEqual({ x: 100, y: 100, w: 100, h: 100 });
  });
  it('mirrors members when flipped', () => {
    const u = { x: 0, y: 0, w: 100, h: 100 };
    const res = resizeBoxFlip(u, 'se', -100, 100);
    expect(res.flipX).toBe(true);
    expect(scaleInto(u, res, { x: 0, y: 0, w: 20, h: 100 })).toEqual({ x: -20, y: 0, w: 20, h: 100 });
  });
});
