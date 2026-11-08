// Coordinator (spec section 12). Owner: coordinator + mapper.
// npm run coordinator            -> subscribes to open conflicts (needs the client)
// npm run coordinator -- --demo  -> runs one decision on the planted calculateFee conflict
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createLLM } from '@contract/llm';
import { decideConflict, type ConflictContext } from './decide.ts';

// npm -w runs us inside our own folder, so load the monorepo's .env explicitly.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'), quiet: true });

const { values } = parseArgs({ options: { demo: { type: 'boolean', default: false } } });
const llm = createLLM();

if (values.demo) {
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
  // TODO(coordinator): connect as 'coordinator', subscribe to conflict WHERE status = 'open',
  // mark each 'resolving', gather context (plans, change, getContext), decideConflict(),
  // then resolve_conflict / dismiss_conflict and logTokens(purpose 'coordination').
  console.log('coordinator: live mode needs @contract/client; try --demo');
}
