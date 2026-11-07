// Backend that runs the local Claude Code CLI headless (`claude -p`).
// Uses whatever account `claude` is logged into on this machine; no API key needed.
import { spawn } from 'node:child_process';
import {
  LLMAbortError,
  type AgentOptions,
  type AgentResult,
  type ChatOptions,
  type ChatResult,
  type LLM,
  type Usage,
} from './types.ts';

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';

interface CliResult {
  type: 'result';
  is_error: boolean;
  result: string;
  session_id: string;
  total_cost_usd: number;
  structured_output?: unknown;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

function toUsage(u: CliResult['usage']): Usage {
  return {
    prompt_tokens:
      u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    completion_tokens: u.output_tokens,
  };
}

function runCli(
  args: string[],
  prompt: string,
  cwd: string,
  signal?: AbortSignal,
  env?: Record<string, string>,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LLMAbortError());
    const child = spawn(CLAUDE_BIN, ['-p', '--output-format', 'json', ...args], {
      cwd,
      signal,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(e.name === 'AbortError' ? new LLMAbortError() : e));
    child.on('close', (code) => {
      if (signal?.aborted) return reject(new LLMAbortError());
      let parsed: CliResult;
      try {
        parsed = JSON.parse(out);
      } catch {
        return reject(new Error(`claude exited ${code}: ${err || out}`.trim()));
      }
      if (parsed.is_error) return reject(new Error(`claude: ${parsed.result}`));
      resolve(parsed);
    });
    child.stdin.end(prompt); // prompt via stdin avoids arg-length limits
  });
}

function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

export class ClaudeCodeLLM implements LLM {
  constructor(private defaultModel = process.env.WORKER_MODEL ?? 'claude-sonnet-5-5') {}

  async chat<T = unknown>(prompt: string, opts: ChatOptions): Promise<ChatResult<T>> {
    const args = ['--model', opts.model ?? this.defaultModel, '--tools', '', '--no-session-persistence'];
    if (opts.system) args.push('--system-prompt', opts.system);
    if (opts.jsonSchema) args.push('--json-schema', JSON.stringify(opts.jsonSchema));

    const r = await runCli(args, prompt, process.cwd(), opts.signal);
    const usage = toUsage(r.usage);
    await opts.onUsage?.(usage, opts.purpose);

    let json: T | undefined;
    if (opts.jsonSchema) json = (r.structured_output ?? parseJson(r.result)) as T;
    return { text: r.result, json, usage, costUsd: r.total_cost_usd };
  }

  async runAgent(prompt: string, opts: AgentOptions): Promise<AgentResult> {
    const args = ['--model', opts.model ?? this.defaultModel, '--permission-mode', 'acceptEdits'];
    if (opts.allowedTools?.length) args.push('--allowedTools', ...opts.allowedTools);
    if (opts.appendSystemPrompt) args.push('--append-system-prompt', opts.appendSystemPrompt);
    if (opts.mcpConfig) args.push('--mcp-config', opts.mcpConfig);
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
    if (opts.settings) args.push('--settings', opts.settings);

    const r = await runCli(args, prompt, opts.cwd, opts.signal, opts.env);
    const usage = toUsage(r.usage);
    await opts.onUsage?.(usage, opts.purpose);
    return { text: r.result, usage, costUsd: r.total_cost_usd, sessionId: r.session_id };
  }
}
