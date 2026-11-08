import { formatPrice } from '@shared/format';
import { cartTotal } from '@web/cart';

export function renderCart(items: number[]): string {
  return formatPrice(cartTotal(items));
}
