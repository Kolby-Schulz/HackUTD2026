// Layer 3 (docs/nemotron-coordinator-plan.md): the real coordinator process (`tsx src/index.ts`)
// against a running SpacetimeDB, with simulated workers as separate WebSocket identities.
// Checks what lands in the database: conflict status, decision row, pushed instructions,
// worker unpaused, coordinator token_usage, and agent.model recording Nemotron.
//
// Run: spacetime start   (other terminal)
//      npm run test:live -w @contract/coordinator
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DbConnection } from '@contract/client';
import { LIVE_DB, LIVE_WS } from './env.ts';

const COORD_DIR = fileURLToPath(new URL('..', import.meta.url));
const TSX = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const RUN = Math.random().toString(36).slice(2, 8);
const hasKey = !!process.env.NVIDIA_API_KEY;

const open: DbConnection[] = [];
let watcher: DbConnection;
let coordinator: ChildProcess | undefined;
let coordinatorLog = '';

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    const conn: DbConnection = DbConnection.builder()
      .withUri(LIVE_WS)
      .withDatabaseName(LIVE_DB)
      .onConnect(() => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve(conn))
          .onError((ctx) => reject(new Error(`subscription failed: ${String(ctx.event)}`)))
          .subscribeToAllTables();
      })
      .onConnectError((_c, err) => reject(err))
      .build();
    open.push(conn);
  });
}

async function waitFor<T>(what: string, check: () => T | undefined | null | false, timeoutMs = 60_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}\n--- coordinator output ---\n${coordinatorLog}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Starts the real coordinator entrypoint against the live test database. */
function startCoordinator(env: Record<string, string>) {
  coordinatorLog = '';
  coordinator = spawn(TSX, ['src/index.ts'], {
    cwd: COORD_DIR,
    env: { ...process.env, SPACETIME_HOST: LIVE_WS, SPACETIME_DB_NAME: LIVE_DB, COORDINATOR_TOKEN: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  coordinator.stdout!.on('data', (d) => (coordinatorLog += d));
  coordinator.stderr!.on('data', (d) => (coordinatorLog += d));
}

async function stopCoordinator() {
  const c = coordinator;
  coordinator = undefined;
  if (!c || c.exitCode !== null) return;
  const exited = new Promise((r) => c.once('exit', r));
  c.kill('SIGINT');
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
  if (c.exitCode === null) c.kill('SIGKILL');
}

/** Two workers + a mapper; agent-a changes `fee`'s behavior, which agent-b's `checkout` calls. */
async function plantBrokenDependency(tag: string) {
  const [a, b, mapper] = await Promise.all([connect(), connect(), connect()]);
  const ids = { a: `agent-a-${tag}-${RUN}`, b: `agent-b-${tag}-${RUN}` };
  const fee = `src/billing/fees-${tag}-${RUN}.ts#calculateFee`;
  const checkout = `src/checkout/checkout-${tag}-${RUN}.ts#checkout`;
  for (const [conn, id] of [[a, ids.a], [b, ids.b]] as const) {
    await conn.reducers.registerAgent({ id, name: id, ownerDev: 'live-test', machine: 'ci', model: 'claude-code', tokenBudget: 100_000n });
  }
  await mapper.reducers.upsertSymbols({
    file: fee.split('#')[0],
    symbols: [{ id: fee, name: 'calculateFee', kind: 'function', signature: 'calculateFee(amountCents: number): number', signatureHash: 'h1', behaviorNote: 'rounds down' }],
    edges: [],
  });
  await mapper.reducers.upsertSymbols({
    file: checkout.split('#')[0],
    symbols: [{ id: checkout, name: 'checkout', kind: 'function', signature: 'checkout(cart: Cart): Receipt', signatureHash: 'h1', behaviorNote: '' }],
    edges: [{ callerId: checkout, calleeId: fee }],
  });
  await a.reducers.publishPlan({ agentId: ids.a, taskId: 1n, summary: 'Late fees: calculateFee rounds half-up to the cent', items: [{ symbolId: fee, intent: 'modify', signature: undefined }] });
  await b.reducers.publishPlan({ agentId: ids.b, taskId: 2n, summary: 'Receipt at checkout showing total with fees', items: [{ symbolId: checkout, intent: 'modify', signature: undefined }] });

  await a.reducers.reportChange({ agentId: ids.a, symbolId: fee, kind: 'behavior', newSignature: undefined, description: 'calculateFee now rounds half-up instead of down' });
  const conflict = await waitFor('the broken_dependency conflict', () =>
    [...watcher.db.conflict.iter()].find((c) => c.agentB === ids.b && c.symbolId === fee),
  );
  return { ids, fee, conflict, b };
}

beforeAll(async () => {
  watcher = await connect();
});

afterEach(stopCoordinator);

afterAll(async () => {
  await stopCoordinator();
  for (const c of open) c.disconnect();
});

describe.skipIf(!hasKey)('coordinator on Nemotron, end to end through SpacetimeDB', () => {
  it('resolves a broken_dependency with a model decision and records it in the database', async () => {
    startCoordinator({ COORDINATOR_PROVIDER: 'nemotron', LLM_PROVIDER: 'claude-code' });
    const agent = await waitFor('the coordinator to register', () => watcher.db.agent.id.find('coordinator'));
    expect(agent.model).toMatch(/^nemotron:nvidia\//);

    const tokensBefore = [...watcher.db.tokenUsage.iter()].filter((t) => t.agentId === 'coordinator').length;
    const { ids, conflict, b } = await plantBrokenDependency('model');

    const done = await waitFor('the conflict to be resolved', () => {
      const c = watcher.db.conflict.id.find(conflict.id);
      return c && (c.status === 'resolved' || c.status === 'dismissed') ? c : undefined;
    });
    expect(done.status).toBe('resolved');
    expect(done.resolvedAt).toBeDefined();

    const decisions = [...watcher.db.decision.iter()].filter((d) => d.conflictId === conflict.id);
    expect(decisions).toHaveLength(1);
    const d = decisions[0];
    expect(d.ownerAgent).toBe(ids.a);
    expect(d.instructionsA.trim()).not.toBe('');
    expect(d.instructionsB.trim()).not.toBe('');
    expect(d.reason).not.toMatch(/^Fallback rule/);

    // B got the coordinator's instruction pushed and was unpaused.
    await waitFor("agent-b's instruction", () => [...b.db.instruction.iter()].find((i) => i.agentId === ids.b && i.text === d.instructionsB));
    await waitFor('agent-b to resume', () => b.db.agent.id.find(ids.b)?.status === 'working');

    // The model call was logged as coordination tokens.
    const tokens = await waitFor('coordinator token_usage', () => {
      const t = [...watcher.db.tokenUsage.iter()].filter((x) => x.agentId === 'coordinator');
      return t.length > tokensBefore ? t : undefined;
    });
    const last = tokens.at(-1)!;
    expect(last.purpose).toBe('coordination');
    expect(last.promptTokens).toBeGreaterThan(0);
    expect(last.completionTokens).toBeGreaterThan(0);
    expect(coordinatorLog).toMatch(/resolved by model/);
  });
});

describe.skipIf(!hasKey)('mirror duplicates get one consistent ruling', () => {
  // The first two-laptop maincloud run: both agents planned a formatDate at once, the server
  // opened a duplicate conflict each way, and Nemotron gave them to different owners.
  it('both agents planning the same formatter end with one owner and one model call', async () => {
    startCoordinator({ COORDINATOR_PROVIDER: 'nemotron', LLM_PROVIDER: 'claude-code' });
    await waitFor('the coordinator to register', () => watcher.db.agent.id.find('coordinator')?.model.startsWith('nemotron:'));
    const [a, b] = await Promise.all([connect(), connect()]);
    const ids = { a: `agent-a-mirror-${RUN}`, b: `agent-b-mirror-${RUN}` };
    const dates = `src/billing/dates-${RUN}.ts#formatDate`;
    const format = `src/format-${RUN}.ts#formatDate`;
    for (const [conn, id] of [[a, ids.a], [b, ids.b]] as const) {
      await conn.reducers.registerAgent({ id, name: id, ownerDev: 'live-test', machine: 'ci', model: 'claude-code', tokenBudget: 100_000n });
    }
    const tokensBefore = [...watcher.db.tokenUsage.iter()].filter((t) => t.agentId === 'coordinator').length;
    const sig = 'formatDate(d: Date): string';

    // Both plan at once, then each re-publishes (as a resumed worker does): the server opens a
    // conflict each way.
    await Promise.all([
      b.reducers.publishPlan({ agentId: ids.b, taskId: 2n, summary: 'Receipt with order date', items: [{ symbolId: format, intent: 'create', signature: sig }] }),
      a.reducers.publishPlan({ agentId: ids.a, taskId: 1n, summary: 'Invoice with due date', items: [{ symbolId: dates, intent: 'create', signature: sig }] }),
    ]);
    await a.reducers.publishPlan({ agentId: ids.a, taskId: 1n, summary: 'Invoice with due date', items: [{ symbolId: dates, intent: 'create', signature: sig }] }).catch(() => {});
    await b.reducers.publishPlan({ agentId: ids.b, taskId: 2n, summary: 'Receipt with order date', items: [{ symbolId: format, intent: 'create', signature: sig }] }).catch(() => {});

    const mine = () => [...watcher.db.conflict.iter()].filter((c) => c.kind === 'duplicate' && [ids.a, ids.b].includes(c.agentA));
    await waitFor('a duplicate conflict', () => mine().length > 0);
    await new Promise((r) => setTimeout(r, 1_000)); // let any mirror conflict arrive
    await waitFor('every duplicate to be resolved', () => mine().every((c) => c.status === 'resolved'));

    const conflicts = mine();
    const decisions = conflicts.map((c) => [...watcher.db.decision.iter()].find((d) => d.conflictId === c.id)!);
    console.log(
      `[mirror] ${conflicts.length} conflict(s):`,
      conflicts.map((c, i) => `#${c.id} ${c.agentA}->${c.symbolId}: owner ${decisions[i].ownerAgent} | ${decisions[i].reason}`),
    );
    expect(new Set(decisions.map((d) => d.ownerAgent)).size).toBe(1);
    const modelCalls = [...watcher.db.tokenUsage.iter()].filter((t) => t.agentId === 'coordinator').length - tokensBefore;
    expect(modelCalls).toBe(1);
    if (conflicts.length > 1) expect(coordinatorLog).toMatch(/prior_decision/);
  });
});

describe('coordinator fallback when Nemotron is unreachable', () => {
  it('still resolves with the first-claimant rule so workers never stay paused', async () => {
    startCoordinator({ COORDINATOR_PROVIDER: 'nemotron', NVIDIA_API_KEY: 'nvapi-invalid-for-test' });
    await waitFor('the coordinator to register', () => watcher.db.agent.id.find('coordinator')?.model.startsWith('nemotron:'));

    const { ids, conflict, b } = await plantBrokenDependency('fallback');
    await waitFor('the conflict to be resolved', () => watcher.db.conflict.id.find(conflict.id)?.status === 'resolved');

    const d = [...watcher.db.decision.iter()].find((x) => x.conflictId === conflict.id)!;
    expect(d.ownerAgent).toBe(ids.a);
    expect(d.reason).toMatch(/^Fallback rule/);
    await waitFor('agent-b to resume', () => b.db.agent.id.find(ids.b)?.status === 'working');
    expect(coordinatorLog).toMatch(/401|decide failed/);
  });
});
