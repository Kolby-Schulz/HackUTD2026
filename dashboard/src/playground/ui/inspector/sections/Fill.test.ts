import { describe, expect, it } from 'vitest';
import { parseHexInput, parsePercent } from './Fill';

describe('Fill input parsing', () => {
  it('accepts 6 and 3 digit hex with or without #', () => {
    expect(parseHexInput('f24e1e')).toEqual({ color: '#f24e1e', opacity: 1 });
    expect(parseHexInput('#ABC', 0.4)).toEqual({ color: '#aabbcc', opacity: 0.4 });
  });
  it('splits 8 digit hex into colour and opacity', () => {
    const v = parseHexInput('#ff000080')!;
    expect(v.color).toBe('#ff0000');
    expect(v.opacity).toBeCloseTo(0.5, 2);
  });
  it('rejects junk', () => {
    expect(parseHexInput('zzz')).toBeNull();
    expect(parseHexInput('12345')).toBeNull();
  });
  it('parses percent', () => {
    expect(parsePercent('50%')).toBe(0.5);
    expect(parsePercent('250')).toBe(1);
    expect(parsePercent('')).toBeNull();
  });
});
