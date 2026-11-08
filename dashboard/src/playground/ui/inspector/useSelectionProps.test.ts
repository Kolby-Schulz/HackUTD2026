import { describe, expect, it } from 'vitest';
import type { Shape } from '../../core/types';
import { sectionsFor } from './Inspector';
import { mixedValue } from './useSelectionProps';

const s = (p: Partial<Shape>) => ({ id: 'a', kind: 'rect', fills: [], ...p }) as Shape;

describe('mixedValue', () => {
  it('returns the common value', () => expect(mixedValue([s({ w: 5 }), s({ w: 5 })], 'w')).toEqual({ mixed: false, value: 5 }));
  it('is mixed when widths differ', () => expect(mixedValue([s({ w: 5 }), s({ w: 6 })], 'w')).toEqual({ mixed: true }));
  it('compares objects deeply', () => {
    const f = [{ type: 'solid', color: '#fff' }] as Shape['fills'];
    expect(mixedValue([s({ fills: f }), s({ fills: [...f] })], 'fills').mixed).toBe(false);
  });
  it('treats missing vs set as mixed', () => expect(mixedValue([s({}), s({ radius: 4 })], 'radius')).toEqual({ mixed: true }));
});

describe('sectionsFor', () => {
  it('shows nothing for empty selection', () => expect(sectionsFor(new Set()).align).toBe(false));
  it('adds text when any text', () => expect(sectionsFor(new Set(['rect', 'text'])).text).toBe(true));
  it('hides paint for groups only', () => expect(sectionsFor(new Set(['group'])).paint).toBe(false));
});
