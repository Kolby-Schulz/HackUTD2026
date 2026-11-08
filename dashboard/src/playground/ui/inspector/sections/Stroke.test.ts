import { describe, expect, it } from 'vitest';
import { fromValue, toValue } from './Stroke';

describe('stroke colour conversion', () => {
  it('round-trips opaque and translucent colours', () => {
    expect(fromValue({ color: '#ff0000', opacity: 1 })).toBe('#ff0000');
    const t = fromValue({ color: '#000000', opacity: 0.25 });
    expect(t).toMatch(/^#000000[0-9a-f]{2}$/);
    expect(toValue(t).opacity).toBeCloseTo(0.25, 1);
    expect(toValue('#00000040').color).toBe('#000000');
  });
});
