// End-to-end judge (spec section 14). Agents must not edit this file.
// Red at baseline by design: fees round down today, and the business rule is half-up.
// scripts/run-demo.ts runs it after merging both agents' branches.
import { describe, it, expect } from 'vitest';
import { calculateFee } from '../src/billing/fees.ts';
import { buildInvoice } from '../src/billing/invoice.ts';
import { computeTotal } from '../src/checkout/checkout.ts';
import type { LineItem } from '../src/models.ts';
import { ITEMS, makeCart, makeOrder } from './fixtures.ts';

// 1020 cents * 2.5% = 25.5 cents exactly: half-up gives 26, rounding down gives 25.
const HALF_CENT: LineItem[] = [{ sku: 'PEN', name: 'Pen', unitPriceCents: 340, quantity: 3 }];

describe('billing end to end', () => {
  it('fees round half-up to the cent', () => {
    expect(calculateFee(1020)).toBe(26);
    expect(calculateFee(1010)).toBe(25);
  });

  it('invoice total equals checkout total', () => {
    for (const items of [ITEMS, HALF_CENT]) {
      expect(buildInvoice(makeOrder(items)).totalCents).toBe(computeTotal(makeCart(items)));
    }
  });

  it('a half-cent order totals 1046 on both the invoice and at checkout', () => {
    expect(buildInvoice(makeOrder(HALF_CENT)).totalCents).toBe(1046);
    expect(computeTotal(makeCart(HALF_CENT))).toBe(1046);
  });
});

// The two features the agents add. Their names and signatures are up to the agents, so
// find them by name: any exported function in src/checkout/ whose name contains "receipt".
// An Order is also a Cart (it has items), so we pass the order and its date; that fits
// receipt(cart), receipt(order) and receipt(cart, date).
const checkoutModules = import.meta.glob('../src/checkout/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
const receiptFns = Object.values(checkoutModules)
  .flatMap((mod) => Object.entries(mod))
  .filter(([name, value]) => /receipt/i.test(name) && typeof value === 'function')
  .map(([, value]) => value as (...args: unknown[]) => unknown);

const show = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

describe('features from both tasks', () => {
  it('checkout has a receipt with the fee-inclusive total and the order date', () => {
    expect(receiptFns.length, 'no exported *receipt* function in src/checkout/').toBeGreaterThan(0);
    const order = makeOrder(HALF_CENT);
    const text = show(receiptFns[0](order, order.createdAt));
    expect(text).toMatch(/10\.46|1046/);
    expect(text).toContain('Nov 7, 2026');
  });

  it('the invoice shows the due date', () => {
    expect(show(buildInvoice(makeOrder(HALF_CENT)))).toContain('Dec 7, 2026');
  });
});
