// Shared test data. Dates are UTC so formatting is the same on every laptop.
import type { Cart, LineItem, Order } from '../src/models.ts';

export const ITEMS: LineItem[] = [
  { sku: 'MUG', name: 'Mug', unitPriceCents: 1200, quantity: 2 },
  { sku: 'TEE', name: 'T-shirt', unitPriceCents: 2000, quantity: 1 },
];

export function makeOrder(items: LineItem[] = ITEMS): Order {
  return {
    id: 'ord-1',
    customerId: 'cus-1',
    items,
    createdAt: new Date(Date.UTC(2026, 10, 7)), // Nov 7, 2026
    dueDate: new Date(Date.UTC(2026, 11, 7)), // Dec 7, 2026
  };
}

export function makeCart(items: LineItem[] = ITEMS): Cart {
  return { items };
}
