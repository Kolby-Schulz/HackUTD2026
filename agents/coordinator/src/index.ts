// Coordinator (spec section 12). Owner: coordinator + mapper.
// npm run coordinator            -> subscribes to open conflicts (needs the client)
// npm run coordinator -- --demo  -> runs one decision on the planted calculateFee conflict
// npm run coordinator -- --demo duplicate -> runs one decision on the planted date-formatter duplicate
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createLLM } from '@contract/llm';
import { decideConflict, type ConflictContext } from './decide.ts';
import { runLive } from './live.ts';

// npm -w runs us inside our own folder, so load the monorepo's .env explicitly.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'), quiet: true });

const { values, positionals } = parseArgs({ options: { demo: { type: 'boolean', default: false } }, allowPositionals: true });
const llm = createLLM();

const TASK_1 = 'Add late fees to invoices. Fees must round half-up to the cent. Show the due date on the invoice formatted like `Nov 7, 2026`.';
const TASK_2 = 'Add a receipt to checkout showing the total with fees and the order date formatted like `Nov 7, 2026`.';

if (values.demo && positionals[0] === 'duplicate') {
  const c: ConflictContext = {
    kind: 'duplicate',
    symbolId: 'src/checkout/receipt.ts#formatOrderDate',
    agentA: 'agent-a',
    agentB: 'agent-b',
    planA: `Late fees on invoices | Task: ${TASK_1} | Plan items: create src/billing/invoice.ts#formatDate (formatDate(d: Date): string)`,
    planB: `Receipt at checkout | Task: ${TASK_2} | Plan items: create src/checkout/receipt.ts#formatOrderDate (formatOrderDate(date: Date): string)`,
    newSignature: 'formatOrderDate(date: Date): string',
    description: 'agent-b plans formatOrderDate(date: Date): string, the same type as agent-a\'s planned src/billing/invoice.ts#formatDate(d: Date): string; both format dates like `Nov 7, 2026`.',
    firstClaimant: 'agent-a',
  };
  const r = await decideConflict(llm, c, (u) => console.log('usage', u));
  console.log(r.source, JSON.stringify(r.decision, null, 2));
  if (r.decision.owner_agent !== 'agent-a') console.warn('expected owner agent-a');
} else if (values.demo) {
  const c: ConflictContext = {
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
  const r = await decideConflict(llm, c, (u) => console.log('usage', u));
  console.log(r.source, JSON.stringify(r.decision, null, 2));
} else {
  await runLive(llm);
}
