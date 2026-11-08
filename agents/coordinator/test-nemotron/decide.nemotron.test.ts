// Layer 2 (docs/nemotron-coordinator-plan.md): the real Nemotron API on the two planted
// conflicts, no database. Needs NVIDIA_API_KEY (read from the repo's .env); skipped without it.
// Run: npm run test:nemotron -w @contract/coordinator
import { describe, expect, it } from 'vitest';
import { NemotronLLM, type Usage } from '@contract/llm';
import { decideConflict } from '../src/decide.ts';
import { DUPLICATE_CONFLICT, FEE_CONFLICT } from '../src/fixtures.ts';

const RUNS = Number(process.env.NEMOTRON_RUNS ?? 3);

/** Code-like text in an instruction: Math.*, arrows, braces, `x * 10`-style arithmetic. */
const CODE = /Math\.|=>|[{}]|\bconst\b|[+*/]\s*\d|\d\s*[+*/]/;

function expectNoCode(d: { instructions_a: string; instructions_b: string }) {
  expect(d.instructions_a).not.toMatch(CODE);
  expect(d.instructions_b).not.toMatch(CODE);
}
const hasKey = !!process.env.NVIDIA_API_KEY;

describe.skipIf(!hasKey)(`Nemotron coordinator decisions (${process.env.NVIDIA_COORDINATOR_MODEL ?? 'default model'}, ${RUNS} runs each)`, () => {
  const llm = hasKey ? new NemotronLLM() : (undefined as never);

  async function run(c: typeof FEE_CONFLICT) {
    const usage: Usage[] = [];
    const t0 = Date.now();
    const r = await decideConflict(llm, c, (u) => void usage.push(u));
    return { ...r, ms: Date.now() - t0, usage };
  }

  it('broken_dependency on calculateFee: agent-a keeps the rounding, agent-b adapts', async () => {
    for (let i = 0; i < RUNS; i++) {
      const r = await run(FEE_CONFLICT);
      console.log(`[fee #${i + 1}] ${r.source} ${r.ms} ms`, r.usage.at(-1), r.decision);
      expect(r.source).toBe('model'); // the fallback rule counts as a failure here
      expect(r.decision.action).toBe('resolve');
      expect(r.decision.owner_agent).toBe('agent-a');
      expect(r.decision.instructions_a.trim()).not.toBe('');
      expect(r.decision.instructions_b.trim()).not.toBe('');
      expectNoCode(r.decision);
      expect(r.usage.length).toBeGreaterThan(0);
      expect(r.usage[0].prompt_tokens).toBeGreaterThan(0);
      expect(r.ms).toBeLessThan(30_000);
    }
  });

  it('duplicate formatter: agent-a owns it, agent-b is told to reuse formatDate', async () => {
    for (let i = 0; i < RUNS; i++) {
      const r = await run(DUPLICATE_CONFLICT);
      console.log(`[dup #${i + 1}] ${r.source} ${r.ms} ms`, r.usage.at(-1), r.decision);
      expect(r.source).toBe('model');
      expect(r.decision.owner_agent).toBe('agent-a');
      expect(r.decision.instructions_b).toMatch(/formatDate/);
      expectNoCode(r.decision);
    }
  });
});
