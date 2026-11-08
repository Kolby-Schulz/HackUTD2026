import { describe, expect, it } from 'vitest';
import { PALETTE, contrastOnWhite, pickColor, resolveColors, generatedColor } from './colors';

describe('colors', () => {
  it('first 12 picks are distinct', () => {
    const used: string[] = [];
    for (let i = 0; i < 12; i++) used.push(pickColor(used));
    expect(new Set(used).size).toBe(12);
  });
  it('actors 13+ get generated colours distinct from everything', () => {
    const used: string[] = [...PALETTE];
    for (let i = 0; i < 6; i++) used.push(pickColor(used));
    expect(new Set(used).size).toBe(18);
  });
  it('resolveColors dedupes collisions and is sticky', () => {
    const sticky = new Map<string, string>();
    const a = resolveColors([{ id: 'a', color: PALETTE[0] }, { id: 'b', color: PALETTE[0] }], sticky);
    expect(a.get('a')).toBe(PALETTE[0]);
    expect(a.get('b')).not.toBe(PALETTE[0]);
    const b = resolveColors([{ id: 'b', color: PALETTE[0] }], sticky);
    expect(b.get('b')).toBe(a.get('b'));
  });
  it('12 actors sharing one colour end up distinct', () => {
    const r = resolveColors(Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, color: PALETTE[0] })));
    expect(new Set(r.values()).size).toBe(12);
  });
  it('generated colours have enough contrast on white', () => {
    for (let n = 12; n < 40; n++) expect(contrastOnWhite(generatedColor(n))).toBeGreaterThanOrEqual(3);
  });
});
