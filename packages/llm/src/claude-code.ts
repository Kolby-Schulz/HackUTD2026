// LLM_PROVIDER=claude-code: runs the local Claude Code CLI headless (`claude -p`).
// Uses whatever account `claude` is logged into on this machine; no API key needed.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  LLMAbortError,
  type DecideOptions,
  type DecideResult,
  type LLM,
  type StreamEvent,
  type Usage,
  type WorkerOptions,
  type WorkerResult,
} from './types.ts';

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';

// Only load MCP servers we pass via --mcp-config, never the user's personal ones.
// Personal MCP tool definitions cost ~9k prompt tokens per call and differ per laptop.
const ISOLATION_FLAGS = ['--strict-mcp-config'];

// Replaces Claude Code's large default system prompt for decide() (no tools there).
const DEFAULT_DECIDE_SYSTEM =
  'You help coordinate AI coding agents working on one repository. Answer concisely.';

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ResultEvent extends StreamEvent {
  type: 'result';
  is_error: boolean;
  result: string;
  session_id: string;
  total_cost_usd: number;
  structured_output?: unknown;
  usage: RawUsage;
}

function toUsage(u: RawUsage, costUsd: number, estimated = false): Usage {
  return {
    prompt_tokens:
      (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    completion_tokens: u.output_tokens ?? 0,
    cache_read_tokens: u.cache_read_input_tokens ?? 0,
    cost_usd: costUsd,
    ...(estimated ? { estimated } : {}),
  };
}

/**
 * Runs `claude -p --output-format stream-json --verbose` and resolves with the final result event.
 * Tracks per-message usage from assistant events so an aborted run can still report an estimate.
 */
function runCli(
  args: string[],
  prompt: string,
  cwd: string,
  opts: { signal?: AbortSignal; env?: Record<string, string>; onEvent?: (e: StreamEvent) => void; onSessionId?: (id: string) => void },
): Promise<ResultEvent> {
  return new Promise((resolve, reject) => {
    let sessionId: string | undefined;
    const perMessage = new Map<string, RawUsage>(); // message id -> latest usage snapshot
    const streamedChars = new Map<string, number>();
    let currentMsg: string | undefined;
    const partial = (): Usage => {
      const sum: RawUsage = {};
      for (const u of perMessage.values())
        for (const k of Object.keys(u) as (keyof RawUsage)[])
          if (typeof u[k] === 'number') sum[k] = (sum[k] ?? 0) + u[k]!;
      return toUsage(sum, 0, true);
    };

    if (opts.signal?.aborted) return reject(new LLMAbortError());
    const child = spawn(CLAUDE_BIN, ['-p', '--output-format', 'stream-json', '--verbose', ...args], {
      cwd,
      signal: opts.signal,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let result: ResultEvent | undefined;
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      let ev: StreamEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.session_id && !sessionId) {
        sessionId = ev.session_id;
        opts.onSessionId?.(sessionId);
      }
      if (ev.type === 'assistant') {
        const msg = ev.message as { id?: string; usage?: RawUsage } | undefined;
        if (msg?.id && msg.usage) perMessage.set(msg.id, msg.usage);
      }
      // With --include-partial-messages: input usage arrives at message_start; output
      // tokens only at the end, so estimate in-flight output as streamed chars / 4.
      if (ev.type === 'stream_event') {
        const e = ev.event as { type: string; message?: { id: string; usage?: RawUsage }; delta?: Record<string, string> };
        if (e.type === 'message_start' && e.message) {
          currentMsg = e.message.id;
          perMessage.set(currentMsg, { ...e.message.usage, output_tokens: 0 });
        } else if (e.type === 'content_block_delta' && currentMsg && e.delta) {
          const chars = (e.delta.text ?? e.delta.thinking ?? e.delta.partial_json ?? '').length;
          const u = perMessage.get(currentMsg)!;
          streamedChars.set(currentMsg, (streamedChars.get(currentMsg) ?? 0) + chars);
          u.output_tokens = Math.max(u.output_tokens ?? 0, Math.ceil(streamedChars.get(currentMsg)! / 4));
        }
      }
      if (ev.type === 'result') result = ev as ResultEvent;
      opts.onEvent?.(ev);
    });

    child.on('error', (e) => {
      if (e.name === 'AbortError') reject(new LLMAbortError(sessionId, partial()));
      else reject(e);
    });
    child.on('close', (code) => {
      if (opts.signal?.aborted) return reject(new LLMAbortError(sessionId, partial()));
      if (!result) return reject(new Error(`claude exited ${code} without a result: ${stderr.trim()}`));
      if (result.is_error) return reject(new Error(`claude: ${result.result}`));
      resolve(result);
    });
    child.stdin.end(prompt); // prompt via stdin avoids arg-length limits
  });
}

export class ClaudeCodeLLM implements LLM {
  constructor(
    private workerModel = process.env.WORKER_MODEL ?? 'claude-sonnet-5-5',
    private decideModel = process.env.COORDINATOR_MODEL ?? 'claude-opus-5-5',
  ) {}

  async decide<T = unknown>(
    prompt: string,
    jsonSchema: Record<string, unknown>,
    opts: DecideOptions,
  ): Promise<DecideResult<T>> {
    const args = [
      '--model', opts.model ?? this.decideModel,
      '--tools', '',
      '--no-session-persistence',
      '--setting-sources', '', // ignore personal settings/CLAUDE.md: same behavior on every laptop
      '--system-prompt', opts.system ?? DEFAULT_DECIDE_SYSTEM,
      '--json-schema', JSON.stringify(jsonSchema),
      ...ISOLATION_FLAGS,
    ];
    try {
      const r = await runCli(args, prompt, process.cwd(), { signal: opts.signal });
      const usage = toUsage(r.usage, r.total_cost_usd);
      await opts.onUsage?.(usage, opts.purpose);
      return { output: (r.structured_output ?? parseJson(r.result)) as T, usage };
    } catch (e) {
      if (e instanceof LLMAbortError && e.usage) await opts.onUsage?.(e.usage, opts.purpose);
      throw e;
    }
  }

  async runWorker(task: string, opts: WorkerOptions): Promise<WorkerResult> {
    const purpose = opts.purpose ?? 'code';
    const args = [
      '--model', opts.model ?? this.workerModel,
      '--permission-mode', 'acceptEdits',
      '--include-partial-messages', // live usage, so an early stop can still be counted
      ...ISOLATION_FLAGS,
    ];
    if (opts.appendSystemPrompt) args.push('--append-system-prompt', opts.appendSystemPrompt);
    if (opts.mcpConfig) args.push('--mcp-config', opts.mcpConfig);
    if (opts.settings) args.push('--settings', opts.settings);
    if (opts.allowedTools?.length) args.push('--allowedTools', ...opts.allowedTools);
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);

    try {
      const r = await runCli(args, task, opts.cwd, opts);
      const usage = toUsage(r.usage, r.total_cost_usd);
      await opts.onUsage?.(usage, purpose);
      return { sessionId: r.session_id, usage, text: r.result };
    } catch (e) {
      // Early stop: still log what the killed run spent (marked estimated).
      if (e instanceof LLMAbortError && e.usage) await opts.onUsage?.(e.usage, purpose);
      throw e;
    }
  }
}

function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}
