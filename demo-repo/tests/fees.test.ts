import { describe, it, expect } from 'vitest';
import { calculateFee, FEE_BPS } from '../src/billing/fees.ts';

describe('calculateFee', () => {
  it('charges 2.5%', () => {
    expect(FEE_BPS).toBe(250);
    expect(calculateFee(10000)).toBe(250);
    expect(calculateFee(4400)).toBe(110);
  });

  it('is zero for zero', () => {
    expect(calculateFee(0)).toBe(0);
  });

  it('returns whole cents', () => {
    expect(Number.isInteger(calculateFee(1010))).toBe(true);
    expect(calculateFee(1010)).toBe(25); // 25.25
  });
});
