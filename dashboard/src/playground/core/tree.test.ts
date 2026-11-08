import { describe, expect, it } from 'vitest';
import { absRect, ancestors, buildChildren, descendants, flatten, frameAt, isDescendant, normalizeShape, reparentBox, toLocal, toWorld, wouldCycle, worldBounds } from './tree';
import type { TreeView } from './tree';
import type { Kind, Shape } from './types';

function mk(id: string, parent: string | null, o: Partial<Shape> & { index?: string; kind?: Kind } = {}): Shape {
  return {
    id, kind: 'frame', parent, index: 'V', createdBy: 'human-you', name: id, x: 0, y: 0, w: 100, h: 100, fills: [], stamps: {}, ...o,
  } as Shape;
}
function view(list: Shape[]): TreeView {
  const shapes = new Map(list.map((s) => [s.id, s]));
  return { shapes, children: buildChildren(shapes) };
}

describe('tree', () => {
  const v = view([
    mk('a', null, { x: 10, y: 20, w: 500, h: 500 }),
    mk('b', 'a', { x: 100, y: 5 }),
    mk('c', 'b', { x: 7, y: 11 }),
    mk('d', 'c', { x: 1, y: 2, w: 10, h: 10, kind: 'rect' }),
  ]);

  it('absRect of a child three levels deep sums parent offsets', () => {
    expect(absRect(v, 'd')).toEqual({ x: 10 + 100 + 7 + 1, y: 20 + 5 + 11 + 2, w: 10, h: 10 });
    expect(absRect(v, 'nope')).toBeNull();
    expect(worldBounds(v, 'd')).toEqual(absRect(v, 'd'));
  });

  it('toLocal(toWorld(p)) round-trips, with rotated ancestors too', () => {
    const rot = view([mk('a', null, { x: 10, y: 20, rotation: 33 }), mk('b', 'a', { x: 5, y: 6, rotation: -80 }), mk('c', 'b')]);
    for (const view of [v, rot]) {
      const p = { x: 12.5, y: -4.25 };
      const back = toLocal(view, 'c', toWorld(view, 'c', p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
    expect(toWorld(v, null, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(toWorld(v, 'b', { x: 0, y: 0 })).toEqual({ x: 110, y: 25 });
  });

  it('ancestors, descendants, cycles', () => {
    expect(ancestors(v, 'd')).toEqual(['c', 'b', 'a']);
    expect(isDescendant(v, 'd', 'a')).toBe(true);
    expect(isDescendant(v, 'a', 'd')).toBe(false);
    expect(descendants(v, 'a')).toEqual(['b', 'c', 'd']);
    expect(wouldCycle(v, 'a', 'd')).toBe(true);
    expect(wouldCycle(v, 'a', 'a')).toBe(true);
    expect(wouldCycle(v, 'd', null)).toBe(false);
    const loop = view([mk('x', 'y'), mk('y', 'x')]);
    expect(ancestors(loop, 'x')).toEqual(['y']); // terminates
  });

  it('children order by index then id; tombstones and missing parents handled', () => {
    const t = view([
      mk('p', null), mk('k2', 'p', { index: 'b' }), mk('k1', 'p', { index: 'a' }),
      mk('k0', 'p', { index: 'a' }), mk('gone', 'p', { deleted: true }), mk('orphan', 'missing'),
    ]);
    expect(t.children.get('p')).toEqual(['k0', 'k1', 'k2']);
    expect(t.children.get(null)).toEqual(['orphan', 'p']);
    expect(flatten(t)).toEqual(['orphan', 'p', 'k0', 'k1', 'k2']);
  });

  it('frameAt finds the deepest topmost frame and honors exclude/hidden', () => {
    const f = view([
      mk('a', null, { w: 200, h: 200 }),
      mk('b', 'a', { x: 50, y: 50, w: 50, h: 50 }),
      mk('r', 'a', { x: 60, y: 60, w: 5, h: 5, kind: 'rect' }),
    ]);
    expect(frameAt(f, { x: 70, y: 70 })).toBe('b');
    expect(frameAt(f, { x: 10, y: 10 })).toBe('a');
    expect(frameAt(f, { x: 500, y: 500 })).toBeNull();
    expect(frameAt(f, { x: 70, y: 70 }, { exclude: ['b'] })).toBe('a');
  });

  it('reparentBox preserves the visual position', () => {
    const r = view([mk('a', null, { x: 100, y: 100 }), mk('b', null, { x: 10, y: 10 }), mk('s', 'a', { x: 5, y: 5, w: 20, h: 20, kind: 'rect' })]);
    const next = reparentBox(r, 's', 'b')!;
    expect(next.x).toBeCloseTo(95); expect(next.y).toBeCloseTo(95);
    expect(reparentBox(r, 's', null)!.x).toBeCloseTo(105);
  });
});

describe('normalizeShape', () => {
  it('is idempotent, drops unknowns, flips negatives, migrates fill', () => {
    const raw = { id: 's1', kind: 'rect', x: 50, y: 50, w: -20, h: 10, fill: '#f00', owner: 'agent-1', bogus: 1 };
    const once = normalizeShape(raw);
    expect(once).toMatchObject({ x: 30, w: 20, parent: null, fills: [{ type: 'solid', color: '#f00' }] });
    expect('owner' in once || 'bogus' in once || 'fill' in once).toBe(false);
    expect(normalizeShape(once as any)).toEqual(once);
  });
  it('clamps coordinates and rejects NaN', () => {
    expect(normalizeShape({ id: 'a', kind: 'rect', x: 1e12 }).x).toBe(1e7);
    expect(() => normalizeShape({ id: 'a', kind: 'rect', x: NaN })).toThrow(RangeError);
  });
});
