import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCameraStore } from '../../core/camera';
import { createClassifier, normalizeDelta, zoomFactor, attachWheel, type WheelLike } from './wheel';
import { dotSpacing, gridLevels, layerOffset } from './DotGrid';

const ev = (o: Partial<WheelLike>): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...o });

describe('wheel classification', () => {
  it('notched deltas are a mouse, small/fractional/sideways are a trackpad', () => {
    const c = createClassifier();
    expect(c(ev({ deltaY: 100 }), 0)).toBe('mouse');
    expect(c(ev({ deltaY: 120 }), 1000)).toBe('mouse');
    expect(c(ev({ deltaY: 3, deltaMode: 1 }), 2000)).toBe('mouse');
    expect(c(ev({ deltaY: 7.5 }), 3000)).toBe('trackpad');
    expect(c(ev({ deltaX: 4, deltaY: 100 }), 4000)).toBe('trackpad');
  });
  it('stays a trackpad through inertia, but a clean notch after a pause is a mouse', () => {
    const c = createClassifier();
    c(ev({ deltaY: 2 }), 0);
    expect(c(ev({ deltaY: 61 }), 50)).toBe('trackpad');
    expect(c(ev({ deltaY: 100 }), 100)).toBe('mouse');
  });
  it('normalises lines and pages', () => {
    expect(normalizeDelta(ev({ deltaY: 3, deltaMode: 1 }), 800).dy).toBe(48);
    expect(normalizeDelta(ev({ deltaY: 1, deltaMode: 2 }), 800).dy).toBe(800);
  });
  it('mouse notch zooms ~1.15, pinch is continuous and clamped', () => {
    expect(zoomFactor(ev({ deltaY: -100 }), 'mouse', 800)).toBeCloseTo(1.15);
    expect(zoomFactor(ev({ deltaY: -1, deltaMode: 1 }), 'mouse', 800)).toBeGreaterThan(1);
    expect(zoomFactor(ev({ deltaY: -2 }), 'trackpad', 800)).toBeCloseTo(Math.exp(0.02));
    expect(zoomFactor(ev({ deltaY: -5000 }), 'trackpad', 800)).toBeCloseTo(Math.exp(1));
  });
});

describe('attachWheel', () => {
  beforeEach(() => { vi.stubGlobal('document', { documentElement: { style: {} }, body: { style: {} } }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  function setup() {
    const cam = createCameraStore(undefined, { x: 0, y: 0, z: 1 });
    cam.setViewRect({ left: 0, top: 0, width: 1000, height: 800 });
    const el = Object.assign(new EventTarget(), { clientHeight: 800, getBoundingClientRect: () => ({ left: 0, top: 0 }) }) as unknown as HTMLElement;
    const off = attachWheel(el, cam, { mouseZooms: () => false });
    const fire = (o: Partial<WheelLike & { clientX: number; clientY: number }>) => {
      const e = Object.assign(new Event('wheel', { cancelable: true }), ev({}), { clientX: 0, clientY: 0 }, o);
      el.dispatchEvent(e);
      return e;
    };
    return { cam, off, fire };
  }
  it('trackpad scroll pans, shift+wheel pans sideways, ctrl pinch zooms about the pointer', () => {
    const { cam, off, fire } = setup();
    expect(fire({ deltaX: 3, deltaY: 5.5 }).defaultPrevented).toBe(true);
    expect(cam.getCam()).toMatchObject({ x: -3, y: -5.5, z: 1 });
    fire({ deltaY: 100, shiftKey: true });
    expect(cam.getCam().x).toBe(-103);
    const before = cam.getCam();
    const world = { x: (200 - before.x) / before.z, y: (300 - before.y) / before.z };
    fire({ deltaY: -10.5, ctrlKey: true, clientX: 200, clientY: 300 });
    const c = cam.getCam();
    expect(c.z).toBeGreaterThan(1);
    expect(world.x * c.z + c.x).toBeCloseTo(200);
    expect(world.y * c.z + c.y).toBeCloseTo(300);
    off();
  });
  it('restores overscroll behaviour on cleanup', () => {
    const { off } = setup();
    expect(document.documentElement.style.overscrollBehavior).toBe('none');
    off();
    expect(document.documentElement.style.overscrollBehavior).not.toBe('none');
  });
});

describe('dot grid levels', () => {
  it('spacing stays in 14..28 from 2% to 25600%', () => {
    for (let z = 0.02; z <= 256; z *= 1.07) { const d = dotSpacing(z); expect(d).toBeGreaterThanOrEqual(14); expect(d).toBeLessThan(28); }
  });
  it('is continuous across every rollover (no density pop)', () => {
    const at = (z: number) => { const g = gridLevels(z); return [[g.fine, g.fineAlpha], [g.coarse, g.coarseAlpha]]; };
    const lo = at(0.5833333 - 1e-6), hi = at(0.5833333 + 1e-6);   // 24 * z = 14
    const sum = (l: number[][], s: number) => l.filter(([sp]) => Math.abs(sp - s) < 0.01).reduce((a, [, al]) => a + al, 0);
    expect(sum(lo, 28)).toBeCloseTo(sum(hi, 28), 3);
    expect(sum(lo, 14)).toBeCloseTo(sum(hi, 14), 3);
    expect(sum(lo, 56)).toBeCloseTo(sum(hi, 56), 3);
  });
  it('fades out at the extremes, full in the middle', () => {
    expect(gridLevels(1).fineAlpha + gridLevels(1).coarseAlpha).toBeGreaterThan(0.9);
    expect(gridLevels(0.02).fineAlpha).toBe(0);
    expect(gridLevels(16).coarseAlpha).toBe(0);
    expect(gridLevels(256).fineAlpha).toBe(0);
  });
  it('puts a dot on every world multiple of the gap', () => {
    const cam = { x: 37.3, y: -91.7, z: 1 };
    const s = gridLevels(cam.z).fine;                 // 24
    const dotX = layerOffset(cam.x, s) + s / 2;        // a dot centre in screen px
    const world = (dotX - cam.x) / cam.z;
    expect(Math.abs(world / 24 - Math.round(world / 24))).toBeLessThan(0.05);
  });
});
