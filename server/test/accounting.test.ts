// log_tokens, mark_attempt_wasted, log_saving, cache_summary, record_cache_hit (spec section 7).
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, mod, all, type Harness, type Who, asOperator } from './helpers';

function logTokens(t: Harness, overrides: Partial<{ agent_id: string; task_id: bigint; attempt: number; purpose: string; prompt_tokens: number; cache_read_tokens: number; cost_usd: number; who: Who }> = {}) {
  const { who = 'worker-a', ...rest } = overrides;
  t.as(who, (ctx) =>
    mod.log_tokens(ctx, {
      run_id: 1n,
      agent_id: 'agent-a',
      task_id: 10n,
      attempt: 1,
      purpose: 'code',
      prompt_tokens: 81_515,
      completion_tokens: 1_200,
      cache_read_tokens: 40_000,
      cost_usd: 0.0812,
      ...rest,
    }),
  );
}

describe('log_tokens', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
    register(t, 'coordinator');
  });

  it('inserts a token_usage row, not wasted', () => {
    // Arrange
    const purpose = 'plan';

    // Act
    logTokens(t, { purpose });

    // Assert
    const [row] = all(t.db.tokenUsage.iter());
    expect(row).toMatchObject({
      run_id: 1n,
      agent_id: 'agent-a',
      task_id: 10n,
      attempt: 1,
      purpose: 'plan',
      prompt_tokens: 81_515,
      completion_tokens: 1_200,
      cache_read_tokens: 40_000,
      cost_usd: 0.0812,
      wasted: false,
    });
    expect(row.created_at.microsSinceUnixEpoch).toBe(t.now());
  });

  it('rejects more cache-read tokens than prompt tokens', () => {
    // Arrange
    const overrides = { prompt_tokens: 100, cache_read_tokens: 101 };

    // Act
    const act = () => logTokens(t, overrides);

    // Assert
    expect(act).toThrow(/cache_read_tokens exceeds prompt_tokens/);
    expect(all(t.db.tokenUsage.iter())).toHaveLength(0);
  });

  it.each([-0.01, Number.NaN])('rejects cost_usd %s', (cost_usd) => {
    // Act
    const act = () => logTokens(t, { cost_usd });

    // Assert
    expect(act).toThrow(/cost_usd must be a non-negative number/);
  });

  it.each(['plan', 'code', 'context', 'test_fix', 'merge_fix', 'coordination'])('accepts purpose %s', (purpose) => {
    // Arrange
    const who: Who = purpose === 'coordination' ? 'coordinator' : 'worker-a';
    const agent_id = purpose === 'coordination' ? 'coordinator' : 'agent-a';

    // Act
    logTokens(t, { purpose, who, agent_id });

    // Assert
    expect(all(t.db.tokenUsage.iter())[0].purpose).toBe(purpose);
  });

  it('rejects an unknown purpose', () => {
    // Arrange
    const purpose = 'triage'; // stretch value, not in the MVP schema

    // Act
    const act = () => logTokens(t, { purpose });

    // Assert
    expect(act).toThrow(/invalid token purpose 'triage'/);
    expect(all(t.db.tokenUsage.iter())).toHaveLength(0);
  });

  it("rejects logging for another identity's agent", () => {
    // Arrange
    const who: Who = 'coordinator';

    // Act
    const act = () => logTokens(t, { who, agent_id: 'agent-a' });

    // Assert
    expect(act).toThrow(/different identity/);
  });

  it('indexes rows by run_id', () => {
    // Arrange
    logTokens(t);
    t.as('worker-a', (ctx) =>
      mod.log_tokens(ctx, {
        run_id: 2n,
        agent_id: 'agent-a',
        task_id: 10n,
        attempt: 1,
        purpose: 'code',
        prompt_tokens: 1,
        completion_tokens: 1,
        cache_read_tokens: 0,
        cost_usd: 0,
      }),
    );

    // Act
    const run2 = all(t.db.tokenUsage.run_id.filter(2n));

    // Assert
    expect(run2).toHaveLength(1);
    expect(run2[0].prompt_tokens).toBe(1);
  });
});

describe('mark_attempt_wasted', () => {
  let t: Harness;
  let taskId: bigint;
  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 7 }));
    const runId = all(t.db.run.iter())[0].id; // read outside the transaction (the harness deadlocks otherwise)
    asOperator(t, (ctx) => mod.create_task(ctx, { title: 'x', description: 'x', agent_id: 'agent-a', run_id: runId }));
    taskId = all(t.db.task.iter())[0].id;
  });

  it("marks only that task's rows for that attempt and bumps the attempt", () => {
    // Arrange
    logTokens(t, { task_id: taskId, attempt: 1 });
    logTokens(t, { task_id: taskId, attempt: 1, purpose: 'test_fix' });
    logTokens(t, { task_id: taskId, attempt: 2 });
    logTokens(t, { task_id: 999n, attempt: 1 });

    // Act
    asOperator(t, (ctx) => mod.mark_attempt_wasted(ctx, { task_id: taskId, attempt: 1 }));

    // Assert
    const rows = all(t.db.tokenUsage.iter()).map((r) => [r.task_id, r.attempt, r.wasted]);
    expect(rows).toEqual([
      [taskId, 1, true],
      [taskId, 1, true],
      [taskId, 2, false],
      [999n, 1, false],
    ]);
    expect(t.db.task.id.find(taskId)!.attempt).toBe(2);
  });

  it('does not move the attempt backwards', () => {
    // Arrange
    asOperator(t, (ctx) => mod.mark_attempt_wasted(ctx, { task_id: taskId, attempt: 1 }));
    asOperator(t, (ctx) => mod.mark_attempt_wasted(ctx, { task_id: taskId, attempt: 2 }));

    // Act
    asOperator(t, (ctx) => mod.mark_attempt_wasted(ctx, { task_id: taskId, attempt: 1 }));

    // Assert
    expect(t.db.task.id.find(taskId)!.attempt).toBe(3);
  });

  it('is a no-op for an unknown task', () => {
    // Arrange
    logTokens(t, { task_id: 555n });

    // Act
    const act = () => asOperator(t, (ctx) => mod.mark_attempt_wasted(ctx, { task_id: 555n, attempt: 1 }));

    // Assert
    expect(act).not.toThrow();
    expect(all(t.db.tokenUsage.iter())[0].wasted).toBe(true);
  });
});

describe('log_saving', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
  });

  it.each(['early_stop', 'reuse', 'context_slice', 'cache_hit'])('records a %s saving', (kind) => {
    // Arrange
    const args = { run_id: 1n, agent_id: 'agent-b', kind, tokens_avoided_est: 4_000, note: 'n' };

    // Act
    t.as('worker-b', (ctx) => mod.log_saving(ctx, args));

    // Assert
    const [row] = all(t.db.tokenSaving.iter());
    expect(row).toMatchObject(args);
    expect(row.created_at.microsSinceUnixEpoch).toBe(t.now());
  });

  it('rejects an unknown kind', () => {
    // Arrange
    const kind = 'auto_resolve'; // stretch (Jev) value

    // Act
    const act = () =>
      t.as('worker-b', (ctx) =>
        mod.log_saving(ctx, { run_id: 1n, agent_id: 'agent-b', kind, tokens_avoided_est: 1, note: '' }),
      );

    // Assert
    expect(act).toThrow(/invalid saving kind/);
  });
});

describe('cache_summary / record_cache_hit', () => {
  let t: Harness;
  const KEY = 'src/billing/fees.ts:abc123';
  const put = (summary: string, summary_tokens = 50) =>
    t.as('worker-a', (ctx) => mod.cache_summary(ctx, { key: KEY, summary, summary_tokens }));
  const hit = (key = KEY) => t.as('worker-b', (ctx) => mod.record_cache_hit(ctx, { key }));

  beforeEach(() => {
    t = makeHarness();
  });

  it('writes a new summary with 0 hits', () => {
    // Arrange
    const summary = 'calculateFee rounds down';

    // Act
    put(summary);

    // Assert
    expect(t.db.summaryCache.key.find(KEY)).toEqual({ key: KEY, summary, summary_tokens: 50, hits: 0 });
  });

  it('counts hits', () => {
    // Arrange
    put('s');

    // Act
    hit();
    hit();
    hit();

    // Assert
    expect(t.db.summaryCache.key.find(KEY)!.hits).toBe(3);
  });

  it('overwriting a summary keeps its hit count', () => {
    // Arrange
    put('old');
    hit();

    // Act
    put('new', 70);

    // Assert
    expect(t.db.summaryCache.key.find(KEY)).toMatchObject({ summary: 'new', summary_tokens: 70, hits: 1 });
  });

  it('a hit on a missing key is a no-op', () => {
    // Arrange
    const key = 'missing:000';

    // Act
    const act = () => hit(key);

    // Assert
    expect(act).not.toThrow();
    expect(all(t.db.summaryCache.iter())).toHaveLength(0);
  });
});
