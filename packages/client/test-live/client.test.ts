// Live tests for connect() and every ContractClient method: real WebSocket connections,
// one identity per simulated laptop, against a running server (see README.md).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, ClaimedError, DbConnection, type ContractClient, type AgentStatus, type Instruction } from '../src/index';
import { LIVE_DB, LIVE_WS } from './env';

const RUN = Math.random().toString(36).slice(2, 8);
const id = (n: string) => `${n}-${RUN}`;
const FEES = 'src/billing/fees.ts#calculateFee';
const CHECKOUT = 'src/checkout/checkout.ts#checkout';
const DATE = 'src/utils/date.ts#formatDate';

// A demo-repo-like folder so summaries and savings estimates can read real files.
const repoDir = mkdtempSync(join(tmpdir(), 'contract-client-'));
const FEES_SRC = `export function calculateFee(amountCents: number): number {\n${'  // fee rules\n'.repeat(80)}  return Math.floor(amountCents * 0.029);\n}\n`;
mkdirSync(join(repoDir, 'src/billing'), { recursive: true });
mkdirSync(join(repoDir, 'src/checkout'), { recursive: true });
writeFileSync(join(repoDir, 'src/billing/fees.ts'), FEES_SRC);
writeFileSync(join(repoDir, 'src/checkout/checkout.ts'), 'export function checkout() {}\n'.repeat(40));

const agentInfo = (agentId: string) => ({
  id: agentId,
  name: agentId,
  ownerDev: 'live-test',
  machine: 'ci',
  model: 'claude-code',
  tokenBudget: 200_000,
});
const opts = (agentId: string, extra: object = {}) => ({ host: LIVE_WS, dbName: LIVE_DB, agent: agentInfo(agentId), repoDir, ...extra });

/** A raw observer/admin connection (sees every table; plays mapper, seed script and coordinator). */
function rawConnect(token?: string): Promise<{ conn: DbConnection; token: string }> {
  return new Promise((res, rej) => {
    const conn: DbConnection = DbConnection.builder()
      .withUri(LIVE_WS)
      .withDatabaseName(LIVE_DB)
      .withToken(token)
      .onConnect((_c, _i, tok) =>
        conn
          .subscriptionBuilder()
          .onApplied(() => res({ conn, token: tok }))
          .subscribeToAllTables(),
      )
      .onConnectError((_c, e) => rej(e))
      .build();
  });
}

async function waitFor<T>(check: () => T | undefined | null | false, ms = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const clients: ContractClient[] = [];
let admin: DbConnection;
let a: ContractClient;
let b: ContractClient;
let runId: bigint;

beforeAll(async () => {
  admin = (await rawConnect()).conn;
  // The admin connection also plays the coordinator (fixed id, spec section 7).
  await admin.reducers.registerAgent({ ...agentInfo('coordinator'), tokenBudget: 0n });
  await admin.reducers.upsertSymbols({
    file: 'src/billing/fees.ts',
    symbols: [{ id: FEES, name: 'calculateFee', kind: 'function', signature: 'calculateFee(amountCents: number): number', signatureHash: 'h1', behaviorNote: 'rounds down' }],
    edges: [],
  });
  await admin.reducers.upsertSymbols({
    file: 'src/checkout/checkout.ts',
    symbols: [{ id: CHECKOUT, name: 'checkout', kind: 'function', signature: 'checkout(cart: Cart): Receipt', signatureHash: 'h1', behaviorNote: '' }],
    edges: [{ callerId: CHECKOUT, calleeId: FEES }],
  });
  await admin.reducers.upsertSymbols({
    file: 'src/utils/date.ts',
    symbols: [{ id: DATE, name: 'formatDate', kind: 'function', signature: 'formatDate(d: Date): string', signatureHash: 'h1', behaviorNote: '' }],
    edges: [],
  });
  await admin.reducers.startRun({ mode: 'with_contract', seed: 7 });
  runId = (await waitFor(() => [...admin.db.run.iter()].find((r) => r.endedAt === undefined))).id;

  a = await connect(opts(id('agent-a')));
  b = await connect(opts(id('agent-b')));
  clients.push(a, b);
});

afterAll(async () => {
  for (const c of clients) await c.disconnect();
  admin.disconnect();
});

describe('connect()', () => {
  it('registers the agent with its info and returns its id and token', async () => {
    // Arrange
    const agentId = id('agent-a');

    // Act
    const row = await waitFor(() => admin.db.agent.id.find(agentId));

    // Assert
    expect(a.agentId).toBe(agentId);
    expect(a.token.length).toBeGreaterThan(20);
    expect(row).toMatchObject({ name: agentId, ownerDev: 'live-test', machine: 'ci', model: 'claude-code', tokenBudget: 200_000n, status: 'idle' });
  });

  it('rejects a second identity claiming a live agent id', async () => {
    // Arrange
    const thief = opts(id('agent-a'));

    // Act
    const act = connect(thief);

    // Assert
    await expect(act).rejects.toThrow(/already linked to another identity/);
  });

  it('a second process with the same token and noHeartbeat acts as the same agent (CONTRACT_TOKEN)', async () => {
    // Arrange
    const hook = await connect(opts(id('agent-a'), { token: a.token, noHeartbeat: true }));
    clients.push(hook);

    // Act
    await hook.reportChange(DATE, 'behavior', { description: 'hook-detected change' });

    // Assert
    const change = await waitFor(() => [...admin.db.change.iter()].find((c) => c.description === 'hook-detected change'));
    expect(change.agentId).toBe(id('agent-a'));
    expect(hook.token).toBe(a.token);
  });

  it('rejects an unknown database within the timeout', async () => {
    // Arrange
    const bad = { ...opts(id('agent-x')), dbName: `no-such-db-${RUN}`, timeoutMs: 5_000 };

    // Act
    const act = connect(bad);

    // Assert
    await expect(act).rejects.toThrow();
  });

  it('heartbeats every 15 s', async () => {
    // Arrange
    const before = admin.db.agent.id.find(id('agent-b'))!.lastHeartbeat.microsSinceUnixEpoch;

    // Act: wait just past one heartbeat interval.
    const after = await waitFor(() => {
      const t = admin.db.agent.id.find(id('agent-b'))!.lastHeartbeat.microsSinceUnixEpoch;
      return t > before ? t : undefined;
    }, 17_000);

    // Assert
    expect(after).toBeGreaterThan(before);
  }, 20_000);
});

describe('claims', () => {
  it('claim() takes a free symbol; another agent gets ClaimedError naming the holder', async () => {
    // Arrange
    const symbol = `src/claims.ts#c1_${RUN}`;

    // Act
    await a.claim(symbol, 60);
    const err = await b.claim(symbol, 60).catch((e: unknown) => e);

    // Assert
    expect(err).toBeInstanceOf(ClaimedError);
    expect(err).toMatchObject({ symbolId: symbol, holder: id('agent-a') });
    await waitFor(() => admin.db.claim.symbolId.find(symbol)?.agentId === id('agent-a'));
    await waitFor(() => [...admin.db.conflict.iter()].find((c) => c.symbolId === symbol && c.kind === 'claim_contention'));
  });

  it('release() frees it for the other agent', async () => {
    // Arrange
    const symbol = `src/claims.ts#c2_${RUN}`;
    await a.claim(symbol);

    // Act
    await a.release(symbol);
    await b.claim(symbol);

    // Assert (the observer connection gets the update a moment later)
    await waitFor(() => admin.db.claim.symbolId.find(symbol)?.agentId === id('agent-b'));
  });

  it("release() of a claim you don't hold rejects", async () => {
    // Arrange
    const symbol = `src/claims.ts#c3_${RUN}`;

    // Act
    const act = a.release(symbol);

    // Assert
    await expect(act).rejects.toThrow(/doesn't hold a claim/);
  });
});

describe('plans, changes and live pushes (Rule 1)', () => {
  it('pauses B and pushes the instruction; coordinator resolves; B resumes', async () => {
    // Arrange
    const statuses: AgentStatus[] = [];
    const pushed: Instruction[] = [];
    const offStatus = b.onStatusChange((s) => statuses.push(s));
    const offInstr = b.onInstruction((i) => pushed.push(i));
    await a.publishPlan(1n, 'half-up fees', [{ symbolId: FEES, intent: 'modify' }]);
    await b.publishPlan(2n, 'receipt', [{ symbolId: CHECKOUT, intent: 'modify' }]);

    // Act 1
    await a.reportChange(FEES, 'behavior', { description: 'rounds half-up' });
    await waitFor(() => pushed.length >= 1 && statuses.includes('paused'));

    // Assert 1
    expect(pushed[0]).toMatchObject({ agentId: id('agent-b'), acknowledged: false });
    expect(pushed[0].text).toContain('Pause and wait for the coordinator');
    expect(typeof pushed[0].conflictId).toBe('bigint');
    expect(b.pendingInstructions().map((i) => i.id)).toEqual([pushed[0].id]);

    // Act 2: coordinator resolves.
    await admin.reducers.resolveConflict({
      conflictId: pushed[0].conflictId!,
      ownerAgent: id('agent-a'),
      instructionsA: 'Keep half-up rounding.',
      instructionsB: 'Do not round again in checkout.',
      reason: 'A owns fees.',
    });
    await waitFor(() => pushed.length >= 2 && statuses.at(-1) === 'working');

    // Assert 2
    expect(pushed[1].text).toBe('Do not round again in checkout.');
    expect(statuses).toEqual(['paused', 'working']);
    offStatus();
    offInstr();
  });

  it('onStatusChange() ignores agent-row updates that keep the same status (e.g. heartbeats)', async () => {
    // Arrange: a second connection on B's token updates B's row without changing its status.
    const statuses: AgentStatus[] = [];
    const off = b.onStatusChange((s) => statuses.push(s));
    const sameIdentity = (await rawConnect(b.token)).conn;
    const before = admin.db.agent.id.find(id('agent-b'))!.lastHeartbeat.microsSinceUnixEpoch;

    // Act
    await sameIdentity.reducers.heartbeat({ agentId: id('agent-b') });
    await waitFor(() => admin.db.agent.id.find(id('agent-b'))!.lastHeartbeat.microsSinceUnixEpoch > before);
    await new Promise((r) => setTimeout(r, 100));

    // Assert
    expect(statuses).toEqual([]);
    off();
    sameIdentity.disconnect();
  });

  it('ack() clears pendingInstructions', async () => {
    // Arrange
    const pending = b.pendingInstructions();
    expect(pending.length).toBeGreaterThan(0);

    // Act
    for (const i of pending) await b.ack(i.id);

    // Assert
    await waitFor(() => b.pendingInstructions().length === 0);
    expect(admin.db.instruction.id.find(pending[0].id)!.acknowledged).toBe(true);
  });

  it('ack() of another agent’s instruction rejects', async () => {
    // Arrange
    const bInstr = [...admin.db.instruction.iter()].find((i) => i.agentId === id('agent-b'))!;

    // Act
    const act = a.ack(bInstr.id);

    // Assert
    await expect(act).rejects.toThrow(/different identity/);
  });

  it('unsubscribed callbacks stop firing', async () => {
    // Arrange
    const seen: Instruction[] = [];
    const off = b.onInstruction((i) => seen.push(i));
    off();
    await b.publishPlan(2n, 'depends on fees', [{ symbolId: FEES, intent: 'depend' }]);

    // Act
    await a.reportChange(FEES, 'signature', { newSignature: 'calculateFee(cents: number): number', description: 'renamed param' });
    await waitFor(() => b.pendingInstructions().length > 0);

    // Assert
    expect(seen).toHaveLength(0);
  });

  it('publishPlan() rejects unknown symbols and keeps the previous plan', async () => {
    // Arrange
    const before = [...admin.db.plan.iter()].filter((p) => p.agentId === id('agent-a') && p.active);

    // Act
    const act = a.publishPlan(1n, 'bad', [{ symbolId: 'src/nope.ts#ghost', intent: 'modify' }]);

    // Assert
    await expect(act).rejects.toThrow(/unknown symbol/);
    expect([...admin.db.plan.iter()].filter((p) => p.agentId === id('agent-a') && p.active)).toEqual(before);
  });
});

describe('token savers', () => {
  it('getContext() returns the slice and logs a context_slice saving', async () => {
    // Arrange
    const savingsBefore = [...admin.db.tokenSaving.iter()].length;

    // Act
    const ctx = await a.getContext([FEES], 1);

    // Assert
    expect(ctx.map((c) => c.id).sort()).toEqual([CHECKOUT, FEES].sort());
    expect(ctx.find((c) => c.id === FEES)!.callers).toEqual([CHECKOUT]);
    const saving = await waitFor(() => [...admin.db.tokenSaving.iter()].slice(savingsBefore).find((s) => s.kind === 'context_slice'));
    expect(saving).toMatchObject({ agentId: id('agent-a'), runId });
    expect(saving.tokensAvoidedEst).toBeGreaterThan(0);
  });

  it('findExisting() suggests formatDate for toDisplayDate(Date): string', async () => {
    // Arrange
    const q = { name: 'toDisplayDate', params: ['Date'], returns: 'string' };

    // Act
    const matches = await b.findExisting(q);

    // Assert
    expect(matches[0]).toMatchObject({ symbolId: DATE, score: 0.8 });
  });

  it('putSummary() then getSummary() returns it, counts a hit and logs a cache_hit saving', async () => {
    // Arrange
    await a.putSummary('src/billing/fees.ts', 'calculateFee: 2.9% fee, rounds down.', 12);
    await waitFor(() => [...admin.db.summaryCache.iter()].find((s) => s.key.startsWith('src/billing/fees.ts:')));

    // Act (B sees A's write once it reaches B's connection; until then it's a plain miss)
    let summary: string | undefined;
    for (const start = Date.now(); summary === undefined && Date.now() - start < 5_000; ) {
      summary = await b.getSummary('src/billing/fees.ts');
      if (summary === undefined) await new Promise((r) => setTimeout(r, 25));
    }

    // Assert
    expect(summary).toBe('calculateFee: 2.9% fee, rounds down.');
    const row = [...admin.db.summaryCache.iter()].find((s) => s.key.startsWith('src/billing/fees.ts:'))!;
    await waitFor(() => admin.db.summaryCache.key.find(row.key)!.hits === 1);
    await waitFor(() => [...admin.db.tokenSaving.iter()].find((s) => s.kind === 'cache_hit' && s.agentId === id('agent-b')));
  });

  it('getSummary() misses once the file content changes', async () => {
    // Arrange
    writeFileSync(join(repoDir, 'src/billing/fees.ts'), FEES_SRC + '\n// edited\n');

    // Act
    const summary = await b.getSummary('src/billing/fees.ts');

    // Assert
    expect(summary).toBeUndefined();
    writeFileSync(join(repoDir, 'src/billing/fees.ts'), FEES_SRC);
  });

  it('getSummary() of a file that does not exist is undefined; putSummary() of one rejects', async () => {
    // Arrange
    const file = 'src/missing.ts';

    // Act
    const got = await a.getSummary(file);
    const put = a.putSummary(file, 'x', 1);

    // Assert
    expect(got).toBeUndefined();
    await expect(put).rejects.toThrow(/can't read src\/missing.ts/);
  });
});

describe('accounting', () => {
  it('logTokens() writes to the open run with the Usage numbers', async () => {
    // Arrange
    const usage = { prompt_tokens: 81_515, completion_tokens: 1_200, cache_read_tokens: 40_000, cost_usd: 0.12 };

    // Act
    await a.logTokens(5n, 1, 'code', usage);

    // Assert
    const row = await waitFor(() => [...admin.db.tokenUsage.iter()].find((t) => t.taskId === 5n && t.agentId === id('agent-a')));
    expect(row).toMatchObject({
      runId,
      attempt: 1,
      purpose: 'code',
      promptTokens: 81_515,
      completionTokens: 1_200,
      cacheReadTokens: 40_000,
      costUsd: 0.12,
      wasted: false,
    });
  });

  it('logTokens() clamps cache reads to prompt tokens and bad costs to 0, so the row is never lost', async () => {
    // Arrange: an estimated usage from an aborted run can be inconsistent.
    const usage = { prompt_tokens: 100, completion_tokens: 5, cache_read_tokens: 250, cost_usd: Number.NaN, estimated: true };

    // Act
    await a.logTokens(8n, 1, 'code', usage);

    // Assert
    const row = await waitFor(() => [...admin.db.tokenUsage.iter()].find((t) => t.taskId === 8n));
    expect(row).toMatchObject({ promptTokens: 100, cacheReadTokens: 100, costUsd: 0 });
  });

  it('logTokens() rounds fractional estimates and clamps negatives', async () => {
    // Arrange
    const usage = { prompt_tokens: 10.6, completion_tokens: -3, cache_read_tokens: 0, cost_usd: 0, estimated: true };

    // Act
    await a.logTokens(6n, 1, 'test_fix', usage);

    // Assert
    const row = await waitFor(() => [...admin.db.tokenUsage.iter()].find((t) => t.taskId === 6n));
    expect(row).toMatchObject({ promptTokens: 11, completionTokens: 0 });
  });

  it('markAttemptWasted() flags that attempt', async () => {
    // Arrange
    await a.logTokens(7n, 1, 'code', { prompt_tokens: 1, completion_tokens: 1, cache_read_tokens: 0, cost_usd: 0 });

    // Act
    await a.markAttemptWasted(7n, 1);

    // Assert
    await waitFor(() => [...admin.db.tokenUsage.iter()].find((t) => t.taskId === 7n)?.wasted === true);
  });

  it('logSaving() records the saving against the open run', async () => {
    // Arrange
    const note = `early stop ${RUN}`;

    // Act
    await b.logSaving('early_stop', 4_000, note);

    // Assert
    const row = await waitFor(() => [...admin.db.tokenSaving.iter()].find((s) => s.note === note));
    expect(row).toMatchObject({ runId, agentId: id('agent-b'), kind: 'early_stop', tokensAvoidedEst: 4_000 });
  });
});

describe('run selection', () => {
  it('token rows follow the open run, not an older ended one', async () => {
    // Arrange
    await admin.reducers.endRun({ runId });
    await admin.reducers.startRun({ mode: 'without_contract', seed: 8 });
    const run2 = (await waitFor(() => [...admin.db.run.iter()].find((r) => r.endedAt === undefined && r.id !== runId))).id;
    await new Promise((r) => setTimeout(r, 100));
    const note = `run2 ${RUN}`;

    // Act
    await a.logSaving('reuse', 10, note);

    // Assert
    const row = await waitFor(() => [...admin.db.tokenSaving.iter()].find((s) => s.note === note));
    expect(row.runId).toBe(run2);
    expect(run2).not.toBe(runId);
  });

  it('with no open run, token rows go to the newest run', async () => {
    // Arrange
    const newest = [...admin.db.run.iter()].reduce((m, r) => (r.id > m ? r.id : m), 0n);
    await admin.reducers.endRun({ runId: newest });
    await new Promise((r) => setTimeout(r, 100));
    const note = `ended ${RUN}`;

    // Act
    await a.logSaving('reuse', 10, note);

    // Assert
    const row = await waitFor(() => [...admin.db.tokenSaving.iter()].find((s) => s.note === note));
    expect(row.runId).toBe(newest);
  });
});

describe('disconnect()', () => {
  it('closes the connection; later calls reject', async () => {
    // Arrange
    const c = await connect(opts(id('agent-c')));

    // Act
    await c.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    // Assert
    await expect(c.publishPlan(1n, 'x', [])).rejects.toThrow(/connection closed \(disconnect\(\) called\)/);
    await expect(c.logTokens(1n, 1, 'code', { prompt_tokens: 1, completion_tokens: 1, cache_read_tokens: 0, cost_usd: 0 })).rejects.toThrow(
      /connection closed/,
    );
    await expect(c.disconnect()).resolves.toBeUndefined(); // idempotent
  });
});
