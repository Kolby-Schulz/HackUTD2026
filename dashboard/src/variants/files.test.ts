import { describe, expect, it } from 'vitest';
import { isSafeId, newComboId, slugify, uniqueId } from './files.ts';

describe('ids', () => {
  it('accepts kebab ids and rejects paths', () => {
    expect(isSafeId('b2-playful')).toBe(true);
    for (const bad of ['', '../x', 'a/b', 'A', '-x', 'x'.repeat(49), 3]) expect(isSafeId(bad)).toBe(false);
  });

  it('slugs and de-duplicates', () => {
    expect(slugify('  Calm grid, v2! ')).toBe('calm-grid-v2');
    expect(slugify('!!!')).toBe('variant');
    expect(uniqueId('Calm', ['calm', 'calm-2'])).toBe('calm-3');
    expect(newComboId([], 0)).toBe('mix-0');
  });
});
