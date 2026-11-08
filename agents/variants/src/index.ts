// Variant agent: generates design variants for #/variants from jobs queued in SpacetimeDB.
// npm run variants-agent
//
// Model: VARIANTS_PROVIDER (else LLM_PROVIDER): claude-code | nemotron. VARIANTS_MODEL picks the model.
// VARIANTS_REPO: the checkout to write and commit variants in (default: this repository). Its dev server shows a
// new variant at once (Vite hot reload); other laptops and deployed builds get it after a pull or deploy.
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLLM, DEFAULT_NEMOTRON_MODEL } from '@contract/llm';
import { runLive } from './live.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: resolve(root, '.env'), quiet: true });

const provider = process.env.VARIANTS_PROVIDER || process.env.LLM_PROVIDER || 'claude-code';
const model = process.env.VARIANTS_MODEL || undefined;
const agentModel = `${provider}:${model ?? (provider === 'nemotron' ? DEFAULT_NEMOTRON_MODEL : 'default')}`;
console.log(`[variants] model: ${agentModel}`);

await runLive(createLLM(provider), { repo: resolve(process.env.VARIANTS_REPO || root), model, agentModel }).catch((e: unknown) => {
  console.error(`[variants] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
