import { describe, expect, it } from 'vitest';
import { camToView, decodeView, encodeView, hasView, loadSavedView, saveView, viewToCam, VIEW_KEY } from './url';
import type { StorageLike } from './prefs';

const mem = (): StorageLike & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
};

describe('url', () => {
  it('round-trips view and selection', () => {
    const h = encodeView({ x: 120, y: -45, z: 1.5 }, ['s1abc', 'b-2']);
    expect(h.startsWith('#/playground?')).toBe(true);
    expect(/^#\/?playground/.test(h)).toBe(true);
    expect(decodeView(h)).toEqual({ view: { x: 120, y: -45, z: 1.5 }, sel: ['s1abc', 'b-2'] });
  });
  it('rounds x,y and z', () => {
    expect(decodeView(encodeView({ x: 10.6, y: 3.2, z: 0.123456 })).view).toEqual({ x: 11, y: 3, z: 0.123 });
  });
  it('malformed hashes give defaults', () => {
    for (const h of ['', '#/playground', '#/playground?', '#/playground?x=a&y=b&z=c', '#/playground?x=1&y=2', '#/playground?x=1&y=2&z=0',
      '#/playground?x=Infinity&y=1&z=1', '%%%?x', '#/playground?z=--', '#/playground?x=&y=&z=']) {
      expect(decodeView(h).view).toBeNull();
    }
    expect(decodeView(undefined as unknown as string)).toEqual({ view: null, sel: [] });
  });
  it('validates ids, dedupes, caps at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => 'id' + i);
    expect(decodeView('#/playground?sel=a,<script>,b%20c,a,ok_1,' + 'x'.repeat(100)).sel).toEqual(['a', 'ok_1']);
    expect(decodeView('#/playground?sel=' + many.join(',')).sel).toHaveLength(20);
    expect(encodeView({ x: 0, y: 0, z: 1 }, ['bad id', 'good'])).toBe('#/playground?x=0&y=0&z=1&sel=good');
  });
  it('clamps huge coordinates and zoom', () => {
    const v = decodeView('#/playground?x=9e99&y=-9e99&z=9999').view!;
    expect(v).toEqual({ x: 1e6, y: -1e6, z: 256 });
  });
  it('accepts v=cx,cy,z and a view-only hash', () => {
    expect(decodeView('#/playground?v=5,6,2').view).toEqual({ x: 5, y: 6, z: 2 });
    expect(hasView('#/playground?sel=a')).toBe(false);
  });
  it('camera conversion round-trips and is window-size independent', () => {
    const cam = { x: -200, y: 80, z: 2 };
    const v = camToView(cam, { w: 1000, h: 600 });
    expect(viewToCam(v, { w: 1000, h: 600 })).toEqual(cam);
    const c2 = viewToCam(v, { w: 500, h: 300 });
    expect(camToView(c2, { w: 500, h: 300 })).toEqual(v);
  });
  it('saved view per board, tolerant of junk', () => {
    const s = mem();
    expect(loadSavedView(s)).toBeNull();
    saveView(s, { x: 1.4, y: 2, z: 0.5 });
    saveView(s, { x: 9, y: 9, z: 3 }, 'other');
    expect(loadSavedView(s)).toEqual({ x: 1, y: 2, z: 0.5 });
    expect(loadSavedView(s, 'other')?.z).toBe(3);
    s.m.set(VIEW_KEY, '{nope');
    expect(loadSavedView(s)).toBeNull();
    saveView(s, { x: 0, y: 0, z: 1 });
    expect(loadSavedView(s)).toEqual({ x: 0, y: 0, z: 1 });
    expect(loadSavedView(null)).toBeNull();
  });
});
