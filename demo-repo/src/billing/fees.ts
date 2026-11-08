// Processing fee charged on every order.

/** Fee rate in basis points (250 = 2.5%). */
export const FEE_BPS = 250;

/** Processing fee for an amount, in whole cents. Rounds down to the cent. */
export function calculateFee(amountCents: number): number {
  return Math.floor((amountCents * FEE_BPS) / 10000);
}
