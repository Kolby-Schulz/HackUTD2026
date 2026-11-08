import { describe, expect, it } from 'vitest';
import type { Action } from '../core/types';
import { helpGroups } from './HelpOverlay';

const mk = (id: string, title: string, group: Action['group'], keys?: Action['keys']): Action => ({ id, title, group, keys, contexts: ['canvas'], run() {} });
const list = [
  mk('tool.rect', 'Rectangle', 'Tools', { all: ['r'] }),
  mk('edit.dup', 'Duplicate', 'Edit', { mac: ['Mod+d'], win: ['Mod+d', 'Ctrl+Shift+d'] }),
  mk('view.fit', 'Zoom to fit', 'View', { all: ['Shift+Digit1'] }),
  mk('x.nokey', 'Palette only', 'Edit'),
];

describe('helpGroups', () => {
  it('lists keyed actions once, grouped in display order, skipping unbound ones', () => {
    const g = helpGroups(list, 'mac');
    expect(g.map((x) => x.group)).toEqual(['Tools', 'Edit', 'View']);
    expect(g.flatMap((x) => x.rows.map((r) => r.id))).toEqual(['tool.rect', 'edit.dup', 'view.fit']);
  });
  it('uses platform glyphs', () => {
    expect(helpGroups(list, 'mac')[1].rows[0].keys).toEqual(['⌘D']);
    expect(helpGroups(list, 'win')[1].rows[0].keys).toEqual(['Ctrl+D', 'Ctrl+Shift+D']);
  });
  it('filters by title, group or key', () => {
    expect(helpGroups(list, 'mac', 'rect').map((x) => x.group)).toEqual(['Tools']);
    expect(helpGroups(list, 'mac', 'edit').map((x) => x.group)).toEqual(['Edit']);
    expect(helpGroups(list, 'mac', '⌘d')[0].rows[0].id).toBe('edit.dup');
    expect(helpGroups(list, 'mac', 'zzz')).toEqual([]);
  });
});
