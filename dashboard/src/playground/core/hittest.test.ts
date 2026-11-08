import { describe, expect, it } from 'vitest';
import { hitRect, hitTest } from './hittest';
import { SpatialIndex } from './spatial';
import { buildChildren } from './tree';
import type { TreeView } from './tree';
import type { Shape } from './types';

const solid = [{ type: 'solid', color: '#000' } as const];
function mk(id: string, parent: string | null, o: Partial<Shape> = {}): Shape {
  return { id, kind: 'rect', parent, index: 'V', createdBy: 'human-you', name: id, x: 0, y: 0, w: 100, h: 100, fills: solid, stamps: {}, ...o } as Shape;
}
function setup(list: Shape[]) {
  const shapes = new Map(list.map((s) => [s.id, s]));
  const v: TreeView = { shapes, children: buildChildren(shapes) };
  const idx = new SpatialIndex();
  idx.rebuild(v);
  return { v, idx };
}

describe('hitTest', () => {
  it('ellipse: outside the curve but inside the box misses; tolerance is 4/z', () => {
    const { v, idx } = setup([mk('e', null, { kind: 'ellipse' })]);
    expect(hitTest(v, idx, { x: 50, y: 50 })).toBe('e');
    expect(hitTest(v, idx, { x: 5, y: 5 })).toBeNull();
    // 3 units outside the right edge: hit at z=1 (tol 4), miss at z=4 (tol 1)
    expect(hitTest(v, idx, { x: 103, y: 50 }, { z: 1 })).toBe('e');
    expect(hitTest(v, idx, { x: 103, y: 50 }, { z: 4 })).toBeNull();
    // zoomed out: tol 16 world units
    expect(hitTest(v, idx, { x: 114, y: 50 }, { z: 0.25 })).toBe('e');
  });

  it('rounded rect misses its cut corner', () => {
    const { v, idx } = setup([mk('r', null, { radius: 40 })]);
    expect(hitTest(v, idx, { x: 2, y: 2 }, { z: 4 })).toBeNull();
    expect(hitTest(v, idx, { x: 50, y: 2 })).toBe('r');
  });

  it('hidden never hit, locked skipped unless asked', () => {
    const { v, idx } = setup([mk('h', null, { hidden: true }), mk('l', null, { locked: true, x: 300 })]);
    expect(hitTest(v, idx, { x: 50, y: 50 }, { includeLocked: true })).toBeNull();
    expect(hitTest(v, idx, { x: 350, y: 50 })).toBeNull();
    expect(hitTest(v, idx, { x: 350, y: 50 }, { includeLocked: true })).toBe('l');
  });

  it('unfilled rect is hit only on its edge band; thin line is selectable zoomed out', () => {
    const { v, idx } = setup([
      mk('r', null, { fills: [], strokes: [{ color: '#000', width: 2 }] }),
      mk('ln', null, { kind: 'line', x: 500, y: 0, w: 200, h: 0, fills: [], strokes: [{ color: '#000', width: 1 }] }),
    ]);
    expect(hitTest(v, idx, { x: 50, y: 50 })).toBeNull();
    expect(hitTest(v, idx, { x: 1, y: 50 })).toBe('r');
    expect(hitTest(v, idx, { x: 600, y: 10 }, { z: 0.25 })).toBe('ln');
    expect(hitTest(v, idx, { x: 600, y: 30 }, { z: 0.25 })).toBeNull();
  });

  it('default returns the top-level child of a frame, deep the deepest; topmost sibling wins', () => {
    const { v, idx } = setup([
      mk('F', null, { kind: 'frame', w: 400, h: 400 }),
      mk('G', 'F', { kind: 'group', x: 10, y: 10, w: 200, h: 200, fills: [] }),
      mk('R', 'G', { x: 10, y: 10 }),
      mk('A', 'F', { x: 300, y: 300, w: 50, h: 50, index: 'V' }),
      mk('B', 'F', { x: 300, y: 300, w: 50, h: 50, index: 'W' }),
    ]);
    expect(hitTest(v, idx, { x: 50, y: 50 })).toBe('G');
    expect(hitTest(v, idx, { x: 50, y: 50 }, { deep: true })).toBe('R');
    expect(hitTest(v, idx, { x: 320, y: 320 })).toBe('B');
    expect(hitTest(v, idx, { x: 250, y: 250 })).toBe('F'); // empty frame area
  });

  it('clipping frame hides children outside its box; rotated shapes are inverse-transformed', () => {
    const { v, idx } = setup([
      mk('F', null, { kind: 'frame', w: 100, h: 100 }),
      mk('C', 'F', { x: 80, y: 0, w: 100, h: 20 }),
      mk('T', null, { x: 500, y: 0, w: 200, h: 20, rotation: 90 }),
    ]);
    expect(hitTest(v, idx, { x: 150, y: 10 })).toBeNull();
    expect(hitTest(v, idx, { x: 90, y: 10 })).toBe('C');
    // box center (600,10); rotated 90deg it becomes vertical: (600, 100) inside, (520, 10) outside
    expect(hitTest(v, idx, { x: 600, y: 100 })).toBe('T');
    expect(hitTest(v, idx, { x: 520, y: 10 })).toBeNull();
  });

  it('5k-shape hit test is fast', () => {
    const list = Array.from({ length: 5000 }, (_, i) => mk(`s${i}`, null, { x: (i % 100) * 120, y: Math.floor(i / 100) * 120, w: 100, h: 100, index: String(i).padStart(5, '0') }));
    const { v, idx } = setup(list);
    hitTest(v, idx, { x: 50, y: 50 });
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) hitTest(v, idx, { x: (i % 100) * 120 + 50, y: 50 });
    expect((performance.now() - t0) / 200).toBeLessThan(0.2);
  });

  it('hitRect maps to top-level targets in paint order', () => {
    const { v, idx } = setup([
      mk('G', null, { kind: 'group', fills: [] }), mk('R', 'G', { w: 50, h: 50 }),
      mk('S', null, { x: 20, y: 20, w: 20, h: 20, index: 'W' }), mk('H', null, { hidden: true, index: 'X' }),
    ]);
    expect(hitRect(v, idx, { x: 0, y: 0, w: 100, h: 100 })).toEqual(['G', 'S']);
    expect(hitRect(v, idx, { x: 0, y: 0, w: 100, h: 100 }, { deep: true })).toEqual(['R', 'S']);
  });
});
