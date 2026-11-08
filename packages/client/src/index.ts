// Contract client library (spec section 10). Owner: agents.
//
// The API types below are frozen; every process (worker, MCP server, hook, coordinator,
// mapper, triage) codes against them. connect() talks to the server through the
// generated bindings in ./bindings (regenerate with `npm run generate -w @contract/server`).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Purpose, Usage } from '@contract/llm';
import { DbConnection } from './bindings/index.ts';
import { buildContext, estimateTokens, rankExisting, summaryKey } from './context.ts';

export type Intent = 'modify' | 'create' | 'depend';
export type ChangeKind = 'signature' | 'behavior' | 'created' | 'removed';
export type AgentStatus = 'idle' | 'working' | 'paused' | 'done';
export type TaskStatus = 'todo' | 'in_progress' | 'paused' | 'done' | 'discarded';
export type SavingKind = 'early_stop' | 'reuse' | 'context_slice' | 'cache_hit' | 'auto_resolve';

/** Generated table row types (camelCase fields), for code that reads tables directly. */
export type * as rows from './bindings/types.ts';
export { DbConnection } from './bindings/index.ts';
export { estimateTokens } from './context.ts';
export { identitiesFile, identityKey, readSavedToken, writeSavedToken } from './identity.ts';
export { holdService, SERVICE_HEARTBEAT_MS, type ServiceLock } from './service.ts';
export { resolveTarget, checkTools, subdirPrefix, cloneDirFor, DEMO_CHECKS, type Target, type Check } from './target.ts';

export interface AgentInfo {
  id: string; // 'agent-a', or the fixed ids 'coordinator', 'mapper', 'triage'
  name: string;
  ownerDev: string;
  machine: string;
  model: string; // 'claude-code' now
  tokenBudget: number;
}

export interface ConnectOptions {
  host: string; // SPACETIME_HOST
  dbName: string; // SPACETIME_DB_NAME
  agent: AgentInfo;
  /**
   * SpacetimeDB auth token. The worker script, its MCP server and its hook are three
   * processes acting as ONE agent; pass the worker's token to the other two
   * (env CONTRACT_TOKEN) so register_agent doesn't reject them as a different identity.
   */
  token?: string;
  /** Skip register_agent/heartbeat, for short-lived processes like contract-hook. */
  noHeartbeat?: boolean;
  /**
   * Directory that symbol `file` paths are relative to (the agent's demo-repo checkout).
   * Used to hash files for the summary cache and to estimate tokens saved. Default: cwd.
   */
  repoDir?: string;
  /** Milliseconds to wait for the connection and first subscription. Default 10 s. */
  timeoutMs?: number;
  /**
   * Reconnect after a dropped connection (issue #19): same token, re-register, resubscribe,
   * listeners kept. Calls fail fast while it's down. Default: on unless noHeartbeat.
   */
  reconnect?: boolean;
}

export interface PlanItem {
  symbolId: string;
  intent: Intent;
  /** For intent 'create': the signature you will write, so duplicates are caught by type at plan time. */
  signature?: string;
}

export interface Instruction {
  id: bigint;
  agentId: string;
  conflictId?: bigint;
  text: string;
  acknowledged: boolean;
}

/** Prefix the server's send_instruction puts on operator (dashboard) messages (issue #11). */
export const OPERATOR_PREFIX = 'Operator: ';
export const isOperatorInstruction = (i: Pick<Instruction, 'text' | 'conflictId'>) =>
  i.conflictId === undefined && i.text.startsWith(OPERATOR_PREFIX);

export interface SymbolContext {
  id: string;
  signature: string;
  behaviorNote: string;
  summary?: string;
  callers: string[];
  callees: string[];
}

export interface ExistingMatch {
  symbolId: string;
  signature: string;
  score: number;
}

export interface ContractClient {
  readonly agentId: string;
  /** The SpacetimeDB auth token for this identity (hand to the MCP server / hook). */
  readonly token: string;

  // Coordination
  publishPlan(taskId: bigint, summary: string, items: PlanItem[]): Promise<void>;
  claim(symbolId: string, ttlSecs?: number): Promise<void>; // throws if someone else holds it
  release(symbolId: string): Promise<void>;
  reportChange(
    symbolId: string,
    kind: ChangeKind,
    opts: { newSignature?: string; description: string },
  ): Promise<void>;

  // Live pushes
  /** Live diff stream (issue #24): usually sent by contract-hook, not the model. */
  reportEdit(file: string, diff: string, symbolIds: string[]): Promise<void>;
  onInstruction(cb: (instr: Instruction) => void): () => void; // returns unsubscribe
  onStatusChange(cb: (status: AgentStatus) => void): () => void;
  ack(instructionId: bigint): Promise<void>;
  pendingInstructions(): Instruction[];
  /** This agent's current status from its agent row (undefined if not registered). */
  status(): AgentStatus | undefined;

  // Tasks and claims (used by the worker script at the start/end of a run)
  setTaskStatus(taskId: bigint, status: TaskStatus): Promise<void>;
  /** Symbol ids this agent currently holds a claim on. */
  myClaims(): string[];

  // Token savers
  getContext(symbolIds: string[], depth?: number): Promise<SymbolContext[]>;
  findExisting(q: { name: string; params?: string[]; returns?: string }): Promise<ExistingMatch[]>;
  /**
   * Cached summary of the file's current content. Counts a cache hit (record_cache_hit +
   * a cache_hit saving) unless `countHit: false`, for callers that count it later once
   * they know the summary was used instead of the file.
   */
  getSummary(file: string, opts?: { countHit?: boolean }): Promise<string | undefined>;
  putSummary(file: string, summary: string, tokens: number): Promise<void>;

  // Accounting
  logTokens(taskId: bigint, attempt: number, purpose: Purpose, usage: Usage): Promise<void>;
  markAttemptWasted(taskId: bigint, attempt: number): Promise<void>;
  logSaving(kind: SavingKind, tokensAvoidedEst: number, note: string): Promise<void>;

  disconnect(): Promise<void>;
}

/** Thrown by claim() when another agent holds an unexpired claim on the symbol. */
export class ClaimedError extends Error {
  constructor(
    readonly symbolId: string,
    readonly holder: string,
  ) {
    super(`${symbolId} is already claimed by ${holder}`);
    this.name = 'ClaimedError';
  }
}

export const HEARTBEAT_MS = 15_000;
export const DEFAULT_CLAIM_TTL_SECS = 300;
const U32_MAX = 4_294_967_295;

/** SQL string literal (single quotes doubled). */
const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** Reducer u32 arguments: whole, non-negative, capped. */
const u32 = (n: number) => Math.min(U32_MAX, Math.max(0, Math.round(n)));

function toInstruction(row: {
  id: bigint;
  agentId: string;
  conflictId: bigint | undefined;
  text: string;
  acknowledged: boolean;
}): Instruction {
  return {
    id: row.id,
    agentId: row.agentId,
    ...(row.conflictId !== undefined ? { conflictId: row.conflictId } : {}),
    text: row.text,
    acknowledged: row.acknowledged,
  };
}

/** Shared between the connection callbacks and the client: set once the socket closes. */
interface ConnState {
  closed: boolean;
  reason?: string;
  /** disconnect() was called: never reconnect. */
  stopped?: boolean;
  /** Called on an unexpected drop. */
  onDrop?: () => void;
}

/** Backoff between reconnect attempts: 1 s, 2 s, 4 s … capped at 30 s. */
export const reconnectDelayMs = (attempt: number) => Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));

/** Opens the WebSocket, waits for the identity/token and the first subscription. */
function openConnection(opts: ConnectOptions, state: ConnState): Promise<{ conn: DbConnection; token: string }> {
  const agentId = opts.agent.id;
  // This agent's rows (spec section 10), plus the shared tables the token savers read.
  const queries = [
    `SELECT * FROM agent WHERE id = ${sql(agentId)}`,
    `SELECT * FROM instruction WHERE agent_id = ${sql(agentId)}`,
    `SELECT * FROM conflict WHERE agent_a = ${sql(agentId)}`,
    `SELECT * FROM conflict WHERE agent_b = ${sql(agentId)}`,
    'SELECT * FROM decision',
    'SELECT * FROM claim',
    'SELECT * FROM run',
    'SELECT * FROM symbol',
    'SELECT * FROM symbol_edge',
    'SELECT * FROM summary_cache',
  ];

  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`connect: no response from ${opts.host} (${opts.dbName}) within ${opts.timeoutMs ?? 10_000} ms`)),
      opts.timeoutMs ?? 10_000,
    );
    const fail = (e: unknown) => {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const conn: DbConnection = DbConnection.builder()
      .withUri(opts.host)
      .withDatabaseName(opts.dbName)
      .withToken(opts.token)
      .onConnect((_ctx, _identity, token) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            clearTimeout(timer);
            resolvePromise({ conn, token });
          })
          .onError((ctx) => fail(new Error(`connect: subscription failed: ${String(ctx.event ?? 'unknown error')}`)))
          .subscribe(queries);
      })
      .onConnectError((_ctx, err) => fail(err))
      .onDisconnect((_ctx, err) => {
        if (state.closed) return; // disconnect() already recorded why
        state.closed = true;
        state.reason = err ? String(err) : 'connection lost';
        console.warn(`[contract] ${opts.agent.id}: ${state.reason}`);
        state.onDrop?.();
      })
      .build();
  });
}

/** Calls register_agent, starts a 15 s heartbeat, subscribes to this agent's rows. */
export async function connect(opts: ConnectOptions): Promise<ContractClient> {
  let state: ConnState = { closed: false };
  const first = await openConnection(opts, state);
  let conn = first.conn;
  const token = first.token;
  const agentId = opts.agent.id;
  /** Fail fast instead of hanging when the connection is gone. */
  const live = () => {
    if (state.closed) throw new Error(`ContractClient(${agentId}): connection closed (${state.reason ?? 'disconnected'})`);
  };
  const repoDir = opts.repoDir ?? process.cwd();
  // Reassigned on reconnect; every method below reads these, never a captured copy.
  let r = conn.reducers;
  let db = conn.db;

  // Listeners live here, not on the connection's cache, so they survive a reconnect.
  const instrCbs = new Set<(i: Instruction) => void>();
  const statusCbs = new Set<(s: AgentStatus) => void>();
  const bindListeners = (c: DbConnection) => {
    c.db.instruction.onInsert((_ctx, row) => {
      if (row.agentId === agentId) for (const cb of instrCbs) cb(toInstruction(row));
    });
    c.db.agent.onUpdate((_ctx, oldRow, newRow) => {
      if (newRow.id === agentId && newRow.status !== oldRow.status) for (const cb of statusCbs) cb(newRow.status as AgentStatus);
    });
  };
  bindListeners(conn);

  const register = () =>
    r.registerAgent({
      id: agentId,
      name: opts.agent.name,
      ownerDev: opts.agent.ownerDev,
      machine: opts.agent.machine,
      model: opts.agent.model,
      tokenBudget: BigInt(Math.max(0, Math.round(opts.agent.tokenBudget))),
    });

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (!opts.noHeartbeat) {
    try {
      await register();
    } catch (e) {
      conn.disconnect();
      throw e;
    }
    heartbeat = setInterval(() => {
      if (state.closed) return; // reconnecting (or stopped): skip this beat
      r.heartbeat({ agentId }).catch((e: unknown) => console.warn(`[contract] heartbeat failed: ${String(e)}`));
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
  }

  // Reconnect loop: same token (same identity), re-register, fresh subscription, listeners rebound.
  const reconnect = opts.reconnect ?? !opts.noHeartbeat;
  const scheduleReconnect = (attempt = 0) => {
    if (!reconnect || state.stopped) return;
    const timer = setTimeout(async () => {
      if (state.stopped) return;
      const next: ConnState = { closed: false };
      try {
        const o = await openConnection({ ...opts, token }, next);
        if (state.stopped) return o.conn.disconnect();
        conn = o.conn;
        r = conn.reducers;
        db = conn.db;
        bindListeners(conn);
        if (!opts.noHeartbeat) await register();
        next.onDrop = () => scheduleReconnect(0);
        state = next;
        console.warn(`[contract] ${agentId}: reconnected`);
      } catch (e) {
        console.warn(`[contract] ${agentId}: reconnect attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
        scheduleReconnect(attempt + 1);
      }
    }, reconnectDelayMs(attempt));
    timer.unref?.();
  };
  state.onDrop = () => scheduleReconnect(0);

  /** The open run (or, if none is open, the newest one) that token rows belong to. */
  function currentRunId(): bigint {
    let best: { id: bigint; open: boolean } | undefined;
    for (const run of db.run.iter()) {
      const open = run.endedAt === undefined;
      if (!best || (open && !best.open) || (open === best.open && run.id > best.id)) best = { id: run.id, open };
    }
    return best?.id ?? 0n;
  }

  /** File contents relative to repoDir, or undefined when unreadable. */
  function readRepoFile(file: string): string | undefined {
    try {
      return readFileSync(resolve(repoDir, file), 'utf8');
    } catch {
      return undefined;
    }
  }

  function cachedSummary(file: string) {
    const content = readRepoFile(file);
    if (content === undefined) return undefined;
    const row = db.summaryCache.key.find(summaryKey(file, content));
    return row ? { row, content } : undefined;
  }

  const client: ContractClient = {
    agentId,
    token,

    async publishPlan(taskId, summary, items) {
      live();
      await r.publishPlan({ agentId, taskId, summary, items: items.map((i) => ({ symbolId: i.symbolId, intent: i.intent, signature: i.signature?.trim() || undefined })) });
    },

    async claim(symbolId, ttlSecs = DEFAULT_CLAIM_TTL_SECS) {
      live();
      await r.claimSymbol({ agentId, symbolId, ttlSecs: u32(ttlSecs) });
      // claim_symbol never throws on contention (a throw would also roll back the
      // conflict it records); the claim row tells us who holds it.
      const holder = db.claim.symbolId.find(symbolId)?.agentId;
      if (holder !== agentId) throw new ClaimedError(symbolId, holder ?? 'another agent');
    },

    async release(symbolId) {
      live();
      await r.releaseClaim({ agentId, symbolId });
    },

    async reportChange(symbolId, kind, o) {
      live();
      await r.reportChange({ agentId, symbolId, kind, newSignature: o.newSignature, description: o.description });
    },

    async reportEdit(file, diff, symbolIds) {
      live();
      await r.reportEdit({ agentId, file, diff, symbolIds });
    },

    onInstruction(cb) {
      instrCbs.add(cb);
      return () => void instrCbs.delete(cb);
    },

    onStatusChange(cb) {
      statusCbs.add(cb);
      return () => void statusCbs.delete(cb);
    },

    async ack(instructionId) {
      live();
      await r.acknowledgeInstruction({ instructionId });
    },

    pendingInstructions() {
      return [...db.instruction.iter()]
        .filter((i) => i.agentId === agentId && !i.acknowledged)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(toInstruction);
    },

    status() {
      return db.agent.id.find(agentId)?.status as AgentStatus | undefined;
    },

    async setTaskStatus(taskId, status) {
      live();
      await r.setTaskStatus({ taskId, status });
    },

    myClaims() {
      return [...db.claim.iter()].filter((c) => c.agentId === agentId).map((c) => c.symbolId).sort();
    },

    async getContext(symbolIds, depth = 1) {
      live();
      const symbols = new Map([...db.symbol.iter()].map((s) => [s.id, s]));
      const slice = buildContext(symbolIds, depth, symbols, [...db.symbolEdge.iter()], (file) => cachedSummary(file)?.row.summary);
      // Savings estimate: the whole files these symbols live in vs. the slice returned.
      const files = new Set(slice.map((c) => symbols.get(c.id)!.file));
      const fileTokens = [...files].reduce((n, f) => n + estimateTokens(readRepoFile(f) ?? ''), 0);
      const avoided = fileTokens - estimateTokens(JSON.stringify(slice));
      if (slice.length && avoided > 0) {
        await client
          .logSaving('context_slice', avoided, `get_context ${symbolIds.join(', ')} (depth ${depth})`)
          .catch(() => {});
      }
      return slice;
    },

    async findExisting(q) {
      live();
      return rankExisting(q, db.symbol.iter());
    },

    async getSummary(file, { countHit = true } = {}) {
      live();
      const hit = cachedSummary(file);
      if (!hit) return undefined;
      if (!countHit) return hit.row.summary;
      await r.recordCacheHit({ key: hit.row.key });
      const avoided = estimateTokens(hit.content) - hit.row.summaryTokens;
      if (avoided > 0) await client.logSaving('cache_hit', avoided, `summary of ${file}`).catch(() => {});
      return hit.row.summary;
    },

    async putSummary(file, summary, tokens) {
      live();
      const content = readRepoFile(file);
      if (content === undefined) throw new Error(`putSummary: can't read ${file} under ${repoDir}`);
      await r.cacheSummary({ key: summaryKey(file, content), summary, summaryTokens: u32(tokens) });
    },

    async logTokens(taskId, attempt, purpose, usage) {
      live();
      const promptTokens = u32(usage.prompt_tokens);
      await r.logTokens({
        runId: currentRunId(),
        agentId,
        taskId,
        attempt: u32(attempt),
        purpose,
        promptTokens,
        completionTokens: u32(usage.completion_tokens),
        // The server rejects cache reads above prompt tokens and negative/NaN cost;
        // clamp here so an odd estimate never loses the whole row.
        cacheReadTokens: Math.min(promptTokens, u32(usage.cache_read_tokens ?? 0)),
        costUsd: Number.isFinite(usage.cost_usd) && usage.cost_usd > 0 ? usage.cost_usd : 0,
      });
    },

    async markAttemptWasted(taskId, attempt) {
      live();
      await r.markAttemptWasted({ taskId, attempt: u32(attempt) });
    },

    async logSaving(kind, tokensAvoidedEst, note) {
      live();
      await r.logSaving({ runId: currentRunId(), agentId, kind, tokensAvoidedEst: u32(tokensAvoidedEst), note });
    },

    async disconnect() {
      if (heartbeat) clearInterval(heartbeat);
      state.stopped = true;
      if (state.closed) return;
      state.closed = true;
      state.reason = 'disconnect() called';
      conn.disconnect();
    },
  };
  return client;
}

/**
 * No-op client for without_contract mode: every coordination call does nothing,
 * but logTokens still records usage so the baseline run is measured (spec section 11).
 */
export function noopClient(agentId: string, logTokens: ContractClient['logTokens']): ContractClient {
  const nothing = async () => {};
  return {
    agentId,
    token: '',
    publishPlan: nothing,
    claim: nothing,
    release: nothing,
    reportChange: nothing,
    reportEdit: async () => {},
    onInstruction: () => () => {},
    onStatusChange: () => () => {},
    ack: nothing,
    pendingInstructions: () => [],
    status: () => undefined,
    setTaskStatus: nothing,
    myClaims: () => [],
    getContext: async () => [],
    findExisting: async () => [],
    getSummary: async () => undefined,
    putSummary: nothing,
    logTokens,
    markAttemptWasted: nothing,
    logSaving: nothing,
    disconnect: nothing,
  };
}
