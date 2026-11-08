// Mirror / repeat duplicate conflicts reuse the first ruling (rows from the first two-laptop
// maincloud run, where Nemotron reversed itself between conflicts 1 and 2).
import { describe, expect, it, vi } from 'vitest';
import type { rows } from '@contract/client';
import type { LLM } from '@contract/llm';
import { handleConflict, repeatDecision, type Deps, type Tables } from '../src/live.ts';

const at = (micros: bigint) => ({ microsSinceUnixEpoch: micros }) as rows.Conflict['createdAt'];
const FORMAT = 'src/format.ts#formatDate';
const DATES = 'src/billing/dates.ts#formatDate';

const conflict = (id: bigint, over: Partial<rows.Conflict>): rows.Conflict => ({
  id,
  kind: 'duplicate',
  symbolId: FORMAT,
  agentA: 'agent-b',
  agentB: 'agent-a',
  details: '',
  status: 'resolved',
  createdAt: at(100n + id),
  resolvedAt: undefined,
  ...over,
});

// Conflict 1: agent-a's planned dates.ts formatter duplicates agent-b's format.ts one.
const c1 = conflict(1n, {
  details: `agent-a plans to create ${DATES}, which duplicates agent-b's planned ${FORMAT} (same normalized name 'formatdate').`,
});
// Conflict 2, its mirror: agent-b's format.ts formatter duplicates agent-a's dates.ts one.
const c2 = conflict(2n, {
  symbolId: DATES,
  agentA: 'agent-a',
  agentB: 'agent-b',
  status: 'open',
  details: `agent-b plans to create ${FORMAT}, which duplicates agent-a's planned ${DATES} (same normalized name 'formatdate').`,
});
// Conflict 3, a repeat of 1.
const c3 = conflict(3n, { status: 'open', details: `agent-a plans to create ${DATES}, which duplicates existing ${FORMAT}.` });

const d1: rows.Decision = {
  id: 1n,
  conflictId: 1n,
  ownerAgent: 'agent-b',
  instructionsA: 'Use formatDate from src/format.ts in buildReceipt.', // to c1.agentA = agent-b
  instructionsB: 'Reuse formatDate from src/format.ts instead of creating src/billing/dates.ts.', // to agent-a
  reason: "agent-b's formatDate was planned first.",
  createdAt: at(150n),
};

const run = (started: bigint, ended?: bigint) =>
  ({ id: started, mode: 'with_contract', seed: 7, startedAt: at(started), endedAt: ended === undefined ? undefined : at(ended) }) as rows.Run;

const tables = (over: Partial<Tables> = {}): Tables => ({
  plans: [], planItems: [], tasks: [], changes: [],
  conflicts: [c1, c2, c3],
  decisions: [d1],
  runs: [run(50n)],
  ...over,
});

describe('repeatDecision', () => {
  it('maps the first ruling onto its mirror conflict, by agent', () => {
    const r = repeatDecision(c2, tables())!;
    expect(r.earlier).toBe(1n);
    expect(r.decision.owner_agent).toBe('agent-b');
    // c2.agentA is agent-a: it gets what conflict 1 told agent-a.
    expect(r.decision.instructions_a).toBe(d1.instructionsB);
    expect(r.decision.instructions_b).toBe(d1.instructionsA);
    expect(r.decision.reason).toMatch(/^Same ruling as conflict #1/);
  });

  it('reuses the ruling for a repeat on the same function', () => {
    const r = repeatDecision(c3, tables())!;
    expect(r.decision.owner_agent).toBe('agent-b');
    expect(r.decision.instructions_a).toBe(d1.instructionsA);
    expect(r.decision.instructions_b).toBe(d1.instructionsB);
  });

  it('uses the first ruling when several exist', () => {
    const d2 = { ...d1, id: 2n, conflictId: 2n, ownerAgent: 'agent-a', reason: 'reversed' };
    expect(repeatDecision(c3, tables({ decisions: [d2, d1] }))!.earlier).toBe(1n);
  });

  it('ignores other kinds, other agents, unrelated functions and earlier runs', () => {
    expect(repeatDecision({ ...c2, kind: 'broken_dependency' }, tables())).toBeUndefined();
    expect(repeatDecision({ ...c3, agentB: 'agent-c' }, tables())).toBeUndefined();
    expect(repeatDecision({ ...c3, symbolId: 'src/x.ts#formatMoney', details: 'other' }, tables())).toBeUndefined();
    // Conflict 1 was before the current run started.
    expect(repeatDecision(c2, tables({ runs: [run(10n, 20n), run(102n)] }))).toBeUndefined();
  });

  it('returns nothing when there is no earlier decision', () => {
    expect(repeatDecision(c2, tables({ decisions: [] }))).toBeUndefined();
    expect(repeatDecision(c1, tables())).toBeUndefined(); // its own decision doesn't count
  });
});

describe('handleConflict with a mirror duplicate', () => {
  it('writes the earlier ruling without calling the model or logging tokens', async () => {
    const decide = vi.fn();
    const resolveConflict = vi.fn(async () => {});
    const logTokens = vi.fn(async () => {});
    const logs: string[] = [];
    const deps: Deps = {
      llm: { decide, runWorker: vi.fn() } as unknown as LLM,
      reducers: { markConflictResolving: vi.fn(async () => {}), resolveConflict, dismissConflict: vi.fn(async () => {}) },
      tables: () => tables(),
      getContext: async () => [],
      logTokens,
      log: (m) => void logs.push(m),
    };

    await handleConflict(deps, c2);

    expect(decide).not.toHaveBeenCalled();
    expect(logTokens).not.toHaveBeenCalled();
    expect(resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ conflictId: 2n, ownerAgent: 'agent-b', instructionsA: d1.instructionsB, instructionsB: d1.instructionsA }),
    );
    expect(logs[0]).toMatch(/prior_decision \(#1\)/);
  });
});
