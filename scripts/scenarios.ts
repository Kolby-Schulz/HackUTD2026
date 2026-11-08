// Benchmark scenarios (issue #28): pairs of tasks on demo-repo that collide in different
// ways, plus a control where they shouldn't. Owner: dashboard + demo.
// `planted` is the original demo (spec section 14; tasks from agents/worker/src/tasks.ts).
import { TASKS } from '../agents/worker/src/tasks.ts';
import type { CheckScript } from './merge.ts';

export interface Scenario {
  title: string;
  /** What should happen without Contract, for the report. */
  expect: string;
  a: { title: string; task: string };
  b: { title: string; task: string };
  checks: CheckScript[];
}

export const SCENARIOS: Record<string, Scenario> = {
  planted: {
    title: 'Broken dependency (rounding) + duplicate date formatter',
    expect: 'A changes fee rounding under B; both write a date formatter',
    a: { title: 'Late fees on invoices', task: TASKS['1']! },
    b: { title: 'Receipt at checkout', task: TASKS['2']! },
    checks: ['test', 'test:integration', 'check:dupes'],
  },
  'duplicate-helper': {
    title: 'Duplicate helper (money formatting)',
    expect: 'both agents write their own dollar formatter',
    a: { title: 'Formatted invoice totals', task: 'Show the invoice total formatted as dollars like `$1,234.50` (amounts are in cents) in buildInvoice output. Add tests.' },
    b: { title: 'Formatted receipt total', task: 'Add a receipt line to checkout showing the order total formatted as dollars like `$1,234.50` (amounts are in cents). Add tests.' },
    checks: ['test', 'typecheck', 'check:dupes'],
  },
  'claim-contention': {
    title: 'Claim contention (both modify calculateFee)',
    expect: 'both edit calculateFee; the merge conflicts',
    a: { title: 'Minimum fee', task: 'calculateFee in src/billing/fees.ts must charge at least 25 cents. Update it and its tests.' },
    b: { title: 'Fee cap', task: 'calculateFee in src/billing/fees.ts must never charge more than $10.00 (1000 cents). Update it and its tests.' },
    checks: ['test', 'typecheck', 'check:dupes'],
  },
  'signature-change': {
    title: 'Signature change with several callers',
    expect: 'A changes calculateFee\'s parameters while B adds a new caller with the old ones',
    a: { title: 'Fee options object', task: 'Change calculateFee in src/billing/fees.ts to take one options object `{ amountCents: number; bps?: number }` instead of positional arguments, and update every caller and test.' },
    b: { title: 'Fee on receipt', task: 'Add a receipt line to checkout that shows the processing fee for the order, computed with calculateFee. Add tests.' },
    checks: ['test', 'typecheck', 'check:dupes'],
  },
  control: {
    title: 'Control: unrelated changes',
    expect: 'no conflict; Contract should add little overhead',
    a: { title: 'Invoice number', task: 'Give every invoice from buildInvoice an `invoiceNumber` string like `INV-0001` (a counter passed in by the caller). Add tests.' },
    b: { title: 'Free shipping flag', task: 'Add an exported function `qualifiesForFreeShipping(cart)` in src/checkout/checkout.ts that is true when the cart subtotal is at least $50 (5000 cents). Add tests.' },
    checks: ['test', 'typecheck', 'check:dupes'],
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

export function scenarioOrDie(name: string): Scenario {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`unknown scenario '${name}'; one of ${SCENARIO_NAMES.join(', ')}`);
  return s;
}
