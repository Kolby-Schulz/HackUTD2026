// Coordinator (spec section 12). Owner: coordinator + mapper.
// npm run coordinator            -> subscribes to open conflicts (needs the client)
// npm run coordinator -- --demo  -> runs one decision on the planted calculateFee conflict
// npm run coordinator -- --demo duplicate -> runs one decision on the planted date-formatter duplicate
//
// Model: COORDINATOR_PROVIDER (else LLM_PROVIDER): claude-code | nemotron.
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createLLM } from '@contract/llm';
import { decideConflict } from './decide.ts';
import { DUPLICATE_CONFLICT, FEE_CONFLICT } from './fixtures.ts';
import { runLive } from './live.ts';
import { coordinatorModel, coordinatorProvider } from './provider.ts';

// npm -w runs us inside our own folder, so load the monorepo's .env explicitly.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'), quiet: true });

const { values, positionals } = parseArgs({ options: { demo: { type: 'boolean', default: false } }, allowPositionals: true });
const provider = coordinatorProvider();
const model = coordinatorModel(provider);
const llm = createLLM(provider);
console.log(`[coordinator] model: ${model}`);

if (values.demo) {
  const c = positionals[0] === 'duplicate' ? DUPLICATE_CONFLICT : FEE_CONFLICT;
  const t0 = Date.now();
  const r = await decideConflict(llm, c, (u) => console.log('usage', u));
  console.log(r.source, `${Date.now() - t0} ms`, JSON.stringify(r.decision, null, 2));
  if (r.decision.owner_agent !== 'agent-a') console.warn('expected owner agent-a');
} else {
  await runLive(llm, { model }).catch((e: unknown) => {
    console.error(`[coordinator] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
