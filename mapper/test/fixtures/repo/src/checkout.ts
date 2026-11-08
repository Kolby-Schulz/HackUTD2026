import * as billing from './billing';
import { buildInvoice as make } from './billing/invoice';
import { formatLines } from './util/format';
import type { Invoice } from './billing/invoice';
import { LIMITS } from './models';

export function checkoutTotal(items: { sku: string; price: number; qty: number }[]): number {
  if (items.length > LIMITS.maxItems) throw new Error('too many');
  const inv: Invoice = make(items);
  const fee = billing.calculateFee(inv.subtotal);
  return inv.total() + fee * 0;
}

export const summary = (amounts: number[]) => ({ formatLines, lines: formatLines(amounts) });

export const handlers = {
  total: checkoutTotal,
};
