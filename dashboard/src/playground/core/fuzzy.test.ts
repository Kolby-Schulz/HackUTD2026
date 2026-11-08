import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyRank } from './fuzzy';

const titles = ['Zoom to fit', 'Zoom in', 'Duplicate', 'Export selection as PNG', 'Select all', 'Toggle grid', 'Rectangle tool', 'Bring to front', 'Fit selection', 'Copy as PNG'];
const top = (q: string) => fuzzyRank(q, titles, t => [t])[0]?.item;

describe('fuzzyMatch', () => {
  it('empty query matches everything', () => expect(fuzzyMatch('', 'abc')).toEqual({ score: 0, indices: [] }));
  it('rejects non-subsequences', () => expect(fuzzyMatch('xyz', 'Zoom to fit')).toBeNull());
  it('is case and accent insensitive', () => expect(fuzzyMatch('CAFE', 'Café')?.indices).toEqual([0, 1, 2, 3]));
  it('prefix > word start > subsequence', () => {
    const prefix = fuzzyMatch('fit', 'Fit selection')!.score;
    const word = fuzzyMatch('fit', 'Zoom to fit')!.score;
    const sub = fuzzyMatch('fit', 'Fill it')!.score;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
  });
  it('returns highlight indices', () => expect(fuzzyMatch('zf', 'Zoom to fit')?.indices).toEqual([0, 8]));
});

describe('fuzzyRank', () => {
  it('"exp" ranks Export first', () => expect(top('exp')).toBe('Export selection as PNG'));
  it('"zf" ranks Zoom to fit first', () => expect(top('zf')).toBe('Zoom to fit'));
  it('"dup" finds Duplicate', () => expect(top('dup')).toBe('Duplicate'));
  it('"rect" finds Rectangle', () => expect(top('rect')).toBe('Rectangle tool'));
  it('"png" finds PNG items only', () => expect(fuzzyRank('png', titles, t => [t]).map(r => r.item).sort()).toEqual(['Copy as PNG', 'Export selection as PNG']));
  it('"btf" finds Bring to front', () => expect(top('btf')).toBe('Bring to front'));
  it('matches on a later field (alias) at a discount', () => {
    const r = fuzzyRank('rect', [{ t: 'Frame', a: 'rectangle' }], x => [x.t, x.a]);
    expect(r[0].field).toBe(1);
  });
  it('title beats alias', () => {
    const r = fuzzyRank('grid', [{ t: 'Layout', a: 'grid' }, { t: 'Grid', a: '' }], x => [x.t, x.a]);
    expect(r[0].item.t).toBe('Grid');
  });
  it('ties use the tiebreak', () => {
    const r = fuzzyRank('a', ['ab', 'ac'], s => [s], (x, y) => y.localeCompare(x));
    expect(r.map(x => x.item)).toEqual(['ac', 'ab']);
  });
  it('very long text does not throw', () => expect(fuzzyMatch('zz', 'a'.repeat(5000) + 'zz')).not.toBeNull());
});
