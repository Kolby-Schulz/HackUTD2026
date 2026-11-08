// Invoices for placed orders.
import type { Invoice, LineItem, Order } from '../models.ts';
import { calculateFee } from './fees.ts';

/** Sum of line prices, in cents. */
export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}

export function buildInvoice(order: Order): Invoice {
  const subtotalCents = subtotal(order.items);
  const feeCents = calculateFee(subtotalCents);
  return {
    orderId: order.id,
    lines: order.items.map((item) => ({
      description: `${item.name} x${item.quantity}`,
      amountCents: item.unitPriceCents * item.quantity,
    })),
    subtotalCents,
    feeCents,
    totalCents: subtotalCents + feeCents,
  };
}
