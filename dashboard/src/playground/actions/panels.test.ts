import { describe, expect, it } from 'vitest';
import { BOARD_MIN, cleanFileName, clampWidth, panelViews } from './panels';

const base = { leftW: 240, rightW: 260, leftCollapsed: false, rightCollapsed: false };
const none = { left: false, right: false };

describe('panelViews', () => {
  it('docks both panels on a wide window', () => {
    const v = panelViews({ prefs: base, vw: 1440, narrowOpen: none });
    expect(v.left).toEqual({ open: true, overlay: false, width: 240 });
    expect(v.right).toEqual({ open: true, overlay: false, width: 260 });
  });
  it('honours collapsed prefs', () => {
    const v = panelViews({ prefs: { ...base, rightCollapsed: true }, vw: 1440, narrowOpen: none });
    expect(v.right.open).toBe(false);
  });
  it('right panel is closed below 1100 until opened, then floats', () => {
    expect(panelViews({ prefs: base, vw: 1000, narrowOpen: none }).right.open).toBe(false);
    const v = panelViews({ prefs: base, vw: 1000, narrowOpen: { left: false, right: true } });
    expect(v.right).toMatchObject({ open: true, overlay: true });
  });
  it('keeps the board usable when both docked panels are wide', () => {
    const vw = 1100;
    const v = panelViews({ prefs: { ...base, leftW: 420, rightW: 420 }, vw, narrowOpen: none });
    expect(vw - v.left.width - v.right.width).toBeGreaterThanOrEqual(BOARD_MIN);
  });
});

describe('helpers', () => {
  it('clamps widths to 200-420', () => { expect(clampWidth(50)).toBe(200); expect(clampWidth(900)).toBe(420); expect(clampWidth(300.4)).toBe(300); });
  it('cleans file names', () => {
    expect(cleanFileName('  ')).toBe('Untitled');
    expect(cleanFileName(' Plan ')).toBe('Plan');
    expect(cleanFileName('x'.repeat(80))).toHaveLength(60);
  });
});
