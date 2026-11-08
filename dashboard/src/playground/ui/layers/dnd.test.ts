import { describe, expect, it } from 'vitest';
import type { Shape, ShapeId } from '../../core/types';
import { dragRoots, planDrop } from './dnd';

const mk = (id: string, kind: string, parent: string | null, extra: Partial<Shape> = {}) => ({ id, kind, parent, name: id, ...extra }) as unknown as Shape;
// bottom -> top: root [f, r]; f [a, g]; g [b]
const shapes = new Map<ShapeId, Shape>([
  ['f', mk('f', 'frame', null)], ['a', mk('a', 'rect', 'f')], ['g', mk('g', 'group', 'f')], ['b', mk('b', 'rect', 'g')],
  ['r', mk('r', 'rect', null)], ['k', mk('k', 'frame', null, { locked: true })],
]);
const children = new Map<ShapeId | null, readonly ShapeId[]>([[null, ['f', 'r', 'k']], ['f', ['a', 'g']], ['g', ['b']]]);
const plan = (moved: string[], id: string | null, frac: number, expanded = false) => planDrop(shapes, children, moved, { id, frac, expanded });

describe('planDrop', () => {
  it('above a row inserts after it in store order (higher z)', () => {
    expect(plan(['r'], 'a', 0.2)).toMatchObject({ mode: 'before', parent: 'f', at: { after: 'a' } });
  });
  it('below a row inserts after its lower sibling, or at the bottom', () => {
    expect(plan(['r'], 'g', 0.8)).toMatchObject({ mode: 'after', parent: 'f', at: { after: 'a' } });
    expect(plan(['r'], 'a', 0.8)).toMatchObject({ mode: 'after', parent: 'f', at: 'bottom' });
  });
  it('middle of a frame or group nests as top child; middle of a plain row is a half split', () => {
    expect(plan(['r'], 'g', 0.5)).toMatchObject({ mode: 'into', parent: 'g', at: 'top' });
    expect(plan(['b'], 'a', 0.6)).toMatchObject({ mode: 'after', parent: 'f' });
  });
  it('bottom of an expanded parent drops as its first child row', () => {
    expect(plan(['r'], 'f', 0.9, true)).toMatchObject({ mode: 'after', parent: 'f', at: 'top', depth: 1 });
  });
  it('empty space is page root top', () => {
    expect(plan(['a'], null, 0)).toMatchObject({ mode: 'root', parent: null, at: 'top', noop: false });
  });
  it('refuses own descendant, itself and locked parents', () => {
    expect(plan(['f'], 'g', 0.5)).toBeNull();
    expect(plan(['f'], 'b', 0.2)).toBeNull();
    expect(plan(['a'], 'a', 0.5)).toBeNull();
    expect(plan(['r'], 'k', 0.5)).toBeNull();
  });
  it('detects no-op drops', () => {
    expect(plan(['r'], 'k', 0.9)?.noop).toBe(true); // r already sits directly below k's row
    expect(plan(['f'], 'k', 0.1)?.noop).toBe(false);
  });
  it('multi-drag keeps only top-level ids and skips moved neighbours', () => {
    expect(dragRoots(shapes, ['f', 'a', 'r'])).toEqual(['f', 'r']);
    expect(plan(['a', 'g'], 'f', 0.5)).toMatchObject({ mode: 'into', parent: 'f', noop: true });
    expect(plan(['a', 'r'], 'g', 0.8)).toMatchObject({ at: 'bottom' });
  });
});
