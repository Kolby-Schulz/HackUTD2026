import { describe, expect, it } from 'vitest';
import type { Shape, ShapeId } from '../../core/types';
import { filterRows, summaryText } from './LayerSearch';

const mk = (id: string, kind: string, parent: string | null, extra: Partial<Shape> = {}) =>
  ({ id, kind, parent, name: id, ...extra }) as unknown as Shape;
const shapes = new Map<ShapeId, Shape>([
  ['f', mk('f', 'frame', null)], ['a', mk('a', 'rect', 'f', { name: 'Button bg' })], ['g', mk('g', 'group', 'f')],
  ['b', mk('b', 'text', 'g', { text: 'Click BUTTON' })], ['r', mk('r', 'rect', null)],
]);
const children = new Map<ShapeId | null, readonly ShapeId[]>([[null, ['f', 'r']], ['f', ['a', 'g']], ['g', ['b']]]);

describe('filterRows', () => {
  it('blank query is null', () => expect(filterRows(children, shapes, '  ')).toBeNull());
  it('keeps matches with ancestors, matches text content, case-insensitive', () => {
    const r = filterRows(children, shapes, 'button')!;
    expect(r.rows.map((x) => x.id)).toEqual(['f', 'g', 'b', 'a']);
    expect(r.matches).toBe(2);
    expect(r.rows.find((x) => x.id === 'g')!.expanded).toBe(true);
  });
  it('no match gives no rows', () => expect(filterRows(children, shapes, 'zzz')!.rows).toEqual([]));
});

describe('summaryText', () => {
  it('formats', () => {
    expect(summaryText(12, 3, null)).toBe('12 layers · 3 selected');
    expect(summaryText(1, 0, null)).toBe('1 layer');
    expect(summaryText(12, 0, 2)).toBe('2 of 12 layers');
  });
});
