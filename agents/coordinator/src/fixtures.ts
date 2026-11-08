// The two planted demo conflicts (spec section 14), shared by `--demo` and the Nemotron tests.
import type { ConflictContext } from './decide.ts';

const TASK_1 = 'Add late fees to invoices. Fees must round half-up to the cent. Show the due date on the invoice formatted like `Nov 7, 2026`.';
const TASK_2 = 'Add a receipt to checkout showing the total with fees and the order date formatted like `Nov 7, 2026`.';

/** agent-a changes calculateFee's rounding; agent-b's checkout depends on it. Expected owner: agent-a. */
export const FEE_CONFLICT: ConflictContext = {
  kind: 'broken_dependency',
  symbolId: 'src/billing/fees.ts#calculateFee',
  agentA: 'agent-a',
  agentB: 'agent-b',
  planA: 'Add late fees to invoices; change calculateFee to round half-up to the cent.',
  planB: 'Add a receipt to checkout showing the total with fees; depends on calculateFee.',
  oldSignature: 'calculateFee(amountCents: number): number',
  newSignature: 'calculateFee(amountCents: number): number',
  description: 'calculateFee now rounds half-up instead of down.',
  firstClaimant: 'agent-a',
};

/** agent-b plans a second date formatter identical to agent-a's. Expected owner: agent-a; b reuses formatDate. */
export const DUPLICATE_CONFLICT: ConflictContext = {
  kind: 'duplicate',
  symbolId: 'src/checkout/receipt.ts#formatOrderDate',
  agentA: 'agent-a',
  agentB: 'agent-b',
  planA: `Late fees on invoices | Task: ${TASK_1} | Plan items: create src/billing/invoice.ts#formatDate (formatDate(d: Date): string)`,
  planB: `Receipt at checkout | Task: ${TASK_2} | Plan items: create src/checkout/receipt.ts#formatOrderDate (formatOrderDate(date: Date): string)`,
  newSignature: 'formatOrderDate(date: Date): string',
  description:
    "agent-b plans formatOrderDate(date: Date): string, the same type as agent-a's planned src/billing/invoice.ts#formatDate(d: Date): string; both format dates like `Nov 7, 2026`.",
  firstClaimant: 'agent-a',
};
