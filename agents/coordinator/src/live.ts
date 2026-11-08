// Coordinator live mode (spec section 12): wake on open conflicts, decide, write the decision back.
// Never edits code. Every model call goes through @contract/llm (decideConflict).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, DbConnection, holdService, type rows, type SymbolContext } from '@contract/client';
import type { LLM, Usage } from '@contract/llm';
import { decideConflict, fallbackDecision, type ConflictContext, type Decision } from './decide.ts';

const KINDS = ['broken_dependency', 'duplicate', 'claim_contention', 'plan_clash'] as const;

export interface Tables {
  plans: rows.Plan[];
  planItems: rows.PlanItem[];
  tasks: rows.Task[];
  changes: rows.Change[];
  /** For earlier decisions; optional so callers without them still work. */
  conflicts?: rows.Conflict[];
  decisions?: rows.Decision[];
  runs?: rows.Run[];
}

const MAX_PRIOR = 6;

/** Decisions on earlier conflicts of the current run that involve either agent, oldest first. */
export function priorDecisions(c: rows.Conflict, t: Tables): string[] {
  const conflicts = new Map((t.conflicts ?? []).map((x) => [x.id, x]));
  const open = newest((t.runs ?? []).filter((r) => r.endedAt === undefined));
  const since = open?.startedAt.microsSinceUnixEpoch;
  const agents = new Set([c.agentA, c.agentB]);
  const out: string[] = [];
  for (const d of [...(t.decisions ?? [])].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const k = conflicts.get(d.conflictId);
    if (!k || k.id === c.id || k.id > c.id) continue;
    if (!agents.has(k.agentA) && !agents.has(k.agentB)) continue;
    if (since !== undefined && k.createdAt.microsSinceUnixEpoch < since) continue;
    out.push(
      `#${k.id} ${k.kind} on ${k.symbolId}: owner ${d.ownerAgent}; told ${k.agentA}: "${d.instructionsA}"; told ${k.agentB}: "${d.instructionsB}"`,
    );
  }
  return out.slice(-MAX_PRIOR);
}

const newest = <T extends { id: bigint }>(xs: T[]) => xs.reduce<T | undefined>((b, x) => (!b || x.id > b.id ? x : b), undefined);

/** One agent's side: active plan summary, current task, plan items as `intent symbol_id`. */
function describePlan(agentId: string, t: Tables): string {
  const plan = newest(t.plans.filter((p) => p.agentId === agentId && p.active));
  const task = (plan && t.tasks.find((x) => x.id === plan.taskId)) ?? newest(t.tasks.filter((x) => x.agentId === agentId));
  const items = plan
    ? t.planItems
        .filter((i) => i.planId === plan.id)
        .map((i) => `${i.intent} ${i.symbolId}${i.signature ? ` (${i.signature})` : ''}`)
    : [];
  const parts = [
    plan ? plan.summary : '(no active plan)',
    task ? `Task: ${task.description}` : '',
    items.length ? `Plan items: ${items.join('; ')}` : '',
  ];
  return parts.filter(Boolean).join(' | ');
}

/** Pure: conflict row + table rows (+ optional symbol slice) -> decision context. */
export function buildConflictContext(c: rows.Conflict, t: Tables, symbol?: SymbolContext): ConflictContext {
  const change = newest(t.changes.filter((ch) => ch.symbolId === c.symbolId));
  let description = change?.description || c.details;
  if (symbol) {
    description += ` Current signature: ${symbol.signature}.`;
    if (symbol.callers.length) description += ` Callers: ${symbol.callers.join(', ')}.`;
  }
  return {
    kind: (KINDS as readonly string[]).includes(c.kind) ? (c.kind as ConflictContext['kind']) : 'plan_clash',
    symbolId: c.symbolId,
    agentA: c.agentA,
    agentB: c.agentB,
    planA: describePlan(c.agentA, t),
    planB: describePlan(c.agentB, t),
    ...(change?.oldSignature !== undefined ? { oldSignature: change.oldSignature } : {}),
    ...(change?.newSignature !== undefined ? { newSignature: change.newSignature } : {}),
    description,
    // The server always puts the claim holder / creator / earlier planner / changer in agent_a.
    firstClaimant: c.agentA,
    priorDecisions: priorDecisions(c, t),
  };
}

/** What handling a conflict needs; faked in tests. */
export interface Deps {
  llm: LLM;
  reducers: {
    markConflictResolving(a: { conflictId: bigint }): Promise<void>;
    resolveConflict(a: { conflictId: bigint; ownerAgent: string; instructionsA: string; instructionsB: string; reason: string }): Promise<void>;
    dismissConflict(a: { conflictId: bigint; reason: string }): Promise<void>;
  };
  tables(): Tables;
  getContext(symbolIds: string[], depth?: number): Promise<SymbolContext[]>;
  logTokens(u: Usage): Promise<void>;
  log?: (msg: string) => void;
}

const resolveWith = (d: Deps, conflictId: bigint, x: Decision) =>
  d.reducers.resolveConflict({ conflictId, ownerAgent: x.owner_agent, instructionsA: x.instructions_a, instructionsB: x.instructions_b, reason: x.reason });

/** Mark resolving, decide, write back. Any error after marking -> fallback rule, so workers never stay paused. */
export async function handleConflict(d: Deps, c: rows.Conflict): Promise<void> {
  const log = d.log ?? ((m: string) => console.log(`[coordinator] ${m}`));
  const conflictId = c.id;
  try {
    await d.reducers.markConflictResolving({ conflictId });
  } catch (e) {
    log(`skip conflict ${conflictId}: ${(e as Error).message}`);
    return;
  }
  let ctx = buildConflictContext(c, { plans: [], planItems: [], tasks: [], changes: [] });
  try {
    const symbol = (await d.getContext([c.symbolId], 1).catch(() => [])).find((s) => s.id === c.symbolId);
    ctx = buildConflictContext(c, d.tables(), symbol);
    const { decision, source } = await decideConflict(d.llm, ctx, (u) => d.logTokens(u).catch(() => {}));
    if (decision.action === 'dismiss') await d.reducers.dismissConflict({ conflictId, reason: decision.reason });
    else await resolveWith(d, conflictId, decision);
    log(`conflict ${conflictId} (${c.kind} ${c.symbolId}) ${decision.action}d by ${source}: owner ${decision.owner_agent}; ${decision.reason}`);
  } catch (e) {
    log(`conflict ${conflictId} failed (${(e as Error).message}); applying fallback rule`);
    const fb = fallbackDecision(ctx);
    try {
      await resolveWith(d, conflictId, fb);
      log(`conflict ${conflictId} resolved by fallback_rule: owner ${fb.owner_agent}`);
    } catch (e2) {
      log(`conflict ${conflictId} fallback failed too: ${(e2 as Error).message}`);
    }
  }
}

/** Serial queue, deduped by conflict id. `idle()` resolves once everything queued is handled. */
export function createQueue(handle: (c: rows.Conflict) => Promise<void>) {
  const seen = new Set<bigint>();
  let chain: Promise<void> = Promise.resolve();
  return {
    enqueue(c: rows.Conflict) {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      chain = chain.then(() => handle(c)).catch(() => {});
    },
    idle: () => chain,
  };
}

/** Subscribes with a raw connection sharing the coordinator's token (same identity). */
function rawConnect(token: string, queries: string[], timeoutMs = 10_000): Promise<DbConnection> {
  const host = process.env.SPACETIME_HOST!;
  const dbName = process.env.SPACETIME_DB_NAME!;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`no response from ${host} (${dbName}) within ${timeoutMs} ms`)), timeoutMs);
    const conn: DbConnection = DbConnection.builder()
      .withUri(host)
      .withDatabaseName(dbName)
      .withToken(token)
      .onConnect(() => {
        conn
          .subscriptionBuilder()
          .onApplied(() => (clearTimeout(timer), res(conn)))
          .onError((ctx) => (clearTimeout(timer), rej(new Error(`subscription failed: ${String(ctx.event ?? 'unknown')}`))))
          .subscribe(queries);
      })
      .onConnectError((_ctx, err) => (clearTimeout(timer), rej(err)))
      .build();
  });
}

export async function runLive(llm: LLM): Promise<void> {
  const host = process.env.SPACETIME_HOST;
  const dbName = process.env.SPACETIME_DB_NAME;
  if (!host || !dbName) throw new Error('SPACETIME_HOST and SPACETIME_DB_NAME must be set (see .env.example)');

  const agent = { id: 'coordinator', name: 'coordinator', ownerDev: '', machine: hostname(), model: 'claude-code', tokenBudget: 0 };
  // Reuse the saved identity so a restart isn't rejected as "linked to another identity"
  // for the 60 s heartbeat timeout. Keyed by host + db: a token from one server is a 401 on another.
  const key = `${host}|${dbName}`;
  const saved = readTokens()[key];
  let client;
  try {
    client = await connect({ host, dbName, agent, ...(saved ? { token: saved } : {}) });
  } catch (e) {
    if (!saved) throw e;
    console.warn(`[coordinator] saved token rejected (${(e as Error).message}); connecting with a new identity`);
    client = await connect({ host, dbName, agent });
  }
  if (client.token !== saved) writeTokens({ ...readTokens(), [key]: client.token });
  const conn = await rawConnect(client.token, [
    'SELECT * FROM conflict', // all of them: earlier decisions need their conflict rows
    'SELECT * FROM decision',
    'SELECT * FROM plan',
    'SELECT * FROM plan_item',
    'SELECT * FROM task',
    'SELECT * FROM change',
    'SELECT * FROM run',
  ]);
  // Exactly one coordinator per database (issue #19), even with two laptops.
  let lock;
  try {
    lock = await holdService(conn.reducers, 'coordinator', process.env.CONTRACT_MACHINE || hostname(), (why) => {
      console.error(`[coordinator] lost the coordinator lock (${why}); stopping`);
      process.exit(1);
    });
  } catch (e) {
    conn.disconnect();
    await client.disconnect();
    throw new Error(`${e instanceof Error ? e.message : String(e)}`);
  }

  const deps: Deps = {
    llm,
    reducers: conn.reducers,
    tables: () => ({
      plans: [...conn.db.plan.iter()],
      planItems: [...conn.db.planItem.iter()],
      tasks: [...conn.db.task.iter()],
      changes: [...conn.db.change.iter()],
      conflicts: [...conn.db.conflict.iter()],
      decisions: [...conn.db.decision.iter()],
      runs: [...conn.db.run.iter()],
    }),
    getContext: (ids, depth) => client.getContext(ids, depth),
    logTokens: (u) => client.logTokens(0n, 0, 'coordination', u),
  };
  const queue = createQueue((c) => handleConflict(deps, c));
  conn.db.conflict.onInsert((_ctx, row) => {
    if (row.status === 'open') queue.enqueue(row);
  });
  const open = [...conn.db.conflict.iter()].filter((c) => c.status === 'open');
  for (const c of open) queue.enqueue(c);
  console.log(`[coordinator] connected to ${dbName}; ${open.length} open conflict(s) queued; waiting for conflicts (Ctrl-C to stop)`);

  process.once('SIGINT', async () => {
    console.log('[coordinator] stopping');
    await lock.release();
    conn.disconnect();
    await client.disconnect();
    process.exit(0);
  });
}

/** .contract/coordinator-tokens.json at the repo root (gitignored), mode 0600. */
const TOKENS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.contract/coordinator-tokens.json');

function readTokens(): Record<string, string> {
  try {
    return existsSync(TOKENS) ? (JSON.parse(readFileSync(TOKENS, 'utf8')) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeTokens(all: Record<string, string>) {
  try {
    mkdirSync(dirname(TOKENS), { recursive: true });
    writeFileSync(TOKENS, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
  } catch (e) {
    console.warn(`[coordinator] couldn't save token: ${(e as Error).message}`);
  }
}
