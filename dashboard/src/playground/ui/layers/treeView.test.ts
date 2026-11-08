import { describe, expect, it } from 'vitest';
import type { Shape, ShapeId } from '../../core/types';
import { flattenTree, hiddenSelectionParents, subtreeParents } from './treeView';

const mk = (id: string, kind: string, parent: string | null, extra: Partial<Shape> = {}) =>
  ({ id, kind, parent, name: id, ...extra }) as unknown as Shape;
const shapes = new Map<ShapeId, Shape>([
  ['f', mk('f', 'frame', null)], ['a', mk('a', 'rect', 'f')], ['g', mk('g', 'group', 'f')], ['b', mk('b', 'text', 'g', { text: 'Hello' })],
  ['r', mk('r', 'rect', null)],
]);
// bottom -> top order, as the store keeps it
const children = new Map<ShapeId | null, readonly ShapeId[]>([[null, ['f', 'r']], ['f', ['a', 'g']], ['g', ['b']]]);

describe('flattenTree', () => {
  it('lists top layer first, frames expanded by default, groups collapsed', () => {
    const rows = flattenTree(children, shapes, new Map());
    expect(rows.map((r) => [r.id, r.depth])).toEqual([['r', 0], ['f', 0], ['g', 1], ['a', 1]]);
    expect(rows.find((r) => r.id === 'g')).toMatchObject({ hasChildren: true, expanded: false });
  });
  it('honours overrides and shows text content', () => {
    const rows = flattenTree(children, shapes, new Map([['g', true], ['f', false]]));
    expect(rows.map((r) => r.id)).toEqual(['r', 'f']);
    const open = flattenTree(children, shapes, new Map([['g', true]]));
    expect(open.map((r) => r.name)).toEqual(['r', 'f', 'g', 'Hello', 'a']);
  });
  it('survives cycles and missing shapes', () => {
    const cyc = new Map<ShapeId | null, readonly ShapeId[]>([[null, ['f']], ['f', ['f', 'zz']]]);
    expect(flattenTree(cyc, shapes, new Map()).map((r) => r.id)).toEqual(['f']);
  });
  it('subtreeParents and hidden-selection parents', () => {
    expect(subtreeParents(children, 'f')).toEqual(['f', 'g']);
    const rows = flattenTree(children, shapes, new Map());
    expect([...hiddenSelectionParents(rows, shapes, ['b'])]).toEqual(['g']);
  });
});

import { rowActivity } from './treeView';
describe('rowActivity', () => {
  it('collects own editors and marks every ancestor', () => {
    const shapes = new Map<string, any>([
      ['f', { id: 'f', parent: null }], ['g', { id: 'g', parent: 'f' }], ['r', { id: 'r', parent: 'g' }],
    ]);
    const a = rowActivity([{ shapeId: 'r', holder: 'x' }, { shapeId: 'r', holder: 'y' }, { shapeId: 'g', holder: 'x' }, { shapeId: 'r', holder: 'ghost' }], shapes, (h) => ({ x: '#f00', y: '#0f0' } as Record<string, string>)[h]);
    expect(a.own.get('r')).toEqual(['#f00', '#0f0']);
    expect(a.below.get('g')).toEqual(['#f00', '#0f0']);
    expect(a.below.get('f')).toEqual(['#f00', '#0f0']);
    expect(a.below.has('r')).toBe(false);
  });
});
