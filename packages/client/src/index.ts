// Contract client library (spec section 10). Owner: agents.
//
// This file freezes the client API so the worker, MCP server, hook, coordinator,
// mapper and triage can all code against it now. Method bodies are TODO until the
// server module is published and bindings are generated into ./bindings.
// Once bindings exist, replace the hand-written row types below with the generated ones.
import type { Purpose, Usage } from '@contract/llm';

export type Intent = 'modify' | 'create' | 'depend';
export type ChangeKind = 'signature' | 'behavior' | 'created' | 'removed';
export type AgentStatus = 'idle' | 'working' | 'paused' | 'done';
export type SavingKind = 'early_stop' | 'reuse' | 'context_slice' | 'cache_hit' | 'auto_resolve';

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
}

export interface PlanItem {
  symbolId: string;
  intent: Intent;
}

export interface Instruction {
  id: bigint;
  agentId: string;
  conflictId?: bigint;
  text: string;
  acknowledged: boolean;
}

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
  onInstruction(cb: (instr: Instruction) => void): () => void; // returns unsubscribe
  onStatusChange(cb: (status: AgentStatus) => void): () => void;
  ack(instructionId: bigint): Promise<void>;
  pendingInstructions(): Instruction[];

  // Token savers
  getContext(symbolIds: string[], depth?: number): Promise<SymbolContext[]>;
  findExisting(q: { name: string; params?: string[]; returns?: string }): Promise<ExistingMatch[]>;
  getSummary(file: string): Promise<string | undefined>;
  putSummary(file: string, summary: string, tokens: number): Promise<void>;

  // Accounting
  logTokens(taskId: bigint, attempt: number, purpose: Purpose, usage: Usage): Promise<void>;
  markAttemptWasted(taskId: bigint, attempt: number): Promise<void>;
  logSaving(kind: SavingKind, tokensAvoidedEst: number, note: string): Promise<void>;

  disconnect(): Promise<void>;
}

/** Calls register_agent, starts a 15 s heartbeat, subscribes to this agent's rows. */
export async function connect(_opts: ConnectOptions): Promise<ContractClient> {
  throw new Error('ContractClient.connect: not implemented yet (needs generated bindings)');
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
    onInstruction: () => () => {},
    onStatusChange: () => () => {},
    ack: nothing,
    pendingInstructions: () => [],
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
