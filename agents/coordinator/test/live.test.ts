import { describe, expect, it, vi } from 'vitest';
import type { rows } from '@contract/client';
import type { LLM } from '@contract/llm';
import { buildConflictContext, createQueue, handleConflict, priorDecisions, takenBy, type Deps, type Tables } from '../src/live.ts';
import { buildPrompt } from '../src/decide.ts';

const ts = {} as rows.Conflict['createdAt'];

function conflict(id: bigint, over: Partial<rows.Conflict> = {}): rows.Conflict {
  return {
    id,
    kind: 'broken_dependency',
    symbolId: 'src/billing/fees.ts#calculateFee',
    agentA: 'agent-a',
    agentB: 'agent-b',
    details: 'agent-a changed calculateFee, which agent-b depends on',
    status: 'open',
    createdAt: ts,
    resolvedAt: undefined,
    ...over,
  };
}

const tables: Tables = {
  plans: [
    { id: 1n, agentId: 'agent-a', taskId: 10n, summary: 'old plan', active: false, createdAt: ts },
    { id: 2n, agentId: 'agent-a', taskId: 10n, summary: 'Late fees on invoices', active: true, createdAt: ts },
    { id: 3n, agentId: 'agent-b', taskId: 11n, summary: 'Receipt at checkout', active: true, createdAt: ts },
  ],
  planItems: [
    { id: 1n, planId: 2n, agentId: 'agent-a', symbolId: 'src/billing/fees.ts#calculateFee', intent: 'modify', signature: undefined },
    { id: 2n, planId: 3n, agentId: 'agent-b', symbolId: 'src/billing/fees.ts#calculateFee', intent: 'depend', signature: undefined },
    { id: 3n, planId: 1n, agentId: 'agent-a', symbolId: 'src/old.ts#x', intent: 'create', signature: undefined },
  ],
  tasks: [
    { id: 10n, title: 'Late fees', description: 'Add late fees, round half-up.', agentId: 'agent-a', status: 'in_progress', attempt: 1, runId: 1n },
    { id: 11n, title: 'Receipt', description: 'Add a receipt.', agentId: 'agent-b', status: 'paused', attempt: 1, runId: 1n },
  ],
  changes: [
    { id: 1n, agentId: 'agent-a', symbolId: 'src/billing/fees.ts#calculateFee', kind: 'behavior', oldSignature: 'calculateFee(a: number): number', newSignature: 'calculateFee(a: number): number', description: 'first', createdAt: ts },
    { id: 5n, agentId: 'agent-a', symbolId: 'src/billing/fees.ts#calculateFee', kind: 'behavior', oldSignature: 'calculateFee(amountCents: number): number', newSignature: 'calculateFee(amountCents: number): number', description: 'now rounds half-up', createdAt: ts },
    { id: 9n, agentId: 'agent-b', symbolId: 'src/other.ts#y', kind: 'behavior', oldSignature: undefined, newSignature: undefined, description: 'other', createdAt: ts },
  ],
};

const at = (micros: bigint) => ({ microsSinceUnixEpoch: micros }) as rows.Conflict['createdAt'];

describe('priorDecisions', () => {
  const dup = (id: bigint, created: bigint, over: Partial<rows.Conflict> = {}) =>
    conflict(id, { kind: 'duplicate', symbolId: 'src/format.ts#formatDate', agentA: 'agent-b', agentB: 'agent-a', status: 'resolved', createdAt: at(created), ...over });
  const decision = (id: bigint, conflictId: bigint, owner: string): rows.Decision => ({
    id, conflictId, ownerAgent: owner, instructionsA: `A${id}`, instructionsB: `B${id}`, reason: 'r', createdAt: at(0n),
  });
  const t: Tables = {
    plans: [], planItems: [], tasks: [], changes: [],
    runs: [
      { id: 1n, mode: 'with_contract', seed: 7, startedAt: at(0n), endedAt: at(50n) },
      { id: 2n, mode: 'with_contract', seed: 7, startedAt: at(100n), endedAt: undefined },
    ],
    conflicts: [
      dup(1n, 10n), // earlier run
      dup(4n, 110n),
      dup(6n, 120n, { agentA: 'agent-c', agentB: 'agent-d' }), // other agents
      dup(8n, 130n), // later than the conflict being decided
    ],
    decisions: [decision(1n, 1n, 'agent-a'), decision(2n, 4n, 'agent-b'), decision(3n, 6n, 'agent-c'), decision(4n, 8n, 'agent-a')],
  };

  it('lists only earlier decisions from the current run that involve either agent', () => {
    const out = priorDecisions(conflict(5n, { kind: 'duplicate', createdAt: at(115n) }), t);
    expect(out).toEqual([
      '#4 duplicate on src/format.ts#formatDate: owner agent-b; told agent-b: "A2"; told agent-a: "B2"',
    ]);
  });

  it('puts them in the prompt, and leaves the prompt alone when there are none', () => {
    const ctx = buildConflictContext(conflict(5n, { kind: 'duplicate', createdAt: at(115n) }), t);
    expect(buildPrompt(ctx)).toContain('Earlier decisions this run');
    expect(buildPrompt(ctx)).toContain('#4 duplicate on src/format.ts#formatDate: owner agent-b');
    expect(buildPrompt(buildConflictContext(conflict(1n), tables))).not.toContain('Earlier decisions');
  });
});

describe('buildConflictContext', () => {
  it('uses the active plan, its items, the task and the newest change', () => {
    const ctx = buildConflictContext(conflict(1n), tables, {
      id: 'src/billing/fees.ts#calculateFee',
      signature: 'calculateFee(amountCents: number): number',
      behaviorNote: '',
      callers: ['src/checkout/total.ts#checkoutTotal'],
      callees: [],
    });
    expect(ctx.planA).toBe('Late fees on invoices | Task: Add late fees, round half-up. | Plan items: modify src/billing/fees.ts#calculateFee');
    expect(ctx.planB).toBe('Receipt at checkout | Task: Add a receipt. | Plan items: depend src/billing/fees.ts#calculateFee');
    expect(ctx.oldSignature).toBe('calculateFee(amountCents: number): number');
    expect(ctx.description).toContain('now rounds half-up');
    expect(ctx.description).toContain('Callers: src/checkout/total.ts#checkoutTotal');
    expect(ctx.firstClaimant).toBe('agent-a');
    expect(ctx.kind).toBe('broken_dependency');
  });

  it('falls back to conflict details without a change row', () => {
    const ctx = buildConflictContext(conflict(1n, { symbolId: 'src/x.ts#nope' }), tables);
    expect(ctx.description).toBe('agent-a changed calculateFee, which agent-b depends on');
    expect(ctx.oldSignature).toBeUndefined();
  });
});

function fakeDeps(output: unknown): Deps & { calls: string[] } {
  const calls: string[] = [];
  const llm: LLM = {
    decide: vi.fn(async () => ({ output, usage: { prompt_tokens: 1, completion_tokens: 1, cache_read_tokens: 0, cost_usd: 0 } })) as LLM['decide'],
    runWorker: async () => {
      throw new Error('not used');
    },
  };
  const deps = {
    calls,
    llm,
    reducers: {
      markConflictResolving: vi.fn(async ({ conflictId }: { conflictId: bigint }) => void calls.push(`mark ${conflictId}`)),
      resolveConflict: vi.fn(async (a: { conflictId: bigint; ownerAgent: string }) => void calls.push(`resolve ${a.conflictId} ${a.ownerAgent}`)),
      dismissConflict: vi.fn(async ({ conflictId }: { conflictId: bigint }) => void calls.push(`dismiss ${conflictId}`)),
    },
    tables: () => tables,
    getContext: async () => [],
    logTokens: async () => {},
    log: () => {},
  };
  return deps;
}

describe('coordinator queue', () => {
  it('handles a conflict inserted twice only once', async () => {
    const deps = fakeDeps({ action: 'resolve', owner_agent: 'agent-a', instructions_a: 'keep', instructions_b: 'adapt', reason: 'r' });
    const q = createQueue((c) => handleConflict(deps, c));
    q.enqueue(conflict(7n));
    q.enqueue(conflict(7n));
    await q.idle();
    expect(deps.calls).toEqual(['mark 7', 'resolve 7 agent-a']);
  });

  it('falls back to agent-a when the model returns junk', async () => {
    const deps = fakeDeps({ nonsense: true });
    await handleConflict(deps, conflict(8n));
    expect(deps.llm.decide).toHaveBeenCalledTimes(2);
    expect(deps.calls).toEqual(['mark 8', 'resolve 8 agent-a']);
  });

  it('skips a conflict it cannot mark resolving', async () => {
    const deps = fakeDeps({});
    deps.reducers.markConflictResolving = async () => {
      throw new Error('conflict 9 is resolved, not open');
    };
    await handleConflict(deps, conflict(9n));
    expect(deps.calls).toEqual([]);
  });

  it('dismisses when the model says so', async () => {
    const deps = fakeDeps({ action: 'dismiss', owner_agent: 'agent-b', instructions_a: 'x', instructions_b: 'y', reason: 'no clash' });
    await handleConflict(deps, conflict(10n));
    expect(deps.calls).toEqual(['mark 10', 'dismiss 10']);
  });
});

describe('takenBy (standby: is another coordinator live?)', () => {
  it('names the machine from the service-lock refusal', () => {
    const e = new Error('coordinator is already running on laptop-1; stop it there first (or wait 30 s after it crashed)');
    expect(takenBy(e)).toBe('laptop-1');
  });

  it('names the machine from the register_agent refusal', () => {
    const e = new Error("agent id 'coordinator' is already linked to another identity (registered from laptop-2, heartbeat 12 s ago); use a different id");
    expect(takenBy(e)).toBe('laptop-2');
  });

  it('falls back to a generic name for an older server module', () => {
    expect(takenBy(new Error("agent id 'coordinator' is already linked to another identity"))).toBe('another laptop');
  });

  it('is undefined for any other error', () => {
    expect(takenBy(new Error('no response from wss://x within 10000 ms'))).toBeUndefined();
    expect(takenBy('connection closed')).toBeUndefined();
  });
});
