import { describe, expect, it } from 'vitest';
import { between, compareSiblings, keysBetween, sortKeys } from './order';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const valid = (k: string) => /^[0-9A-Za-z]+$/.test(k) && !k.endsWith('0');

describe('between', () => {
  it('10k random inserts keep strict order and short keys', () => {
    const r = rng(7);
    const keys: string[] = [];
    let max = 0;
    for (let i = 0; i < 10_000; i++) {
      const at = Math.floor(r() * (keys.length + 1));
      const k = between(keys[at - 1], keys[at]);
      expect(valid(k)).toBe(true);
      if (at > 0) expect(k > keys[at - 1]).toBe(true);
      if (at < keys.length) expect(k < keys[at]).toBe(true);
      keys.splice(at, 0, k);
      max = Math.max(max, k.length);
    }
    for (let i = 1; i < keys.length; i++) expect(keys[i] > keys[i - 1]).toBe(true);
    expect(max).toBeLessThan(40);
  });

  it('appends and prepends stay short', () => {
    let last = between(), first = last;
    for (let i = 0; i < 1000; i++) { const k = between(last, null); expect(k > last).toBe(true); last = k; }
    for (let i = 0; i < 1000; i++) { const k = between(null, first); expect(k < first && valid(k)).toBe(true); first = k; }
    expect(last.length).toBeLessThan(60);
    expect(first.length).toBeLessThan(60);
  });

  it('adjacent and edge keys', () => {
    for (const [a, b] of [['V', 'W'], ['z', 'zV'], ['1', '1V'], ['0V', '1'], ['', '1'], ['y', 'z']] as const) {
      const k = between(a, b);
      expect(k > a && k < b && valid(k)).toBe(true);
    }
  });

  it('tied neighbours return a key after the first', () => {
    expect(between('V', 'V') > 'V').toBe(true);
  });
});

describe('keysBetween and sorting', () => {
  it('spreads n keys in order with short keys', () => {
    const ks = keysBetween(1000, 'A', 'B');
    expect(ks).toHaveLength(1000);
    expect(new Set(ks).size).toBe(1000);
    for (let i = 0; i < ks.length; i++) {
      expect(ks[i] > (ks[i - 1] ?? 'A') && ks[i] < 'B').toBe(true);
    }
    expect(Math.max(...ks.map((k) => k.length))).toBeLessThan(10);
    expect(keysBetween(0)).toEqual([]);
  });

  it('ties break by id', () => {
    const items = [{ id: 'b', index: 'V' }, { id: 'a', index: 'V' }, { id: 'c', index: 'A' }];
    expect(sortKeys(items).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(compareSiblings(items[0], items[1])).toBe(1);
  });
});
