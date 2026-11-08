// Contract server: SpacetimeDB TypeScript module (spec sections 6, 7, 8). Owner: backend.
//
// Table, column and reducer names follow the spec exactly (snake_case). String "enums"
// (status, kind, intent, purpose, mode) are plain strings validated in the reducers, so
// clients can send and compare them as ordinary strings.
//
// Design notes (things the spec leaves open; flagged in docs/TASKS.md):
// - A reducer that throws rolls back everything it wrote. So when a rule must both
//   "reject" and "insert a conflict" (claim_symbol, Rule 3), the reducer records the
//   conflict and returns without taking the claim. Clients check the claim row to see
//   whether they got it.
// - report_change accepts changes on unclaimed symbols (REQUIRE_CLAIM_FOR_CHANGE) so
//   contract-hook's auto-detected changes still run Rule 1. See "Decisions needed".
// - register_agent lets an id move to a new identity only when the old link has gone
//   stale (no heartbeat for 60 s), so restarted demos don't get locked out.

import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import { duplicateReason, nameOf } from './rules';

// ---------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------

const COORDINATOR_ID = 'coordinator';
/** The service lock (claim_service) the mapper holds while it writes the code map. */
const MAPPER_SERVICE = 'mapper';
const FILE_EDITS_PER_AGENT = 50;
const SERVICE_TIMEOUT_SECS = 30;
const MAX_DIFF_CHARS = 20_000;
/** Marks instruction rows written by send_instruction (an operator on the dashboard). */
const OPERATOR_PREFIX = 'Operator: ';
const DEFAULT_CLAIM_TTL_SECS = 300;
const HEARTBEAT_TIMEOUT_SECS = 60;
const EXPIRE_EVERY_MICROS = 30_000_000n; // 30 s
const REQUIRE_CLAIM_FOR_CHANGE = false;
/** Rule 1 follows callers this many hops up from a changed symbol (1 = direct callers only). */
const RULE1_MAX_HOPS = 3;

const TASK_STATUSES = ['todo', 'in_progress', 'paused', 'done', 'discarded'] as const;
const SYMBOL_KINDS = ['function', 'class', 'method', 'const'] as const;
const INTENTS = ['modify', 'create', 'depend'] as const;
const CHANGE_KINDS = ['signature', 'behavior', 'created', 'removed'] as const;
const RUN_MODES = ['with_contract', 'without_contract'] as const;
const PURPOSES = ['plan', 'code', 'context', 'test_fix', 'merge_fix', 'coordination'] as const;
const SAVING_KINDS = ['early_stop', 'reuse', 'context_slice', 'cache_hit'] as const;

// Allowed task status changes (set_task_status rejects anything else).
const TASK_TRANSITIONS: Record<string, readonly string[]> = {
  todo: ['in_progress', 'discarded'],
  in_progress: ['paused', 'done', 'discarded'],
  paused: ['in_progress', 'done', 'discarded'],
  done: [],
  discarded: [],
};

// ---------------------------------------------------------------------------------
// Tables (spec section 6). All public so the dashboard and agents can subscribe.
// ---------------------------------------------------------------------------------

// Who is connected and what they're doing.
const agent = table(
  { name: 'agent', public: true },
  {
    id: t.string().primaryKey(),
    identity: t.identity(), // the caller linked by register_agent (spec section 7, "Identity")
    name: t.string(),
    owner_dev: t.string(),
    machine: t.string(),
    model: t.string(),
    status: t.string(), // AgentStatus
    current_task_id: t.option(t.u64()),
    token_budget: t.u64(),
    last_heartbeat: t.timestamp(),
  },
);

const task = table(
  { name: 'task', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    title: t.string(),
    description: t.string(),
    agent_id: t.string(),
    status: t.string(), // TaskStatus
    attempt: t.u32(),
    run_id: t.u64(),
  },
);

// The code map (written by the mapper).
const symbol = table(
  { name: 'symbol', public: true },
  {
    id: t.string().primaryKey(), // "src/billing/fees.ts#calculateFee"
    name: t.string(),
    kind: t.string(), // SymbolKind
    file: t.string().index('btree'),
    signature: t.string(),
    signature_hash: t.string(),
    behavior_note: t.string(),
    version: t.u32(),
    updated_at: t.timestamp(),
  },
);

// "caller calls callee"
const symbolEdge = table(
  { name: 'symbol_edge', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    caller_id: t.string().index('btree'),
    callee_id: t.string().index('btree'),
  },
);

const summaryCache = table(
  { name: 'summary_cache', public: true },
  {
    key: t.string().primaryKey(), // file_path + ":" + content_hash
    summary: t.string(),
    summary_tokens: t.u32(),
    hits: t.u32(),
  },
);

// Coordination
const plan = table(
  { name: 'plan', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    agent_id: t.string().index('btree'),
    task_id: t.u64(),
    summary: t.string(),
    active: t.bool(),
    created_at: t.timestamp(),
  },
);

const planItem = table(
  { name: 'plan_item', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    plan_id: t.u64().index('btree'),
    agent_id: t.string(),
    symbol_id: t.string().index('btree'),
    intent: t.string(), // Intent
    // Optional, for intent 'create': the signature the agent will write, so Rule 2's
    // type match runs at plan time (formatDate vs toDisplayDate), not only once written.
    signature: t.option(t.string()).default(undefined), // default: lets maincloud migrate without wiping data
  },
);

const claim = table(
  { name: 'claim', public: true },
  {
    symbol_id: t.string().primaryKey(),
    agent_id: t.string(),
    claimed_at: t.timestamp(),
    expires_at: t.timestamp(),
  },
);

const change = table(
  { name: 'change', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    agent_id: t.string(),
    symbol_id: t.string(),
    kind: t.string(), // ChangeKind
    old_signature: t.option(t.string()),
    new_signature: t.option(t.string()),
    description: t.string(),
    created_at: t.timestamp(),
  },
);

const conflict = table(
  { name: 'conflict', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string(), // ConflictKind
    symbol_id: t.string(),
    agent_a: t.string(),
    agent_b: t.string(),
    details: t.string(),
    status: t.string().index('btree'), // 'open' | 'resolving' | 'resolved' | 'dismissed'
    created_at: t.timestamp(),
    resolved_at: t.option(t.timestamp()),
  },
);

const decision = table(
  { name: 'decision', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    conflict_id: t.u64(),
    owner_agent: t.string(),
    instructions_a: t.string(),
    instructions_b: t.string(),
    reason: t.string(),
    created_at: t.timestamp(),
  },
);

// The "push" an agent reacts to.
const instruction = table(
  { name: 'instruction', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    agent_id: t.string().index('btree'),
    conflict_id: t.option(t.u64()),
    text: t.string(),
    acknowledged: t.bool(),
    created_at: t.timestamp(),
  },
);

// Live code (docs/spec-additions-live-code.md part A): one row per Edit/Write an agent
// makes, sent by contract-hook. report_edit keeps the newest FILE_EDITS_PER_AGENT per agent.
const fileEdit = table(
  { name: 'file_edit', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    agent_id: t.string().index('btree'),
    file: t.string().index('btree'),
    diff: t.string(), // unified diff vs the agent's base commit
    symbol_ids: t.array(t.string()), // symbols whose bodies the edit touched
    created_at: t.timestamp(),
  },
);

// One mapper and one coordinator per database (issue #19): the process holding a service
// row re-claims it every few seconds; another laptop can take it once the heartbeat is stale.
const service = table(
  { name: 'service', public: true },
  {
    name: t.string().primaryKey(), // 'coordinator' | 'mapper'
    identity: t.identity(),
    machine: t.string(),
    started_at: t.timestamp(),
    heartbeat_at: t.timestamp(),
    holder: t.string().default(''), // per-process id, so two processes sharing one identity still exclude each other
  },
);

// Token accounting
const run = table(
  { name: 'run', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    mode: t.string(), // RunMode
    seed: t.u32(),
    started_at: t.timestamp(),
    ended_at: t.option(t.timestamp()),
  },
);

const tokenUsage = table(
  { name: 'token_usage', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    run_id: t.u64().index('btree'),
    agent_id: t.string(),
    task_id: t.u64(),
    attempt: t.u32(),
    purpose: t.string(), // Purpose
    prompt_tokens: t.u32(),
    completion_tokens: t.u32(),
    wasted: t.bool(),
    created_at: t.timestamp(),
    // TASKS.md "Scoreboard units": prompt_tokens includes cache reads (~40k per Claude
    // Code turn), so the scoreboard headlines cost_usd and splits fresh vs cached.
    // Appended with defaults so existing databases migrate without --delete-data.
    cache_read_tokens: t.u32().default(0), // part of prompt_tokens served from cache
    cost_usd: t.f64().default(0), // provider-reported cost (Claude Code total_cost_usd)
  },
);

const tokenSaving = table(
  { name: 'token_saving', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    run_id: t.u64(),
    agent_id: t.string(),
    kind: t.string(), // SavingKind
    tokens_avoided_est: t.u32(),
    note: t.string(),
    created_at: t.timestamp(),
  },
);

// Laptop daemons (scripts/control.ts): each laptop's control daemon registers a machine row,
// paired dashboards queue commands for it, and it reports its processes, logs and chat back.
// Nothing listens on a port, so the hosted dashboard can drive any paired laptop.
const machine = table(
  { name: 'machine', public: true },
  {
    id: t.string().primaryKey(), // the laptop's name, e.g. "ethan-mbp"
    identity: t.identity(), // the daemon; only it may write this machine's state
    repo: t.string(), // CONTRACT_TARGET ('' = built-in demo-repo)
    repo_label: t.string(),
    info_json: t.string(), // RepoInfo as JSON ('' = unknown)
    needs_session: t.bool(),
    chat_busy: t.bool(),
    started_at: t.timestamp(),
    heartbeat_at: t.timestamp(),
  },
);

// Who may send commands to a machine. Only the machine's daemon adds rows (after pairing).
const machineAccess = table(
  { name: 'machine_access', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    machine_id: t.string().index('btree'),
    identity: t.identity(),
    label: t.string(),
    added_at: t.timestamp(),
  },
);

// Commands for a daemon. Dashboards insert them; the daemon runs them and marks them done.
const machineCommand = table(
  { name: 'machine_command', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    machine_id: t.string().index('btree'),
    sender: t.identity(),
    action: t.string(), // MachineAction
    args_json: t.string(),
    status: t.string(), // 'pending' | 'done' | 'failed'
    error: t.string(),
    created_at: t.timestamp(),
  },
);

// One row per process a daemon started (key = "<machine_id>/<proc key>"), log = last lines.
const machineProcess = table(
  { name: 'machine_process', public: true },
  {
    key: t.string().primaryKey(),
    machine_id: t.string().index('btree'),
    proc_key: t.string(),
    label: t.string(),
    long: t.bool(),
    status: t.string(), // 'running' | 'exited' | 'stopped'
    code: t.option(t.i32()),
    started_at_ms: t.f64(),
    ended_at_ms: t.option(t.f64()),
    log: t.string(), // newline-joined tail
  },
);

// The daemon's chat assistant transcript, mirrored for every viewer.
const machineChat = table(
  { name: 'machine_chat', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    machine_id: t.string().index('btree'),
    role: t.string(), // 'user' | 'assistant' | 'event'
    text: t.string(),
    at_ms: t.f64(),
  },
);

// A dashboard asking to pair with a machine: proof = sha256("<code>:<its identity hex>"), where
// the code is the one the daemon printed. The daemon checks it, grants access, and deletes the row.
// The code itself never reaches the database, so watching this table doesn't help anyone pair.
const machinePairRequest = table(
  { name: 'machine_pair_request', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    machine_id: t.string().index('btree'),
    identity: t.identity(),
    proof: t.string(),
    created_at: t.timestamp(),
  },
);

// Drives the scheduled expire_claims reducer (every 30 s). Private: nobody subscribes.
const expireClaimsSchedule = table(
  { name: 'expire_claims_schedule' },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
  },
);

const spacetimedb = schema({
  agent,
  task,
  symbol,
  symbolEdge,
  summaryCache,
  plan,
  planItem,
  claim,
  change,
  conflict,
  decision,
  instruction,
  run,
  tokenUsage,
  tokenSaving,
  expireClaimsSchedule,
  fileEdit,
  service,
  machine,
  machineAccess,
  machineCommand,
  machineProcess,
  machineChat,
  machinePairRequest,
});
export default spacetimedb;

// ---------------------------------------------------------------------------------
// Reducer argument types
// ---------------------------------------------------------------------------------

const SymbolInput = t.object('SymbolInput', {
  id: t.string(),
  name: t.string(),
  kind: t.string(),
  signature: t.string(),
  signature_hash: t.string(),
  behavior_note: t.string(),
});

const EdgeInput = t.object('EdgeInput', {
  caller_id: t.string(),
  callee_id: t.string(),
});

const PlanItemInput = t.object('PlanItemInput', {
  symbol_id: t.string(),
  intent: t.string(),
  signature: t.option(t.string()),
});

// ---------------------------------------------------------------------------------
// Helpers (not exported: named exports are reserved for reducers)
// ---------------------------------------------------------------------------------

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function oneOf(value: string, allowed: readonly string[], what: string): void {
  if (!allowed.includes(value)) {
    throw new SenderError(`invalid ${what} '${value}' (expected one of: ${allowed.join(', ')})`);
  }
}

function micros(ts: Timestamp): bigint {
  return ts.microsSinceUnixEpoch;
}

function addSecs(ts: Timestamp, secs: number): Timestamp {
  return new Timestamp(micros(ts) + BigInt(secs) * 1_000_000n);
}

/** The agent row for agent_id, which must be linked to the caller's identity. */
function requireAgent(ctx: Ctx, agentId: string) {
  const row = ctx.db.agent.id.find(agentId);
  if (!row) throw new SenderError(`unknown agent '${agentId}'`);
  if (!row.identity.equals(ctx.sender)) {
    throw new SenderError(`agent '${agentId}' is linked to a different identity`);
  }
  return row;
}

function requireCoordinator(ctx: Ctx): void {
  const row = ctx.db.agent.id.find(COORDINATOR_ID);
  if (!row || !row.identity.equals(ctx.sender)) {
    throw new SenderError('only the coordinator can do this');
  }
}

/**
 * An operator: a caller that is already known to the database in some way. The identity of
 * a registered agent (any id), of a laptop's control daemon (`machine`), or of a dashboard
 * paired with one (`machine_access`). The scripts in scripts/lib.ts connect as this laptop's
 * machine (same saved token as `npm run control`), so run bookkeeping needs no extra setup,
 * while a connection that only knows the public database name can't reset or open runs.
 */
function requireOperator(ctx: Ctx): void {
  for (const a of ctx.db.agent.iter()) if (a.identity.equals(ctx.sender)) return;
  for (const m of ctx.db.machine.iter()) if (m.identity.equals(ctx.sender)) return;
  for (const a of ctx.db.machineAccess.iter()) if (a.identity.equals(ctx.sender)) return;
  throw new SenderError('only an operator can do this: a registered agent, a laptop running npm run control, or a dashboard paired with one');
}

/** The caller must hold the `mapper` service lock (claim_service), as the mapper CLI does. */
function requireMapper(ctx: Ctx): void {
  const row = ctx.db.service.name.find(MAPPER_SERVICE);
  if (!row || !row.identity.equals(ctx.sender)) {
    throw new SenderError('only the mapper can write the code map (hold the mapper service lock first)');
  }
}

function setAgentStatus(ctx: Ctx, agentId: string, status: string): void {
  const row = ctx.db.agent.id.find(agentId);
  if (row && row.status !== status) ctx.db.agent.id.update({ ...row, status });
}

function isLiveConflict(status: string): boolean {
  return status === 'open' || status === 'resolving';
}

/**
 * Inserts a conflict unless an open/resolving one already exists for the same
 * (kind, symbol, agent pair). Returns the new row, or undefined when deduped.
 */
function openConflict(
  ctx: Ctx,
  kind: string,
  symbolId: string,
  agentA: string,
  agentB: string,
  details: string,
) {
  for (const status of ['open', 'resolving']) {
    for (const c of ctx.db.conflict.status.filter(status)) {
      const samePair =
        (c.agent_a === agentA && c.agent_b === agentB) || (c.agent_a === agentB && c.agent_b === agentA);
      if (c.kind === kind && c.symbol_id === symbolId && samePair) return undefined;
    }
  }
  return ctx.db.conflict.insert({
    id: 0n,
    kind,
    symbol_id: symbolId,
    agent_a: agentA,
    agent_b: agentB,
    details,
    status: 'open',
    created_at: ctx.timestamp,
    resolved_at: undefined,
  });
}

function sendInstruction(ctx: Ctx, agentId: string, text: string, conflictId?: bigint): void {
  ctx.db.instruction.insert({
    id: 0n,
    agent_id: agentId,
    conflict_id: conflictId,
    text,
    acknowledged: false,
    created_at: ctx.timestamp,
  });
}

/** Active plan items on symbolId, from any agent. */
/**
 * Symbols that reach `symbolId` through calls, at most `maxHops` callers up, nearest first.
 * `chain` runs from the caller down to (not including) `symbolId`. Cycles are visited once.
 */
function callersUpTo(ctx: Ctx, symbolId: string, maxHops: number) {
  const out: { id: string; chain: string[] }[] = [];
  const seen = new Set([symbolId]);
  let frontier = [{ id: symbolId, chain: [] as string[] }];
  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      const callers = [...ctx.db.symbolEdge.callee_id.filter(f.id)].map((e) => e.caller_id).sort();
      for (const c of callers) {
        if (seen.has(c)) continue;
        seen.add(c);
        next.push({ id: c, chain: [c, ...f.chain] });
      }
    }
    out.push(...next);
    frontier = next;
  }
  return out;
}

function activePlanItemsOn(ctx: Ctx, symbolId: string) {
  const items = [];
  for (const item of ctx.db.planItem.symbol_id.filter(symbolId)) {
    const p = ctx.db.plan.id.find(item.plan_id);
    if (p && p.active) items.push(item);
  }
  return items;
}

/** The unexpired claim on symbolId, if any. */
function liveClaim(ctx: Ctx, symbolId: string) {
  const c = ctx.db.claim.symbol_id.find(symbolId);
  if (!c) return undefined;
  return micros(c.expires_at) > micros(ctx.timestamp) ? c : undefined;
}

/** Unpauses agentId if it is paused and no other live conflict is holding it. */
function maybeUnpause(ctx: Ctx, agentId: string, exceptConflictId: bigint): void {
  const row = ctx.db.agent.id.find(agentId);
  if (!row || row.status !== 'paused') return;
  for (const status of ['open', 'resolving']) {
    for (const c of ctx.db.conflict.status.filter(status)) {
      if (c.id !== exceptConflictId && c.kind === 'broken_dependency' && c.agent_b === agentId) return;
    }
  }
  ctx.db.agent.id.update({ ...row, status: 'working' });
}

/** Rule 3 (claim contention). Returns the holder's id when someone else holds S. */
/** Who reported creating symbolId (the first agent to do so), if any agent did. */
function creatorOf(ctx: Ctx, symbolId: string): string | undefined {
  for (const c of ctx.db.change.iter()) {
    if (c.symbol_id === symbolId && c.kind === 'created') return c.agent_id;
  }
  return undefined;
}

/**
 * Rule 2 (duplicate implementation). agentId plans or creates newId (signature optional).
 * Compares it with existing symbols and with other agents' planned creates. Symbols the
 * agent created itself never count. An existing match also tells the agent to reuse it.
 */
function checkDuplicates(ctx: Ctx, agentId: string, newId: string, newSignature?: string): void {
  const mine = { name: nameOf(newId), signature: newSignature };

  for (const e of [...ctx.db.symbol.iter()]) {
    const creator = creatorOf(ctx, e.id);
    if (creator === agentId) continue;
    const reason =
      e.id === newId ? 'it already exists' : duplicateReason(mine, { name: e.name, signature: e.signature });
    if (!reason) continue;
    if (!creator) {
      // Pre-existing code (from the mapper), not another agent's work: there is nobody to
      // coordinate with, so no conflict (one with the agent on both sides misleads the
      // coordinator). Just point the agent at it, once while the hint is undelivered.
      const text = `${e.id} may already do this (${reason}); reuse it if it fits instead of writing ${newId}.`;
      const pending = [...ctx.db.instruction.agent_id.filter(agentId)].some((i) => !i.acknowledged && i.text === text);
      if (!pending) sendInstruction(ctx, agentId, text);
      continue;
    }
    const c = openConflict(
      ctx,
      'duplicate',
      e.id,
      creator,
      agentId,
      `${agentId} plans to create ${newId}, which duplicates existing ${e.id} (${reason}).`,
    );
    if (c) sendInstruction(ctx, agentId, `${e.id} already does this; reuse it.`, c.id);
  }

  for (const item of [...ctx.db.planItem.iter()]) {
    if (item.intent !== 'create' || item.agent_id === agentId) continue;
    if (ctx.db.symbol.id.find(item.symbol_id)) continue; // already handled as an existing symbol
    const p = ctx.db.plan.id.find(item.plan_id);
    if (!p || !p.active) continue;
    const reason =
      item.symbol_id === newId
        ? 'the same symbol'
        : duplicateReason(mine, { name: nameOf(item.symbol_id), signature: item.signature });
    if (!reason) continue;
    openConflict(
      ctx,
      'duplicate',
      item.symbol_id,
      item.agent_id,
      agentId,
      `${agentId} plans to create ${newId}, which duplicates ${item.agent_id}'s planned ${item.symbol_id} (${reason}).`,
    );
  }
}

function checkContention(ctx: Ctx, agentId: string, symbolId: string, action: string): string | undefined {
  const held = liveClaim(ctx, symbolId);
  if (!held || held.agent_id === agentId) return undefined;
  openConflict(
    ctx,
    'claim_contention',
    symbolId,
    held.agent_id,
    agentId,
    `${agentId} tried to ${action} ${symbolId}, which ${held.agent_id} has claimed.`,
  );
  return held.agent_id;
}

// ---------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------

export const init = spacetimedb.init((ctx) => {
  ctx.db.expireClaimsSchedule.insert({
    scheduled_id: 0n,
    scheduled_at: ScheduleAt.interval(EXPIRE_EVERY_MICROS),
  });
});

// ---------------------------------------------------------------------------------
// Agents and runs
// ---------------------------------------------------------------------------------

export const register_agent = spacetimedb.reducer(
  {
    id: t.string(),
    name: t.string(),
    owner_dev: t.string(),
    machine: t.string(),
    model: t.string(),
    token_budget: t.u64(),
  },
  (ctx, { id, name, owner_dev, machine, model, token_budget }) => {
    if (!id) throw new SenderError('agent id is required');
    const existing = ctx.db.agent.id.find(id);
    if (!existing) {
      ctx.db.agent.insert({
        id,
        identity: ctx.sender,
        name,
        owner_dev,
        machine,
        model,
        status: 'idle',
        current_task_id: undefined,
        token_budget,
        last_heartbeat: ctx.timestamp,
      });
      return;
    }
    if (!existing.identity.equals(ctx.sender)) {
      const silentFor = micros(ctx.timestamp) - micros(existing.last_heartbeat);
      if (silentFor < BigInt(HEARTBEAT_TIMEOUT_SECS) * 1_000_000n) {
        throw new SenderError(`agent id '${id}' is already linked to another identity`);
      }
    }
    ctx.db.agent.id.update({
      ...existing,
      identity: ctx.sender,
      name,
      owner_dev,
      machine,
      model,
      token_budget,
      last_heartbeat: ctx.timestamp,
    });
  },
);

export const heartbeat = spacetimedb.reducer({ agent_id: t.string() }, (ctx, { agent_id }) => {
  const row = requireAgent(ctx, agent_id);
  ctx.db.agent.id.update({ ...row, last_heartbeat: ctx.timestamp });
});

export const start_run = spacetimedb.reducer({ mode: t.string(), seed: t.u32() }, (ctx, { mode, seed }) => {
  requireOperator(ctx);
  oneOf(mode, RUN_MODES, 'run mode');
  for (const r of ctx.db.run.iter()) {
    if (r.ended_at === undefined) throw new SenderError(`run ${r.id} is already open`);
  }
  ctx.db.run.insert({ id: 0n, mode, seed, started_at: ctx.timestamp, ended_at: undefined });
});

export const end_run = spacetimedb.reducer({ run_id: t.u64() }, (ctx, { run_id }) => {
  requireOperator(ctx);
  const r = ctx.db.run.id.find(run_id);
  if (!r) throw new SenderError(`unknown run ${run_id}`);
  if (r.ended_at !== undefined) throw new SenderError(`run ${run_id} already ended`);
  ctx.db.run.id.update({ ...r, ended_at: ctx.timestamp });
});

/**
 * Clears per-run working state before a demo run so nothing leaks from the last one: the
 * code map (the mapper rebuilds it from the clean demo-repo; agent-reported signatures would
 * otherwise survive, since upsert_symbols keeps stored signature text while the hash matches),
 * plans, claims, and undelivered instructions. Live conflicts are dismissed and agents set idle.
 * History the dashboard shows per run (change, conflict, decision, token rows) is kept, as is
 * the summary cache (keyed by content hash, so it stays correct). Refused while a run is open.
 * Operators only (requireOperator): the database name is public.
 */
export const reset_demo_state = spacetimedb.reducer({}, (ctx) => {
  requireOperator(ctx);
  for (const r of ctx.db.run.iter()) {
    if (r.ended_at === undefined) throw new SenderError(`run ${r.id} is still open; end it first`);
  }
  for (const row of [...ctx.db.symbolEdge.iter()]) ctx.db.symbolEdge.id.delete(row.id);
  for (const row of [...ctx.db.symbol.iter()]) ctx.db.symbol.id.delete(row.id);
  for (const row of [...ctx.db.planItem.iter()]) ctx.db.planItem.id.delete(row.id);
  for (const row of [...ctx.db.plan.iter()]) ctx.db.plan.id.delete(row.id);
  for (const row of [...ctx.db.claim.iter()]) ctx.db.claim.symbol_id.delete(row.symbol_id);
  for (const row of [...ctx.db.instruction.iter()]) {
    if (!row.acknowledged) ctx.db.instruction.id.update({ ...row, acknowledged: true });
  }
  for (const status of ['open', 'resolving']) {
    for (const c of [...ctx.db.conflict.status.filter(status)]) {
      ctx.db.conflict.id.update({ ...c, status: 'dismissed', resolved_at: ctx.timestamp });
    }
  }
  for (const a of [...ctx.db.agent.iter()]) {
    if (a.status !== 'idle' || a.current_task_id !== undefined) {
      ctx.db.agent.id.update({ ...a, status: 'idle', current_task_id: undefined });
    }
  }
});

// ---------------------------------------------------------------------------------
// Code map
// ---------------------------------------------------------------------------------

export const upsert_symbols = spacetimedb.reducer(
  { file: t.string(), symbols: t.array(SymbolInput), edges: t.array(EdgeInput) },
  (ctx, { file, symbols, edges }) => {
    requireMapper(ctx);
    const oldById = new Map([...ctx.db.symbol.file.filter(file)].map((s) => [s.id, s]));
    const newIds = new Set(symbols.map((s) => s.id));

    // Drop this file's outgoing edges (old and new callers); they're replaced below.
    for (const callerId of new Set([...oldById.keys(), ...newIds])) {
      for (const e of [...ctx.db.symbolEdge.caller_id.filter(callerId)]) ctx.db.symbolEdge.id.delete(e.id);
    }

    // Symbols that disappeared from the file.
    for (const id of oldById.keys()) {
      if (!newIds.has(id)) ctx.db.symbol.id.delete(id);
    }

    for (const s of symbols) {
      oneOf(s.kind, SYMBOL_KINDS, 'symbol kind');
      const old = oldById.get(s.id) ?? ctx.db.symbol.id.find(s.id);
      const row = { ...s, file, updated_at: ctx.timestamp };
      if (!old) {
        ctx.db.symbol.insert({ ...row, version: 1 });
      } else {
        // Agents own behavior_note (report_change('behavior'); the mapper never sets it),
        // and report_change('signature') rewrites the signature text while the agent's
        // edit is still in its worktree. Keep both while the mapper's hash is unchanged,
        // so a mapper push can never revert an agent's report (issue #25).
        const sameHash = old.signature_hash === s.signature_hash;
        ctx.db.symbol.id.update({
          ...row,
          signature: sameHash ? old.signature : s.signature,
          behavior_note: old.behavior_note,
          version: sameHash ? old.version : old.version + 1,
        });
      }
    }

    for (const e of edges) {
      ctx.db.symbolEdge.insert({ id: 0n, caller_id: e.caller_id, callee_id: e.callee_id });
    }
  },
);

// ---------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------

export const create_task = spacetimedb.reducer(
  { title: t.string(), description: t.string(), agent_id: t.string(), run_id: t.u64() },
  (ctx, { title, description, agent_id, run_id }) => {
    requireOperator(ctx);
    if (!ctx.db.run.id.find(run_id)) throw new SenderError(`unknown run ${run_id}`);
    ctx.db.task.insert({ id: 0n, title, description, agent_id, status: 'todo', attempt: 1, run_id });
  },
);

export const set_task_status = spacetimedb.reducer(
  { task_id: t.u64(), status: t.string() },
  (ctx, { task_id, status }) => {
    oneOf(status, TASK_STATUSES, 'task status');
    const row = ctx.db.task.id.find(task_id);
    if (!row) throw new SenderError(`unknown task ${task_id}`);
    if (row.status === status) return;
    if (!TASK_TRANSITIONS[row.status]?.includes(status)) {
      throw new SenderError(`invalid status change ${row.status} -> ${status}`);
    }
    ctx.db.task.id.update({ ...row, status });

    // Keep the assigned agent's row in step so the dashboard reads one place.
    const a = ctx.db.agent.id.find(row.agent_id);
    if (!a) return;
    if (status === 'in_progress') {
      ctx.db.agent.id.update({ ...a, status: 'working', current_task_id: task_id });
    } else if (status === 'done' || status === 'discarded') {
      ctx.db.agent.id.update({ ...a, status: status === 'done' ? 'done' : 'idle', current_task_id: undefined });
    }
  },
);

// ---------------------------------------------------------------------------------
// Plans and claims
// ---------------------------------------------------------------------------------

export const publish_plan = spacetimedb.reducer(
  { agent_id: t.string(), task_id: t.u64(), summary: t.string(), items: t.array(PlanItemInput) },
  (ctx, { agent_id, task_id, summary, items }) => {
    requireAgent(ctx, agent_id);
    for (const item of items) {
      oneOf(item.intent, INTENTS, 'plan intent');
      if (item.intent !== 'create' && !ctx.db.symbol.id.find(item.symbol_id)) {
        throw new SenderError(`plan item references unknown symbol '${item.symbol_id}'`);
      }
    }

    for (const old of [...ctx.db.plan.agent_id.filter(agent_id)]) {
      if (old.active) ctx.db.plan.id.update({ ...old, active: false });
    }
    const p = ctx.db.plan.insert({
      id: 0n,
      agent_id,
      task_id,
      summary,
      active: true,
      created_at: ctx.timestamp,
    });
    for (const item of items) {
      ctx.db.planItem.insert({
        id: 0n,
        plan_id: p.id,
        agent_id,
        symbol_id: item.symbol_id,
        intent: item.intent,
        signature: item.signature || undefined,
      });
    }

    // Rule 3: planning to modify a symbol someone else has claimed.
    for (const item of items) {
      if (item.intent === 'modify') checkContention(ctx, agent_id, item.symbol_id, 'plan to modify');
    }
    // Rule 2: planning to create something that already exists or is planned elsewhere.
    for (const item of items) {
      if (item.intent === 'create') checkDuplicates(ctx, agent_id, item.symbol_id, item.signature || undefined);
    }
  },
);

export const claim_symbol = spacetimedb.reducer(
  { agent_id: t.string(), symbol_id: t.string(), ttl_secs: t.u32() },
  (ctx, { agent_id, symbol_id, ttl_secs }) => {
    requireAgent(ctx, agent_id);
    // Rule 3. Not a throw: throwing would roll back the conflict row too. The claim
    // stays with its holder; the client sees that and reports "already claimed".
    if (checkContention(ctx, agent_id, symbol_id, 'claim')) return;

    const ttl = ttl_secs > 0 ? ttl_secs : DEFAULT_CLAIM_TTL_SECS;
    const row = { symbol_id, agent_id, claimed_at: ctx.timestamp, expires_at: addSecs(ctx.timestamp, ttl) };
    if (ctx.db.claim.symbol_id.find(symbol_id)) ctx.db.claim.symbol_id.update(row);
    else ctx.db.claim.insert(row);
  },
);

export const release_claim = spacetimedb.reducer(
  { agent_id: t.string(), symbol_id: t.string() },
  (ctx, { agent_id, symbol_id }) => {
    requireAgent(ctx, agent_id);
    const c = ctx.db.claim.symbol_id.find(symbol_id);
    if (!c || c.agent_id !== agent_id) throw new SenderError(`${agent_id} doesn't hold a claim on ${symbol_id}`);
    ctx.db.claim.symbol_id.delete(symbol_id);
  },
);

// ---------------------------------------------------------------------------------
// Changes and Rule 1
// ---------------------------------------------------------------------------------

export const report_change = spacetimedb.reducer(
  {
    agent_id: t.string(),
    symbol_id: t.string(),
    kind: t.string(),
    new_signature: t.option(t.string()),
    description: t.string(),
  },
  (ctx, { agent_id, symbol_id, kind, new_signature, description }) => {
    requireAgent(ctx, agent_id);
    oneOf(kind, CHANGE_KINDS, 'change kind');

    const sym = ctx.db.symbol.id.find(symbol_id);
    if (kind !== 'created' && !sym) throw new SenderError(`unknown symbol '${symbol_id}'`);
    if (REQUIRE_CLAIM_FOR_CHANGE && kind !== 'created') {
      const held = liveClaim(ctx, symbol_id);
      if (!held || held.agent_id !== agent_id) throw new SenderError(`${agent_id} hasn't claimed ${symbol_id}`);
    }

    ctx.db.change.insert({
      id: 0n,
      agent_id,
      symbol_id,
      kind,
      old_signature: sym?.signature,
      new_signature,
      description,
      created_at: ctx.timestamp,
    });

    // Update the shared code map row.
    if (kind === 'created') {
      if (!sym) {
        const hash = symbol_id.lastIndexOf('#');
        ctx.db.symbol.insert({
          id: symbol_id,
          name: hash >= 0 ? symbol_id.slice(hash + 1) : symbol_id,
          kind: 'function',
          file: hash >= 0 ? symbol_id.slice(0, hash) : '',
          signature: new_signature ?? '',
          signature_hash: '',
          behavior_note: description,
          version: 1,
          updated_at: ctx.timestamp,
        });
      }
      // Rule 2 again, now that the real signature is known (catches same-type helpers
      // whose names differ, e.g. formatDate vs toDisplayDate).
      checkDuplicates(ctx, agent_id, symbol_id, new_signature);
      return; // nobody can depend on a brand-new symbol yet
    }
    if (sym) {
      ctx.db.symbol.id.update({
        ...sym,
        signature: kind === 'signature' && new_signature !== undefined ? new_signature : sym.signature,
        behavior_note: kind === 'behavior' ? description : sym.behavior_note,
        version: sym.version + 1,
        updated_at: ctx.timestamp,
      });
    }

    // Rule 1: who is affected? (a) active plans that depend on S;
    // (b) active plans that modify, create or depend on a symbol that reaches S through calls,
    // up to RULE1_MAX_HOPS callers up (depending on checkout means relying on what
    // calculateFee returns through computeTotal). Breadth-first, so the nearest path wins.
    const affected = new Map<string, string>(); // agent id -> why
    for (const item of activePlanItemsOn(ctx, symbol_id)) {
      if (item.agent_id !== agent_id && item.intent === 'depend') {
        affected.set(item.agent_id, `its plan depends on ${symbol_id}`);
      }
    }
    for (const { id: callerId, chain } of callersUpTo(ctx, symbol_id, RULE1_MAX_HOPS)) {
      for (const item of activePlanItemsOn(ctx, callerId)) {
        if (item.agent_id !== agent_id && !affected.has(item.agent_id)) {
          const verb = item.intent === 'depend' ? 'depends on' : 'changes';
          affected.set(item.agent_id, `its plan ${verb} ${chain.map((id) => `${id}, which calls `).join('')}${symbol_id}`);
        }
      }
    }

    for (const [other, why] of affected) {
      const details = `${agent_id} reported a ${kind} change to ${symbol_id} (${description}); ${other} is affected because ${why}.`;
      const c = openConflict(ctx, 'broken_dependency', symbol_id, agent_id, other, details);
      if (!c) continue; // already an open conflict for this pair
      setAgentStatus(ctx, other, 'paused');
      sendInstruction(ctx, other, `${symbol_id} was changed by ${agent_id}. Pause and wait for the coordinator.`, c.id);
    }
  },
);

// ---------------------------------------------------------------------------------
// Coordinator decisions
// ---------------------------------------------------------------------------------

/** Coordinator step 1 (spec section 12): take an open conflict so it isn't handled twice. */
export const mark_conflict_resolving = spacetimedb.reducer(
  { conflict_id: t.u64() },
  (ctx, { conflict_id }) => {
    requireCoordinator(ctx);
    const c = ctx.db.conflict.id.find(conflict_id);
    if (!c) throw new SenderError(`unknown conflict ${conflict_id}`);
    if (c.status !== 'open') throw new SenderError(`conflict ${conflict_id} is ${c.status}, not open`);
    ctx.db.conflict.id.update({ ...c, status: 'resolving' });
  },
);

export const resolve_conflict = spacetimedb.reducer(
  {
    conflict_id: t.u64(),
    owner_agent: t.string(),
    instructions_a: t.string(),
    instructions_b: t.string(),
    reason: t.string(),
  },
  (ctx, { conflict_id, owner_agent, instructions_a, instructions_b, reason }) => {
    requireCoordinator(ctx);
    const c = ctx.db.conflict.id.find(conflict_id);
    if (!c) throw new SenderError(`unknown conflict ${conflict_id}`);
    // 'resolving' is allowed too: the coordinator marks a conflict resolving while it thinks.
    if (!isLiveConflict(c.status)) throw new SenderError(`conflict ${conflict_id} is ${c.status}, not open`);
    if (owner_agent !== c.agent_a && owner_agent !== c.agent_b) {
      throw new SenderError(`owner_agent '${owner_agent}' is not part of conflict ${conflict_id}`);
    }

    ctx.db.decision.insert({
      id: 0n,
      conflict_id,
      owner_agent,
      instructions_a,
      instructions_b,
      reason,
      created_at: ctx.timestamp,
    });
    sendInstruction(ctx, c.agent_a, instructions_a, conflict_id);
    sendInstruction(ctx, c.agent_b, instructions_b, conflict_id);
    ctx.db.conflict.id.update({ ...c, status: 'resolved', resolved_at: ctx.timestamp });
    maybeUnpause(ctx, c.agent_a, conflict_id);
    maybeUnpause(ctx, c.agent_b, conflict_id);
  },
);

export const dismiss_conflict = spacetimedb.reducer(
  { conflict_id: t.u64(), reason: t.string() },
  (ctx, { conflict_id, reason }) => {
    requireCoordinator(ctx);
    const c = ctx.db.conflict.id.find(conflict_id);
    if (!c) throw new SenderError(`unknown conflict ${conflict_id}`);
    if (!isLiveConflict(c.status)) throw new SenderError(`conflict ${conflict_id} is ${c.status}, not open`);
    ctx.db.conflict.id.update({ ...c, status: 'dismissed', resolved_at: ctx.timestamp });
    // A paused worker waits for an instruction before resuming, so tell it.
    const paused = ctx.db.agent.id.find(c.agent_b);
    if (paused && paused.status === 'paused') {
      sendInstruction(ctx, c.agent_b, `False alarm on ${c.symbol_id}: ${reason}. Continue your task.`, conflict_id);
    }
    maybeUnpause(ctx, c.agent_a, conflict_id);
    maybeUnpause(ctx, c.agent_b, conflict_id);
  },
);

export const acknowledge_instruction = spacetimedb.reducer(
  { instruction_id: t.u64() },
  (ctx, { instruction_id }) => {
    const row = ctx.db.instruction.id.find(instruction_id);
    if (!row) throw new SenderError(`unknown instruction ${instruction_id}`);
    requireAgent(ctx, row.agent_id); // caller must be the instruction's agent
    if (!row.acknowledged) ctx.db.instruction.id.update({ ...row, acknowledged: true });
  },
);

/**
 * Takes or renews the lock on a singleton service (issue #19). `holder` is a per-process
 * id: the same holder renews (the heartbeat), anyone else is refused until the heartbeat is
 * older than SERVICE_TIMEOUT_SECS. Call it again every few seconds.
 */
export const claim_service = spacetimedb.reducer(
  { name: t.string(), machine: t.string(), holder: t.string() },
  (ctx, { name, machine, holder }) => {
    if (!name || !holder) throw new SenderError('service name and holder are required');
    const row = ctx.db.service.name.find(name);
    if (!row) {
      ctx.db.service.insert({ name, identity: ctx.sender, machine, holder, started_at: ctx.timestamp, heartbeat_at: ctx.timestamp });
      return;
    }
    const mine = row.holder === holder && row.identity.equals(ctx.sender);
    const stale = micros(ctx.timestamp) - micros(row.heartbeat_at) > BigInt(SERVICE_TIMEOUT_SECS) * 1_000_000n;
    if (!mine && !stale) {
      throw new SenderError(`${name} is already running on ${row.machine}; stop it there first (or wait ${SERVICE_TIMEOUT_SECS} s after it crashed)`);
    }
    ctx.db.service.name.update({
      ...row,
      identity: ctx.sender,
      machine,
      holder,
      started_at: mine ? row.started_at : ctx.timestamp,
      heartbeat_at: ctx.timestamp,
    });
  },
);

/** Releases a service lock the caller holds (no-op otherwise). */
export const release_service = spacetimedb.reducer({ name: t.string(), holder: t.string() }, (ctx, { name, holder }) => {
  const row = ctx.db.service.name.find(name);
  if (row && row.holder === holder && row.identity.equals(ctx.sender)) ctx.db.service.name.delete(name);
});

/**
 * Live diff stream (spec-additions part A): contract-hook reports each edit with its diff
 * and the symbols it touched. Only the newest FILE_EDITS_PER_AGENT rows per agent are kept.
 */
export const report_edit = spacetimedb.reducer(
  { agent_id: t.string(), file: t.string(), diff: t.string(), symbol_ids: t.array(t.string()) },
  (ctx, { agent_id, file, diff, symbol_ids }) => {
    requireAgent(ctx, agent_id);
    if (!file) throw new SenderError('file is empty');
    const body = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + '\n… (diff truncated)' : diff;
    ctx.db.fileEdit.insert({ id: 0n, agent_id, file, diff: body, symbol_ids, created_at: ctx.timestamp });
    const mine = [...ctx.db.fileEdit.agent_id.filter(agent_id)].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const old of mine.slice(0, Math.max(0, mine.length - FILE_EDITS_PER_AGENT))) ctx.db.fileEdit.id.delete(old.id);
  },
);

/**
 * Operator message from the dashboard (issue #11): steer a running agent mid-task.
 * agent_id '*' sends to every working or paused worker. The text is stored with the
 * OPERATOR_PREFIX so workers and the dashboard can tell it from rule/coordinator pushes
 * without a schema change. Open to any caller, like create_task (the dashboard is the
 * operator console); a read-only public dashboard is issue #20.
 */
export const send_instruction = spacetimedb.reducer(
  { agent_id: t.string(), text: t.string() },
  (ctx, { agent_id, text }) => {
    const body = text.trim();
    if (!body) throw new SenderError('message is empty');
    if (body.length > 2000) throw new SenderError('message is longer than 2000 characters');
    const isWorker = (id: string) => id !== COORDINATOR_ID && id !== 'mapper';
    let targets: string[];
    if (agent_id === '*') {
      targets = [...ctx.db.agent.iter()]
        .filter((a) => isWorker(a.id) && (a.status === 'working' || a.status === 'paused'))
        .map((a) => a.id);
      if (!targets.length) throw new SenderError('no working agents to message');
    } else {
      if (!ctx.db.agent.id.find(agent_id) || !isWorker(agent_id)) throw new SenderError(`unknown agent '${agent_id}'`);
      targets = [agent_id];
    }
    for (const id of targets) sendInstruction(ctx, id, OPERATOR_PREFIX + body);
  },
);

// ---------------------------------------------------------------------------------
// Token accounting
// ---------------------------------------------------------------------------------

export const log_tokens = spacetimedb.reducer(
  {
    run_id: t.u64(),
    agent_id: t.string(),
    task_id: t.u64(),
    attempt: t.u32(),
    purpose: t.string(),
    prompt_tokens: t.u32(),
    completion_tokens: t.u32(),
    cache_read_tokens: t.u32(),
    cost_usd: t.f64(),
  },
  (ctx, args) => {
    requireAgent(ctx, args.agent_id);
    if (args.cache_read_tokens > args.prompt_tokens) throw new SenderError('cache_read_tokens exceeds prompt_tokens');
    if (!(args.cost_usd >= 0)) throw new SenderError('cost_usd must be a non-negative number');
    oneOf(args.purpose, PURPOSES, 'token purpose');
    ctx.db.tokenUsage.insert({ id: 0n, ...args, wasted: false, created_at: ctx.timestamp });
  },
);

export const mark_attempt_wasted = spacetimedb.reducer(
  { task_id: t.u64(), attempt: t.u32() },
  (ctx, { task_id, attempt }) => {
    requireOperator(ctx);
    for (const row of [...ctx.db.tokenUsage.iter()]) {
      if (row.task_id === task_id && row.attempt === attempt && !row.wasted) {
        ctx.db.tokenUsage.id.update({ ...row, wasted: true });
      }
    }
    const tk = ctx.db.task.id.find(task_id);
    if (tk && tk.attempt <= attempt) ctx.db.task.id.update({ ...tk, attempt: attempt + 1 });
  },
);

export const log_saving = spacetimedb.reducer(
  { run_id: t.u64(), agent_id: t.string(), kind: t.string(), tokens_avoided_est: t.u32(), note: t.string() },
  (ctx, args) => {
    oneOf(args.kind, SAVING_KINDS, 'saving kind');
    ctx.db.tokenSaving.insert({ id: 0n, ...args, created_at: ctx.timestamp });
  },
);

export const cache_summary = spacetimedb.reducer(
  { key: t.string(), summary: t.string(), summary_tokens: t.u32() },
  (ctx, { key, summary, summary_tokens }) => {
    const old = ctx.db.summaryCache.key.find(key);
    if (old) ctx.db.summaryCache.key.update({ ...old, summary, summary_tokens });
    else ctx.db.summaryCache.insert({ key, summary, summary_tokens, hits: 0 });
  },
);

export const record_cache_hit = spacetimedb.reducer({ key: t.string() }, (ctx, { key }) => {
  const old = ctx.db.summaryCache.key.find(key);
  if (old) ctx.db.summaryCache.key.update({ ...old, hits: old.hits + 1 });
});

// ---------------------------------------------------------------------------------
// Scheduled housekeeping (every 30 s)
// ---------------------------------------------------------------------------------

export const expire_claims = spacetimedb.reducer(
  { onSchedule: expireClaimsSchedule },
  { timer: expireClaimsSchedule.rowType },
  (ctx, _args) => {
    const now = micros(ctx.timestamp);
    for (const c of [...ctx.db.claim.iter()]) {
      if (micros(c.expires_at) <= now) ctx.db.claim.symbol_id.delete(c.symbol_id);
    }
    const cutoff = now - BigInt(HEARTBEAT_TIMEOUT_SECS) * 1_000_000n;
    for (const a of [...ctx.db.agent.iter()]) {
      // 'done' agents finished their work; leave them so the dashboard shows it.
      if ((a.status === 'working' || a.status === 'paused') && micros(a.last_heartbeat) < cutoff) {
        ctx.db.agent.id.update({ ...a, status: 'idle' });
      }
    }
  },
);

// ---------------------------------------------------------------------------------
// Laptop daemons (scripts/control.ts)
// ---------------------------------------------------------------------------------

const MACHINE_ACTIONS = ['coordinator', 'session-start', 'session-merge', 'worker', 'judge', 'reset', 'repo', 'stop', 'forget', 'chat'] as const;
const MACHINE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_COMMAND_ARGS = 8_000;
const MAX_PENDING_COMMANDS = 20;
const COMMANDS_KEPT = 50;
const CHAT_KEPT = 200;
const MAX_PROCESS_LOG = 16_000;
const MAX_CHAT_TEXT = 8_000;

/** The machine row, which must belong to the caller (its daemon). */
function requireMachine(ctx: Ctx, machineId: string) {
  const row = ctx.db.machine.id.find(machineId);
  if (!row) throw new SenderError(`unknown machine '${machineId}'`);
  if (!row.identity.equals(ctx.sender)) throw new SenderError(`machine '${machineId}' belongs to another daemon`);
  return row;
}

function hasMachineAccess(ctx: Ctx, machineId: string): boolean {
  for (const a of ctx.db.machineAccess.machine_id.filter(machineId)) if (a.identity.equals(ctx.sender)) return true;
  return false;
}

/**
 * A daemon claims its machine id. The same identity re-registers freely (restart); another
 * identity can take the id only after HEARTBEAT_TIMEOUT_SECS of silence, and the takeover
 * drops every pairing, queued command and process row, so old dashboards can't drive the
 * new daemon and the new daemon never sees the old one's commands.
 */
export const register_machine = spacetimedb.reducer({ id: t.string() }, (ctx, { id }) => {
  if (!MACHINE_ID.test(id)) throw new SenderError('machine id: lowercase letters, digits, dots, dashes and underscores');
  const existing = ctx.db.machine.id.find(id);
  const fresh = { id, identity: ctx.sender, repo: '', repo_label: 'demo-repo', info_json: '', needs_session: false, chat_busy: false, started_at: ctx.timestamp, heartbeat_at: ctx.timestamp };
  if (!existing) {
    ctx.db.machine.insert(fresh);
    return;
  }
  if (existing.identity.equals(ctx.sender)) {
    ctx.db.machine.id.update({ ...existing, started_at: ctx.timestamp, heartbeat_at: ctx.timestamp, chat_busy: false });
    return;
  }
  if (micros(ctx.timestamp) - micros(existing.heartbeat_at) < BigInt(HEARTBEAT_TIMEOUT_SECS) * 1_000_000n) {
    throw new SenderError(`machine '${id}' is online with another daemon; stop it first (or wait ${HEARTBEAT_TIMEOUT_SECS} s)`);
  }
  for (const a of [...ctx.db.machineAccess.machine_id.filter(id)]) ctx.db.machineAccess.id.delete(a.id);
  for (const c of [...ctx.db.machineCommand.machine_id.filter(id)]) ctx.db.machineCommand.id.delete(c.id);
  for (const p of [...ctx.db.machineProcess.machine_id.filter(id)]) ctx.db.machineProcess.key.delete(p.key);
  for (const m of [...ctx.db.machineChat.machine_id.filter(id)]) ctx.db.machineChat.id.delete(m.id);
  for (const r of [...ctx.db.machinePairRequest.machine_id.filter(id)]) ctx.db.machinePairRequest.id.delete(r.id);
  ctx.db.machine.id.update(fresh);
});

/** The daemon's heartbeat, carrying what the dashboard shows about the laptop. */
export const update_machine = spacetimedb.reducer(
  { id: t.string(), repo: t.string(), repo_label: t.string(), info_json: t.string(), needs_session: t.bool(), chat_busy: t.bool() },
  (ctx, { id, repo, repo_label, info_json, needs_session, chat_busy }) => {
    const row = requireMachine(ctx, id);
    if (info_json.length > MAX_COMMAND_ARGS) throw new SenderError('info_json is too long');
    ctx.db.machine.id.update({ ...row, repo, repo_label, info_json, needs_session, chat_busy, heartbeat_at: ctx.timestamp });
  },
);

/** Pairs a dashboard identity with this machine. Only the machine's daemon can do it. */
export const grant_machine_access = spacetimedb.reducer(
  { machine_id: t.string(), identity: t.identity(), label: t.string() },
  (ctx, { machine_id, identity, label }) => {
    requireMachine(ctx, machine_id);
    for (const a of ctx.db.machineAccess.machine_id.filter(machine_id)) if (a.identity.equals(identity)) return;
    ctx.db.machineAccess.insert({ id: 0n, machine_id, identity, label: label.slice(0, 80), added_at: ctx.timestamp });
  },
);

/** Unpairs a dashboard: the daemon can remove anyone, a dashboard only itself. */
export const revoke_machine_access = spacetimedb.reducer(
  { machine_id: t.string(), identity: t.identity() },
  (ctx, { machine_id, identity }) => {
    const m = ctx.db.machine.id.find(machine_id);
    const daemon = m?.identity.equals(ctx.sender) ?? false;
    if (!daemon && !identity.equals(ctx.sender)) throw new SenderError('only the daemon can unpair other dashboards');
    for (const a of [...ctx.db.machineAccess.machine_id.filter(machine_id)]) if (a.identity.equals(identity)) ctx.db.machineAccess.id.delete(a.id);
  },
);

/** Queues a command for a machine's daemon. The caller must be paired with that machine. */
export const send_machine_command = spacetimedb.reducer(
  { machine_id: t.string(), action: t.string(), args_json: t.string() },
  (ctx, { machine_id, action, args_json }) => {
    const m = ctx.db.machine.id.find(machine_id);
    if (!m) throw new SenderError(`unknown machine '${machine_id}'`);
    if (!m.identity.equals(ctx.sender) && !hasMachineAccess(ctx, machine_id)) {
      throw new SenderError(`this dashboard isn't paired with ${machine_id}; pair it from the daemon's terminal first`);
    }
    if (!(MACHINE_ACTIONS as readonly string[]).includes(action)) throw new SenderError(`unknown action '${action}'`);
    if (args_json.length > MAX_COMMAND_ARGS) throw new SenderError('command is too long');
    const queued = [...ctx.db.machineCommand.machine_id.filter(machine_id)].filter((c) => c.status === 'pending').length;
    if (queued >= MAX_PENDING_COMMANDS) throw new SenderError(`${machine_id} has ${queued} commands waiting; is its daemon running?`);
    ctx.db.machineCommand.insert({ id: 0n, machine_id, sender: ctx.sender, action, args_json, status: 'pending', error: '', created_at: ctx.timestamp });
  },
);

/** The daemon marks a command done or failed; only the newest COMMANDS_KEPT per machine stay. */
export const finish_machine_command = spacetimedb.reducer(
  { command_id: t.u64(), ok: t.bool(), error: t.string() },
  (ctx, { command_id, ok, error }) => {
    const c = ctx.db.machineCommand.id.find(command_id);
    if (!c) throw new SenderError(`unknown command ${command_id}`);
    requireMachine(ctx, c.machine_id);
    ctx.db.machineCommand.id.update({ ...c, status: ok ? 'done' : 'failed', error: error.slice(0, 2000) });
    const done = [...ctx.db.machineCommand.machine_id.filter(c.machine_id)].filter((r) => r.status !== 'pending').sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const old of done.slice(0, Math.max(0, done.length - COMMANDS_KEPT))) ctx.db.machineCommand.id.delete(old.id);
  },
);

/** The daemon reports one process (insert or update). */
export const put_machine_process = spacetimedb.reducer(
  {
    machine_id: t.string(), proc_key: t.string(), label: t.string(), long: t.bool(), status: t.string(),
    code: t.option(t.i32()), started_at_ms: t.f64(), ended_at_ms: t.option(t.f64()), log: t.string(),
  },
  (ctx, a) => {
    requireMachine(ctx, a.machine_id);
    if (!a.proc_key) throw new SenderError('proc_key is empty');
    const log = a.log.length > MAX_PROCESS_LOG ? a.log.slice(-MAX_PROCESS_LOG) : a.log;
    if (!['running', 'exited', 'stopped'].includes(a.status)) throw new SenderError(`unknown process status '${a.status}'`);
    const row = { ...a, code: a.code, ended_at_ms: a.ended_at_ms, key: `${a.machine_id}/${a.proc_key}`, log };
    if (ctx.db.machineProcess.key.find(row.key)) ctx.db.machineProcess.key.update(row);
    else ctx.db.machineProcess.insert(row);
  },
);

export const delete_machine_process = spacetimedb.reducer({ machine_id: t.string(), proc_key: t.string() }, (ctx, { machine_id, proc_key }) => {
  requireMachine(ctx, machine_id);
  ctx.db.machineProcess.key.delete(`${machine_id}/${proc_key}`);
});

/** The daemon appends a chat line; only the newest CHAT_KEPT per machine stay. */
export const post_machine_chat = spacetimedb.reducer(
  { machine_id: t.string(), role: t.string(), text: t.string(), at_ms: t.f64() },
  (ctx, { machine_id, role, text, at_ms }) => {
    requireMachine(ctx, machine_id);
    if (!['user', 'assistant', 'event'].includes(role)) throw new SenderError(`unknown chat role '${role}'`);
    ctx.db.machineChat.insert({ id: 0n, machine_id, role, text: text.slice(0, MAX_CHAT_TEXT), at_ms });
    const mine = [...ctx.db.machineChat.machine_id.filter(machine_id)].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const old of mine.slice(0, Math.max(0, mine.length - CHAT_KEPT))) ctx.db.machineChat.id.delete(old.id);
  },
);

const MAX_PAIR_REQUESTS = 20;

/** A dashboard asks to pair with a machine (see machine_pair_request). Oldest requests drop past the cap. */
export const request_machine_pairing = spacetimedb.reducer(
  { machine_id: t.string(), proof: t.string() },
  (ctx, { machine_id, proof }) => {
    if (!ctx.db.machine.id.find(machine_id)) throw new SenderError(`unknown machine '${machine_id}'`);
    if (!/^[0-9a-f]{64}$/.test(proof)) throw new SenderError('proof must be a sha256 hex digest');
    const reqs = [...ctx.db.machinePairRequest.machine_id.filter(machine_id)].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const old of reqs.slice(0, Math.max(0, reqs.length - MAX_PAIR_REQUESTS + 1))) ctx.db.machinePairRequest.id.delete(old.id);
    ctx.db.machinePairRequest.insert({ id: 0n, machine_id, identity: ctx.sender, proof, created_at: ctx.timestamp });
  },
);

/** The daemon answers a pairing request: grants access when the proof matched, and always deletes the request. */
export const resolve_machine_pairing = spacetimedb.reducer(
  { request_id: t.u64(), accept: t.bool(), label: t.string() },
  (ctx, { request_id, accept, label }) => {
    const r = ctx.db.machinePairRequest.id.find(request_id);
    if (!r) return; // already answered
    requireMachine(ctx, r.machine_id);
    ctx.db.machinePairRequest.id.delete(r.id);
    if (!accept) return;
    for (const a of ctx.db.machineAccess.machine_id.filter(r.machine_id)) if (a.identity.equals(r.identity)) return;
    ctx.db.machineAccess.insert({ id: 0n, machine_id: r.machine_id, identity: r.identity, label: label.slice(0, 80), added_at: ctx.timestamp });
  },
);
