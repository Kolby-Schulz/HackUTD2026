// Shared test helpers. Tests run the real module (src/index.ts) inside SpacetimeDB's
// official in-process harness, so transactions, rollbacks and indexes behave like the
// real server. Each "who" below is a distinct SpacetimeDB identity.
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import { ConnectionId, Timestamp } from 'spacetimedb';
import type { InferSchema, ReducerCtx } from 'spacetimedb/server';
import spacetimedb, * as mod from '../src/index';

export { mod };
export type Harness = ReturnType<typeof makeHarness>;
export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

/** A fixed start time (2026-11-07 12:00:00 UTC) so time-based rules are predictable. */
export const T0 = 1_794_052_800_000_000n;
export const SEC = 1_000_000n;

// 'daemon' is a laptop's control daemon (a `machine` row), 'dashboard' a browser paired with it
// (a `machine_access` row), 'outsider' a connection that only knows the database name.
const users = ['worker-a', 'worker-b', 'worker-c', 'coordinator', 'mapper', 'daemon', 'dashboard', 'outsider'] as const;
export type Who = (typeof users)[number];

export function makeHarness() {
  const h = createModuleTestHarness(spacetimedb, mod);
  h.clock.set(new Timestamp(T0));
  const auths = new Map(
    users.map((u, i) => [
      u,
      TestAuth.fromJwtPayload(
        JSON.stringify({ iss: 'https://contract.test', sub: u, aud: ['spacetimedb'] }),
        new ConnectionId(BigInt(i + 1)),
      ),
    ]),
  );

  /**
   * Runs body as one reducer transaction from `who`; throws (and rolls back) like the server.
   * Never read `t.db` inside body: the harness locks and aborts. Read it before or after.
   */
  function as<T>(who: Who, body: (ctx: Ctx) => T): T {
    return h.withReducerTx(auths.get(who)!, body as never);
  }

  /** Runs body as the module itself (for test setup that no reducer exposes). */
  function internal<T>(body: (ctx: Ctx) => T): T {
    return h.withReducerTx(TestAuth.internal(), body as never);
  }

  /** Moves the test clock forward by `secs` seconds. */
  function advance(secs: number) {
    h.clock.set(new Timestamp(h.clock.now().microsSinceUnixEpoch + BigInt(secs) * SEC));
  }

  function now(): bigint {
    return h.clock.now().microsSinceUnixEpoch;
  }

  return { h, db: h.db, as, internal, advance, now };
}

/** Agent ids used by the workers in tests, matched to their identities. */
export const AGENT_OF: Record<string, Who> = {
  'agent-a': 'worker-a',
  'agent-b': 'worker-b',
  'agent-c': 'worker-c',
  coordinator: 'coordinator',
};

export function register(t: Harness, agentId: string, who: Who = AGENT_OF[agentId] ?? 'outsider') {
  t.as(who, (ctx) =>
    mod.register_agent(ctx, {
      id: agentId,
      name: agentId.toUpperCase(),
      owner_dev: 'dev',
      machine: 'laptop',
      model: 'claude-code',
      token_budget: 100_000n,
    }),
  );
}

/** The laptop the test operator's daemon registered (see asOperator). */
export const MACHINE = 'laptop';

/**
 * Runs body as an operator for run bookkeeping (start_run, end_run, create_task,
 * mark_attempt_wasted, reset_demo_state): this laptop's control daemon, registered on first use.
 * Mirrors scripts/lib.ts adminConnect, which connects as the machine with the daemon's token.
 */
export function asOperator<T>(t: Harness, body: (ctx: Ctx) => T): T {
  if (!t.db.machine.id.find(MACHINE)) t.as('daemon', (ctx) => mod.register_machine(ctx, { id: MACHINE }));
  return t.as('daemon', body);
}

/** Runs body as the mapper, holding the `mapper` service lock that upsert_symbols requires. */
export function asMapper<T>(t: Harness, body: (ctx: Ctx) => T): T {
  if (!t.db.service.name.find('mapper')) {
    t.as('mapper', (ctx) => mod.claim_service(ctx, { name: 'mapper', machine: MACHINE, holder: 'test-mapper' }));
  }
  return t.as('mapper', body);
}

/** The demo-repo code map from spec section 14: invoice + checkout both call calculateFee. */
export const FEES = 'src/billing/fees.ts#calculateFee';
export const INVOICE = 'src/billing/invoice.ts#buildInvoice';
export const TOTAL = 'src/billing/invoice.ts#computeTotal';
export const CHECKOUT = 'src/checkout/checkout.ts#checkout';

export function sym(id: string, signature = `${id.split('#')[1]}()`, hash = 'h1') {
  return { id, name: id.split('#')[1], kind: 'function', signature, signature_hash: hash, behavior_note: '' };
}

export function seedCodeMap(t: Harness) {
  asMapper(t, (ctx) =>
    mod.upsert_symbols(ctx, {
      file: 'src/billing/fees.ts',
      symbols: [sym(FEES, 'calculateFee(amountCents: number): number')],
      edges: [],
    }),
  );
  asMapper(t, (ctx) =>
    mod.upsert_symbols(ctx, {
      file: 'src/billing/invoice.ts',
      symbols: [sym(INVOICE, 'buildInvoice(order: Order): Invoice'), sym(TOTAL, 'computeTotal(cart: Cart): number')],
      edges: [
        { caller_id: INVOICE, callee_id: FEES },
        { caller_id: TOTAL, callee_id: FEES },
      ],
    }),
  );
  asMapper(t, (ctx) =>
    mod.upsert_symbols(ctx, {
      file: 'src/checkout/checkout.ts',
      symbols: [sym(CHECKOUT, 'checkout(cart: Cart): Receipt')],
      edges: [{ caller_id: CHECKOUT, callee_id: FEES }],
    }),
  );
}

export function plan(
  t: Harness,
  agentId: string,
  items: { symbol_id: string; intent: string; signature?: string }[],
  taskId = 1n,
  summary = 'plan',
) {
  const withSig = items.map((i) => ({ ...i, signature: i.signature }));
  t.as(AGENT_OF[agentId], (ctx) => mod.publish_plan(ctx, { agent_id: agentId, task_id: taskId, summary, items: withSig }));
}

export function claim(t: Harness, agentId: string, symbolId: string, ttl = 120) {
  t.as(AGENT_OF[agentId], (ctx) => mod.claim_symbol(ctx, { agent_id: agentId, symbol_id: symbolId, ttl_secs: ttl }));
}

export function reportChange(
  t: Harness,
  agentId: string,
  symbolId: string,
  kind = 'behavior',
  description = 'rounds half-up now',
  newSignature?: string,
) {
  t.as(AGENT_OF[agentId], (ctx) =>
    mod.report_change(ctx, {
      agent_id: agentId,
      symbol_id: symbolId,
      kind,
      new_signature: newSignature,
      description,
    }),
  );
}

export const all = <T>(it: Iterable<T>): T[] => [...it];
