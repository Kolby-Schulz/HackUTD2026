import { describe, it, expect } from 'vitest';
import { buildInvoice, subtotal } from '../src/billing/invoice.ts';
import { ITEMS, makeOrder } from './fixtures.ts';

describe('subtotal', () => {
  it('sums price x quantity', () => {
    expect(subtotal(ITEMS)).toBe(4400);
    expect(subtotal([])).toBe(0);
  });
});

describe('buildInvoice', () => {
  it('lists each item and adds the fee', () => {
    const invoice = buildInvoice(makeOrder());
    expect(invoice.orderId).toBe('ord-1');
    expect(invoice.lines).toEqual([
      { description: 'Mug x2', amountCents: 2400 },
      { description: 'T-shirt x1', amountCents: 2000 },
    ]);
    expect(invoice.subtotalCents).toBe(4400);
    expect(invoice.feeCents).toBe(110);
    expect(invoice.totalCents).toBe(4510);
  });
});
