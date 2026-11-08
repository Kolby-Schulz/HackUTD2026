// Checkout: what the customer pays for a cart.
import type { Cart } from '../models.ts';
import { calculateFee } from '../billing/fees.ts';
import { subtotal } from '../billing/invoice.ts';

/** Cart total including the processing fee, in cents. */
export function computeTotal(cart: Cart): number {
  const subtotalCents = subtotal(cart.items);
  return subtotalCents + calculateFee(subtotalCents);
}
