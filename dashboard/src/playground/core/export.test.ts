import { describe, expect, it } from 'vitest';
import { boundsOf, exportPng, exportRoots, renderToCanvas } from './export';
import type { ExportCtx } from './export';
import { buildChildren } from './tree';
import type { Shape, ShapeId } from './types';

let n = 0;
function mk(id: string, kind: Shape['kind'], parent: string | null, p: Partial<Shape> = {}): Shape {
  return { id, kind, parent, index: String(n++).padStart(4, '0'), name: id, x: 0, y: 0, w: 100, h: 50, fills: [], createdBy: 'human-you', stamps: {}, ...p };
}
function view(list: Shape[]) {
  const shapes = new Map(list.map((s) => [s.id, s] as const));
  return { shapes, children: buildChildren(shapes) };
}

/** Recording context: every method call lands in `calls` as "name(args)"; property sets as "prop=value". */
function recorder() {
  const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy({}, {
    get(_t, k: string) {
      if (k === 'measureText') return (t: string) => ({ width: t.length * 10 });
      if (k in state) return state[k];
      return (...a: unknown[]) => { calls.push(`${k}(${a.join(',')})`); };
    },
    set(_t, k: string, v) { state[k] = v; calls.push(`${k}=${v}`); return true; },
  }) as unknown as ExportCtx;
  return { ctx, calls };
}

const demo = () => view([
  mk('f', 'frame', null, { x: 10, y: 20, w: 400, h: 300, fills: [{ type: 'solid', color: '#fff' }] }),
  mk('r', 'rect', 'f', { x: 5, y: 5, fills: [{ type: 'solid', color: '#f00' }] }),
  mk('e', 'ellipse', 'f', { x: 50, y: 50, fills: [{ type: 'solid', color: '#0f0' }] }),
  mk('t', 'text', 'f', { x: 0, y: 100, w: 60, h: 40, text: 'hello big world', fontSize: 10, color: '#00f' }),
]);

describe('boundsOf', () => {
  it('unions world bounds, skipping hidden and missing ids', () => {
    const v = view([mk('a', 'rect', null, { x: 0, y: 0, w: 10, h: 10 }), mk('b', 'rect', null, { x: 20, y: 30, w: 10, h: 10 }), mk('h', 'rect', null, { x: 900, y: 900, hidden: true })]);
    expect(boundsOf(v, ['a', 'b', 'h', 'zz'])).toEqual({ x: 0, y: 0, w: 30, h: 40 });
    expect(boundsOf(v, [])).toBeNull();
  });
  it('uses world coordinates for nested shapes', () => {
    expect(boundsOf(demo(), ['r'])).toEqual({ x: 15, y: 25, w: 100, h: 50 });
  });
  it('drops ids whose ancestor is selected', () => {
    expect(exportRoots(demo(), ['r', 'f', 'e'])).toEqual(['f']);
  });
});

describe('renderToCanvas', () => {
  it('draws frame fill, clips, then children in z-order', () => {
    const { ctx, calls } = recorder();
    renderToCanvas(ctx, demo(), ['f'], { scale: 2 });
    const fills = calls.filter((c) => c.startsWith('fillStyle=') || c.startsWith('fillText'));
    expect(fills).toEqual(['fillStyle=#fff', 'fillStyle=#f00', 'fillStyle=#0f0', 'fillStyle=#00f', 'fillText(hello,0,6)', 'fillText(big,0,18)', 'fillText(world,0,30)']);
    const clip = calls.indexOf('clip()');
    expect(clip).toBeGreaterThan(calls.indexOf('fillStyle=#fff'));
    expect(clip).toBeLessThan(calls.indexOf('fillStyle=#f00'));
    expect(calls).toContain('ellipse(50,25,50,25,0,0,6.283185307179586)');
  });
  it('maps world to output pixels at the chosen scale', () => {
    const { ctx, calls } = recorder();
    renderToCanvas(ctx, demo(), ['f'], { scale: 2 });
    expect(calls).toContain('setTransform(2,0,0,2,-20,-40)');
  });
  it('paints a background first and skips hidden shapes', () => {
    const v = view([mk('a', 'rect', null, { fills: [{ type: 'solid', color: '#111' }], hidden: true })]);
    const { ctx, calls } = recorder();
    renderToCanvas(ctx, v, ['a'], { scale: 1, background: '#eee', bounds: { x: 0, y: 0, w: 10, h: 10 } });
    expect(calls).toContain('fillRect(0,0,10,10)');
    expect(calls.some((c) => c === 'fillStyle=#111')).toBe(false);
  });
  it('follows global z-order, not selection order', () => {
    const v = view([mk('a', 'rect', null, { fills: [{ type: 'solid', color: '#a' }] }), mk('b', 'rect', null, { fills: [{ type: 'solid', color: '#b' }] })]);
    const { ctx, calls } = recorder();
    renderToCanvas(ctx, v, ['b', 'a'], { scale: 1 });
    expect(calls.filter((c) => c.startsWith('fillStyle='))).toEqual(['fillStyle=#a', 'fillStyle=#b']);
  });
  it('rounds corners with arcTo and does the outside stroke with an even-odd clip', () => {
    const v = view([mk('a', 'rect', null, { radius: 8, strokes: [{ color: '#000', width: 2, align: 'outside' }] })]);
    const { ctx, calls } = recorder();
    renderToCanvas(ctx, v, ['a'], { scale: 1 });
    expect(calls.filter((c) => c.startsWith('arcTo')).length).toBe(8);
    expect(calls).toContain('clip(evenodd)');
    expect(calls).toContain('lineWidth=4');
  });
  it('applies drop shadows scaled and rotation about the center', () => {
    const v = view([mk('a', 'rect', null, { rotation: 90, fills: [{ type: 'solid', color: '#fff' }], effects: [{ type: 'drop', x: 1, y: 2, blur: 4, color: '#000' }] })]);
    const { ctx, calls } = recorder();
    renderToCanvas(ctx, v, ['a' as ShapeId], { scale: 2 });
    expect(calls).toContain('shadowBlur=8');
    expect(calls).toContain('shadowOffsetY=4');
    expect(calls).toContain(`rotate(${Math.PI / 2})`);
  });
});

describe('exportPng', () => {
  it('sizes the canvas from scale only and resolves the blob', async () => {
    const { ctx } = recorder();
    let size: [number, number] = [0, 0];
    const blob = new Blob(['x'], { type: 'image/png' });
    const out = await exportPng({ getState: () => demo() }, ['f'], {
      scale: 2,
      createCanvas: (w, h) => { size = [w, h]; return { getContext: () => ctx, toBlob: (cb) => cb(blob) }; },
    });
    expect(size).toEqual([800, 600]);
    expect(out).toBe(blob);
  });
  it('rejects an empty selection', async () => {
    await expect(exportPng({ getState: () => demo() }, [], { scale: 1 })).rejects.toThrow('Nothing to export');
  });
});
