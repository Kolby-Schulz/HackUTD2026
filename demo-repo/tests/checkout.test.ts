import { describe, it, expect } from 'vitest';
import { computeTotal } from '../src/checkout/checkout.ts';
import { makeCart } from './fixtures.ts';

describe('computeTotal', () => {
  it('adds the fee to the cart subtotal', () => {
    expect(computeTotal(makeCart())).toBe(4510);
  });

  it('is zero for an empty cart', () => {
    expect(computeTotal({ items: [] })).toBe(0);
  });
});
