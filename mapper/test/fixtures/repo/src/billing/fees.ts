import { FEE_RATE } from '../models';

/** Fee on an amount, rounded down to the cent. */
export function calculateFee(
  amount: number, // pre-tax
  rate: number = FEE_RATE,
): number {
  return roundDown(amount * rate);
}

function roundDown(n: number): number {
  return Math.floor(n * 100) / 100;
}

export function feeLabel(amount: number): string;
export function feeLabel(amount: number, currency: string): string;
export function feeLabel(amount: number, currency = 'USD'): string {
  return `${calculateFee(amount)} ${currency}`;
}
