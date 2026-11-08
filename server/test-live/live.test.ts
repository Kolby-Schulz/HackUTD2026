// Live integration tests: several real WebSocket clients, each with its own SpacetimeDB
// identity (one per "laptop"), talking to a running server through the generated bindings
// in packages/client/src/bindings. These check what the in-process unit tests can't:
// identities over the wire, token reuse, pushes to subscribers, concurrency, the schedule.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbConnection } from '../../packages/client/src/bindings/index';
import { LIVE_DB, LIVE_WS } from './env';

type Conn = DbConnection;
interface Client {
  conn: Conn;
  identityHex: string;
  token: string;
}

const open: Conn[] = [];
// Unique per run so reruns against the same database never collide.
const RUN = Math.random().toString(36).slice(2, 8);
const id = (name: string) => `${name}-${RUN}`;
const FEES = `src/billing/fees.ts#calculateFee`;
const CHECKOUT = `src/checkout/checkout.ts#checkout`;

/** Connects a new client (new identity unless a token is given) and subscribes to every table. */
function connect(token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    let conn: Conn;
    conn = DbConnection.builder()
      .withUri(LIVE_WS)
      .withDatabaseName(LIVE_DB)
      .withToken(token)
      .onConnect((_c, identity, tok) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve({ conn, identityHex: identity.toHexString(), token: tok }))
          .onError((ctx) => reject(new Error(`subscription failed: ${String(ctx.event)}`)))
          .subscribeToAllTables();
      })
      .onConnectError((_c, err) => reject(err))
      .build();
    open.push(conn);
  });
}

/** Polls the client cache until `check` returns a truthy value (pushes arrive asynchronously). */
async function waitFor<T>(check: () => T | undefined | null | false, timeoutMs = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const rows = <T>(it: Iterable<T>) => [...it];

async function registerAgent(c: Client, agentId: string) {
  await c.conn.reducers.registerAgent({
    id: agentId,
    name: agentId,
    ownerDev: 'live-test',
    machine: 'ci',
    model: 'claude-code',
    tokenBudget: 100_000n,
  });
}

let a: Client;
let b: Client;
let coord: Client;
let mapper: Client;

beforeAll(async () => {
  [a, b, coord, mapper] = await Promise.all([connect(), connect(), connect(), connect()]);
  await registerAgent(a, id('agent-a'));
  await registerAgent(b, id('agent-b'));
  // The coordinator id is fixed by the spec; the setup publish wiped the database, and
  // this suite runs once per publish, so this client owns it.
  await registerAgent(coord, 'coordinator');
  await mapper.conn.reducers.upsertSymbols({
    file: 'src/billing/fees.ts',
    symbols: [
      {
        id: FEES,
        name: 'calculateFee',
        kind: 'function',
        signature: 'calculateFee(amountCents: number): number',
        signatureHash: 'h1',
        behaviorNote: 'rounds down',
      },
    ],
    edges: [],
  });
  await mapper.conn.reducers.upsertSymbols({
    file: 'src/checkout/checkout.ts',
    symbols: [
      {
        id: CHECKOUT,
        name: 'checkout',
        kind: 'function',
        signature: 'checkout(cart: Cart): Receipt',
        signatureHash: 'h1',
        behaviorNote: '',
      },
    ],
    edges: [{ callerId: CHECKOUT, calleeId: FEES }],
  });
});

afterAll(() => {
  for (const c of open) c.disconnect();
});

describe('identities over the wire', () => {
  it('gives each new connection its own identity', () => {
    // Arrange
    const ids = [a, b, coord, mapper].map((c) => c.identityHex);

    // Act
    const unique = new Set(ids);

    // Assert
    expect(unique.size).toBe(4);
  });

  it("rejects registering another live client's agent id", async () => {
    // Arrange
    const thief = await connect();

    // Act
    const act = thief.conn.reducers.registerAgent({
      id: id('agent-a'),
      name: 'thief',
      ownerDev: 'x',
      machine: 'x',
      model: 'x',
      tokenBudget: 0n,
    });

    // Assert
    await expect(act).rejects.toThrow(/already linked to another identity/);
    expect(a.conn.db.agent.id.find(id('agent-a'))!.name).toBe(id('agent-a'));
  });

  it('a second process reusing the worker token acts as the same agent (CONTRACT_TOKEN)', async () => {
    // Arrange: the worker's MCP server / hook connect with the worker's token.
    const mcp = await connect(a.token);

    // Act
    await mcp.conn.reducers.heartbeat({ agentId: id('agent-a') });

    // Assert
    expect(mcp.identityHex).toBe(a.identityHex);
  });
});

describe('Rule 1 pushes end to end', () => {
  it('A reports a change, B is paused and pushed an instruction, coordinator resolves, B resumes', async () => {
    // Arrange
    await a.conn.reducers.publishPlan({
      agentId: id('agent-a'),
      taskId: 1n,
      summary: 'half-up fees',
      items: [{ symbolId: FEES, intent: 'modify', signature: undefined }],
    });
    await b.conn.reducers.publishPlan({
      agentId: id('agent-b'),
      taskId: 2n,
      summary: 'receipt',
      items: [{ symbolId: CHECKOUT, intent: 'modify', signature: undefined }],
    });
    const pushed: string[] = [];
    b.conn.db.instruction.onInsert((_ctx, row) => {
      if (row.agentId === id('agent-b')) pushed.push(row.text);
    });

    // Act 1
    const t0 = Date.now();
    await a.conn.reducers.reportChange({
      agentId: id('agent-a'),
      symbolId: FEES,
      kind: 'behavior',
      newSignature: undefined,
      description: 'rounds half-up',
    });
    await waitFor(() => pushed.length === 1);
    const pushMs = Date.now() - t0;

    // Assert 1: B's own cache shows it paused with the pause instruction, pushed in well under a second.
    expect(pushed[0]).toBe(`${FEES} was changed by ${id('agent-a')}. Pause and wait for the coordinator.`);
    expect(b.conn.db.agent.id.find(id('agent-b'))!.status).toBe('paused');
    expect(pushMs).toBeLessThan(1_000);
    const conflict = await waitFor(() =>
      rows(coord.conn.db.conflict.iter()).find((c) => c.agentB === id('agent-b') && c.status === 'open'),
    );

    // Act 2
    await coord.conn.reducers.resolveConflict({
      conflictId: conflict.id,
      ownerAgent: id('agent-a'),
      instructionsA: 'Keep half-up rounding.',
      instructionsB: 'Do not round again in checkout.',
      reason: 'A owns fee rounding.',
    });
    await waitFor(() => pushed.length === 2);

    // Assert 2
    expect(pushed[1]).toBe('Do not round again in checkout.');
    await waitFor(() => b.conn.db.agent.id.find(id('agent-b'))!.status === 'working');
    expect(a.conn.db.conflict.id.find(conflict.id)!.status).toBe('resolved');
  });

  it('a worker cannot resolve conflicts', async () => {
    // Arrange
    const anyConflict = rows(b.conn.db.conflict.iter())[0];

    // Act
    const act = b.conn.reducers.resolveConflict({
      conflictId: anyConflict.id,
      ownerAgent: id('agent-b'),
      instructionsA: 'x',
      instructionsB: 'x',
      reason: 'x',
    });

    // Assert
    await expect(act).rejects.toThrow(/only the coordinator/);
  });
});

describe('Rule 2 over the wire', () => {
  it("B's planned date formatter is flagged against A's, visible to the coordinator", async () => {
    // Arrange
    const aDate = `src/utils/date_${RUN}.ts#formatDate`;
    const bDate = `src/checkout/receipt_${RUN}.ts#format_date`;
    await a.conn.reducers.publishPlan({
      agentId: id('agent-a'),
      taskId: 1n,
      summary: 'due date',
      items: [{ symbolId: aDate, intent: 'create', signature: undefined }],
    });

    // Act
    await b.conn.reducers.publishPlan({
      agentId: id('agent-b'),
      taskId: 2n,
      summary: 'receipt date',
      items: [{ symbolId: bDate, intent: 'create', signature: undefined }],
    });

    // Assert
    const dup = await waitFor(() =>
      rows(coord.conn.db.conflict.iter()).find((c) => c.kind === 'duplicate' && c.symbolId === aDate),
    );
    expect(dup).toMatchObject({ agentA: id('agent-a'), agentB: id('agent-b'), status: 'open' });
  });
});

describe('transactions over the wire', () => {
  it('a rejected reducer leaves no partial rows', async () => {
    // Arrange
    const plansBefore = rows(a.conn.db.plan.iter()).length;

    // Act
    const act = a.conn.reducers.publishPlan({
      agentId: id('agent-a'),
      taskId: 1n,
      summary: 'bad',
      items: [
        { symbolId: FEES, intent: 'modify', signature: undefined },
        { symbolId: 'src/nope.ts#ghost', intent: 'depend', signature: undefined },
      ],
    });

    // Assert
    await expect(act).rejects.toThrow(/unknown symbol/);
    expect(rows(a.conn.db.plan.iter())).toHaveLength(plansBefore);
    expect(rows(a.conn.db.plan.iter()).filter((p) => p.agentId === id('agent-a') && p.active)).toHaveLength(1);
  });

  it('two agents racing for one claim: exactly one wins, one contention conflict', async () => {
    // Arrange
    const symbol = `src/race.ts#race_${RUN}`;

    // Act
    await Promise.all([
      a.conn.reducers.claimSymbol({ agentId: id('agent-a'), symbolId: symbol, ttlSecs: 60 }),
      b.conn.reducers.claimSymbol({ agentId: id('agent-b'), symbolId: symbol, ttlSecs: 60 }),
    ]);

    // Assert
    const holder = await waitFor(() => coord.conn.db.claim.symbolId.find(symbol));
    expect([id('agent-a'), id('agent-b')]).toContain(holder.agentId);
    const contention = await waitFor(() => {
      const c = rows(coord.conn.db.conflict.iter()).filter((c) => c.symbolId === symbol);
      return c.length ? c : undefined;
    });
    expect(contention).toHaveLength(1);
    expect(contention[0]).toMatchObject({ kind: 'claim_contention', agentA: holder.agentId });
  });
});

describe('scheduled expire_claims on the real server', () => {
  it('deletes an expired claim within one 30 s tick', async () => {
    // Arrange
    const symbol = `src/ttl.ts#ttl_${RUN}`;
    await a.conn.reducers.claimSymbol({ agentId: id('agent-a'), symbolId: symbol, ttlSecs: 1 });
    await waitFor(() => a.conn.db.claim.symbolId.find(symbol));

    // Act: just wait for the server's schedule.
    const gone = await waitFor(() => !a.conn.db.claim.symbolId.find(symbol), 40_000);

    // Assert
    expect(gone).toBe(true);
  }, 45_000);
});
