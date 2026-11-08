export interface LineItem {
  sku: string;
  price: number;
  qty: number;
}

export type Currency = 'USD' | 'EUR';

export const FEE_RATE = 0.03;
export const DEFAULT_CURRENCY: Currency = 'USD';
export const LIMITS = { maxItems: 50 };
let counter = 0; // not exported, not a symbol
export let mutable = counter; // let is not a symbol

const TAX_RATE = 0.08;
export { TAX_RATE };
