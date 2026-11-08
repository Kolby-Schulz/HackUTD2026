import { describe, expect, it, vi } from 'vitest';
import { dotSpacing } from './DotGrid';
import { createUiStore, w2v } from './state';
import { isVisible } from './culling';

describe('board helpers', () => {
  it('dot grid spacing follows zoom and thins out below 14 px', () => {
    expect(dotSpacing(1)).toBe(24);
    expect(dotSpacing(0.55)).toBeCloseTo(26.4);
    expect(dotSpacing(0.25)).toBe(24);
    expect(dotSpacing(0.1)).toBeGreaterThanOrEqual(14);
  });
  it('w2v maps world to view px', () => {
    expect(w2v({ x: 10, y: 20, z: 2 }, { x: 5, y: 5 })).toEqual({ x: 20, y: 30 });
  });
  it('ui store notifies only on change and relays escape', () => {
    const ui = createUiStore();
    const l = vi.fn();
    ui.subscribe(l);
    ui.set({ tool: 'select' });
    expect(l).not.toHaveBeenCalled();
    ui.set({ tool: 'rect' });
    expect(l).toHaveBeenCalledTimes(1);
    const esc = vi.fn();
    ui.onEscape(esc);
    ui.emitEscape();
    expect(esc).toHaveBeenCalled();
  });
  it('culling stub shows everything', () => { expect(isVisible('x')).toBe(true); });
});
