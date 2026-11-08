import { describe, expect, it } from 'vitest';
import type { Shape } from '../../core/types';
import { pick, stepRow, topmostIndex, withAncestorsOpen } from './useLayerSelection';
import type { LayerRowData } from './treeView';

const rows = ['a', 'b', 'c', 'd'].map((id): LayerRowData => ({ id, depth: 0, kind: 'rect', name: id, hasChildren: false, expanded: false }));
const none = { shift: false, toggle: false };

describe('pick', () => {
  it('plain click replaces', () => expect(pick(rows, ['a'], 'a', 'c', none)).toEqual({ ids: ['c'], anchor: 'c' }));
  it('toggle adds and removes', () => {
    expect(pick(rows, ['a'], 'a', 'c', { shift: false, toggle: true }).ids).toEqual(['a', 'c']);
    expect(pick(rows, ['a', 'c'], 'c', 'a', { shift: false, toggle: true }).ids).toEqual(['c']);
  });
  it('shift selects the visible range, clicked row last', () => {
    expect(pick(rows, ['b'], 'b', 'd', { shift: true, toggle: false })).toEqual({ ids: ['b', 'c', 'd'], anchor: 'b' });
    expect(pick(rows, ['d'], 'd', 'b', { shift: true, toggle: false }).ids).toEqual(['d', 'c', 'b']);
  });
  it('shift with no visible anchor acts as a plain click', () => expect(pick(rows, [], null, 'c', { shift: true, toggle: false }).ids).toEqual(['c']));
});

describe('stepRow / topmostIndex', () => {
  it('moves and clamps', () => {
    expect(stepRow(rows, ['b'], 1)).toBe('c');
    expect(stepRow(rows, ['d'], 1)).toBe('d');
    expect(stepRow(rows, [], 1)).toBe('a');
    expect(stepRow(rows, [], -1)).toBe('d');
  });
  it('topmost row of a set', () => expect(topmostIndex(rows, ['d', 'b'])).toBe(1));
});

describe('withAncestorsOpen', () => {
  const sh = (id: string, parent: string | null, kind = 'group') => [id, { id, parent, kind } as unknown as Shape] as const;
  const shapes = new Map([sh('f', null, 'frame'), sh('g', 'f'), sh('x', 'g', 'rect')]);
  const open = (s: Shape, o: ReadonlyMap<string, boolean>) => o.get(s.id) ?? s.kind === 'frame';
  it('opens collapsed ancestors only', () => {
    const next = withAncestorsOpen(new Map(), shapes, ['x'], (s) => open(s, new Map()));
    expect([...next]).toEqual([['g', true]]);
  });
  it('returns the same map when already open', () => {
    const o = new Map([['g', true]]);
    expect(withAncestorsOpen(o, shapes, ['x'], (s) => open(s, o))).toBe(o);
  });
  it('overrides a user-collapsed frame', () => {
    const o = new Map([['f', false]]);
    expect(withAncestorsOpen(o, shapes, ['x'], (s) => open(s, o)).get('f')).toBe(true);
  });
});
