import { describe, expect, it } from 'vitest';
import type { Action } from '../../core/types';
import { buildEntries, placeMenu, stepIndex, typeahead } from './ContextMenu';
import { trapIndex } from './Dialog';

const mk = (id: string, title: string, when?: () => true | string): Action => ({ id, title, group: 'Edit', contexts: ['canvas'], when, run() {} });
const reg: Record<string, Action> = { a: mk('a', 'Copy'), b: mk('b', 'Cut', () => 'Select a layer'), };

describe('buildEntries', () => {
  const e = buildEntries(['-', 'a', '-', 'missing', '-', 'b', '-'], (id) => reg[id], () => ['⌘C']);
  it('drops missing actions and edge/duplicate separators', () => {
    expect(e.map((x) => x.sep ? '-' : x.id)).toEqual(['a', '-', 'b']);
  });
  it('carries shortcut label and disabled reason', () => {
    expect(e[0].keys).toBe('⌘C');
    expect(e[2].disabled).toBe('Select a layer');
  });
});

describe('placeMenu', () => {
  it('stays put when it fits', () => expect(placeMenu(10, 10, 100, 100, 800, 600)).toEqual({ left: 10, top: 10 }));
  it('flips at the right/bottom edge', () => expect(placeMenu(790, 590, 100, 100, 800, 600)).toEqual({ left: 690, top: 490 }));
  it('clamps when larger than the viewport side', () => expect(placeMenu(5, 5, 100, 900, 800, 600).top).toBe(8));
});

describe('keyboard helpers', () => {
  it('wraps arrows', () => { expect(stepIndex(2, 3, 1)).toBe(0); expect(stepIndex(0, 3, -1)).toBe(2); expect(stepIndex(-1, 3, 1)).toBe(0); });
  it('typeahead finds next match', () => { expect(typeahead(['Copy', 'Cut', 'Delete'], 0, 'cu')).toBe(1); expect(typeahead(['Copy'], 0, 'z')).toBe(-1); });
  it('focus trap cycles', () => { expect(trapIndex(2, 3, false)).toBe(0); expect(trapIndex(0, 3, true)).toBe(2); expect(trapIndex(-1, 3, false)).toBe(0); });
});
