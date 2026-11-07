// Shared LLM interface for workers and the coordinator.
// Every model call in the repo goes through packages/llm so tokens are always logged.

export type Purpose = 'plan' | 'code' | 'context' | 'test_fix' | 'merge_fix' | 'coordination';

/** Matches the spec's token_usage columns. */
export interface Usage {
  prompt_tokens: number; // input + cache writes + cache reads
  completion_tokens: number;
}

export interface CallOptions {
  purpose: Purpose;
  model?: string; // defaults come from WORKER_MODEL / COORDINATOR_MODEL
  signal?: AbortSignal; // worker aborts on pause (early stop)
  onUsage?: (usage: Usage, purpose: Purpose) => void | Promise<void>; // -> contract.logTokens
}

export interface ChatOptions extends CallOptions {
  system?: string;
  /** JSON Schema. When set, the reply is parsed and returned as `json`. */
  jsonSchema?: Record<string, unknown>;
}

export interface AgentOptions extends CallOptions {
  /** Working directory the agent edits (the worker's git worktree). */
  cwd: string;
  /** Built-in tools the agent may use, e.g. ['Read', 'Edit', 'Write', 'Bash(npm test:*)']. */
  allowedTools?: string[];
  appendSystemPrompt?: string;
  /** Path to an MCP config JSON (later: the Contract MCP server). */
  mcpConfig?: string;
  /** Continue an earlier run, e.g. after a coordinator instruction. */
  resumeSessionId?: string;
  /** Path to a settings JSON passed as --settings (e.g. Contract's Edit/Write hooks). */
  settings?: string;
  /** Extra env for the claude process; hooks inherit it (e.g. CONTRACT_AGENT_ID). */
  env?: Record<string, string>;
}

export interface ChatResult<T = unknown> {
  text: string;
  json?: T;
  usage: Usage;
  costUsd: number;
}

export interface AgentResult {
  text: string;
  usage: Usage;
  costUsd: number;
  sessionId: string;
}

export interface LLM {
  /** One model reply with no tools: plans, coordinator decisions. */
  chat<T = unknown>(prompt: string, opts: ChatOptions): Promise<ChatResult<T>>;
  /** A full coding-agent run in `cwd` that edits files and runs tests itself. */
  runAgent(prompt: string, opts: AgentOptions): Promise<AgentResult>;
}

export class LLMAbortError extends Error {
  constructor() {
    super('LLM call aborted');
    this.name = 'LLMAbortError';
  }
}
