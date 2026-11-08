// packages/llm interface (spec section 12): decide() and runWorker().
// Every model call in the repo goes through here so tokens are always logged
// and the provider can be swapped with LLM_PROVIDER.

export type Purpose = 'plan' | 'code' | 'context' | 'test_fix' | 'merge_fix' | 'coordination' | 'triage' | 'design';

/** Matches the spec's token_usage columns, plus cost. */
export interface Usage {
  prompt_tokens: number; // input + cache writes + cache reads
  completion_tokens: number;
  /** Part of prompt_tokens served from cache (~10x cheaper). Claude Code re-sends ~40k
   *  tokens of agent prompt per turn, mostly cached; show this separately on the scoreboard. */
  cache_read_tokens: number;
  cost_usd: number;
  /** true when the run was stopped early and the numbers come from partial stream events. */
  estimated?: boolean;
}

export interface BaseOptions {
  purpose: Purpose;
  model?: string; // defaults: WORKER_MODEL / COORDINATOR_MODEL
  signal?: AbortSignal; // abort = early stop
  onUsage?: (usage: Usage, purpose: Purpose) => void | Promise<void>; // -> contract.logTokens
}

export interface DecideOptions extends BaseOptions {
  system?: string;
}

export interface WorkerOptions extends Omit<BaseOptions, 'purpose'> {
  purpose?: Purpose; // default 'code'
  /** The agent's git worktree. */
  cwd: string;
  /** Contract rules (spec section 11). Omit in without_contract mode. */
  appendSystemPrompt?: string;
  /** Path to the Contract MCP config. Omit in without_contract mode. */
  mcpConfig?: string;
  /** Path or JSON for --settings, e.g. the contract-hook config. Omit in without_contract mode. */
  settings?: string;
  /** Extra env for the claude process; the MCP server and hooks inherit it. */
  env?: Record<string, string>;
  /** Tools allowed without prompting, e.g. ['Bash(npm test:*)', 'mcp__contract']. */
  allowedTools?: string[];
  /** Resume an earlier session, e.g. with a coordinator decision. */
  resumeSessionId?: string;
  /** Raw stream events, for live progress. */
  onEvent?: (event: StreamEvent) => void;
  /** Called as soon as the session id is known (before the run finishes). */
  onSessionId?: (sessionId: string) => void;
}

export interface DecideResult<T> {
  output: T;
  usage: Usage;
}

export interface WorkerResult {
  sessionId: string;
  usage: Usage;
  /** The agent's final message. */
  text: string;
}

export type StreamEvent = { type: string; subtype?: string; session_id?: string; [k: string]: unknown };

export interface LLM {
  /** One structured decision, no tools: plans, coordinator decisions, triage fallback. */
  decide<T = unknown>(prompt: string, jsonSchema: Record<string, unknown>, opts: DecideOptions): Promise<DecideResult<T>>;
  /** A full coding-agent run in opts.cwd that edits files and runs tests itself. */
  runWorker(task: string, opts: WorkerOptions): Promise<WorkerResult>;
}

/** Thrown when a call is aborted. Carries whatever was known when it stopped. */
export class LLMAbortError extends Error {
  constructor(
    public sessionId?: string,
    public usage?: Usage,
  ) {
    super('LLM call aborted');
    this.name = 'LLMAbortError';
  }
}
