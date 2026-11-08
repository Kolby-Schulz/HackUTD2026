// LLM_PROVIDER=nemotron: NVIDIA hosted Nemotron through the OpenAI-compatible API
// (spec sections 4 and 12). Only decide() for now: the coordinator's structured decisions.
// runWorker() (the `--engine nemotron` tool loop, spec section 11) is phase 2.
//
// Nemotron 3.5 models are reasoning models: the reply carries `reasoning_content` (thinking)
// and `content` (the answer). We read `content` only. Thinking is off by default: with it on, a
// coordinator decision took ~16 s and ~1.6k tokens; off, under 1 s and ~60 tokens.
import OpenAI from 'openai';
import {
  LLMAbortError,
  type DecideOptions,
  type DecideResult,
  type LLM,
  type Purpose,
  type Usage,
  type WorkerOptions,
  type WorkerResult,
} from './types.ts';

export const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_NEMOTRON_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

const DEFAULT_SYSTEM = 'You help coordinate AI coding agents working on one repository. Answer concisely.';

/** The slice of the OpenAI client we use, so tests can pass a fake. */
export interface ChatClient {
  chat: {
    completions: {
      create(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<ChatResponse>;
    };
  };
}

export interface ChatResponse {
  choices: { finish_reason: string | null; message: { content: string | null; reasoning_content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number | null } | null };
}

export interface NemotronOptions {
  client?: ChatClient;
  apiKey?: string;
  baseURL?: string;
  /** Model for coordination and triage decisions. */
  coordinatorModel?: string;
  /** Model for every other decide() purpose (plans etc.). */
  workerModel?: string;
  maxTokens?: number;
  /** Let the model think before answering. Slower and costlier; off by default. */
  thinking?: boolean;
  /** USD per million tokens, for the cost column. The hackathon tier is free, so default 0. */
  priceInPerM?: number;
  priceOutPerM?: number;
}

/** Bad or missing answer from the model. The coordinator retries once, then falls back. */
export class NemotronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NemotronError';
  }
}

const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));

export class NemotronLLM implements LLM {
  private client: ChatClient;
  private coordinatorModel: string;
  private workerModel: string;
  private maxTokens: number;
  private thinking: boolean;
  private priceIn: number;
  private priceOut: number;

  constructor(o: NemotronOptions = {}) {
    const env = process.env;
    if (o.client) this.client = o.client;
    else {
      const apiKey = o.apiKey ?? env.NVIDIA_API_KEY;
      if (!apiKey) throw new Error('NVIDIA_API_KEY is not set (get one at build.nvidia.com and put it in .env)');
      this.client = new OpenAI({ apiKey, baseURL: o.baseURL ?? env.NVIDIA_BASE_URL ?? DEFAULT_NVIDIA_BASE_URL }) as unknown as ChatClient;
    }
    this.coordinatorModel = o.coordinatorModel ?? env.NVIDIA_COORDINATOR_MODEL ?? DEFAULT_NEMOTRON_MODEL;
    this.workerModel = o.workerModel ?? env.NVIDIA_WORKER_MODEL ?? DEFAULT_NEMOTRON_MODEL;
    this.thinking = o.thinking ?? env.NVIDIA_THINKING === 'on';
    // Thinking needs room: 20 tokens left `content` null in our first test call.
    this.maxTokens = o.maxTokens ?? num(env.NVIDIA_MAX_TOKENS) ?? (this.thinking ? 8192 : 2048);
    this.priceIn = o.priceInPerM ?? num(env.NVIDIA_PRICE_IN_PER_M) ?? 0;
    this.priceOut = o.priceOutPerM ?? num(env.NVIDIA_PRICE_OUT_PER_M) ?? 0;
  }

  /** The model decide() uses for a purpose (also what the coordinator records as its model). */
  modelFor(purpose: Purpose): string {
    return purpose === 'coordination' || purpose === 'triage' ? this.coordinatorModel : this.workerModel;
  }

  async decide<T = unknown>(prompt: string, jsonSchema: Record<string, unknown>, opts: DecideOptions): Promise<DecideResult<T>> {
    if (opts.signal?.aborted) throw new LLMAbortError();
    const body = {
      model: opts.model ?? this.modelFor(opts.purpose),
      temperature: 0,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: opts.system ?? DEFAULT_SYSTEM },
        {
          role: 'user',
          content: `${prompt}\n\nReply with one JSON object matching this JSON schema, and nothing else:\n${JSON.stringify(jsonSchema)}`,
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: jsonSchema, strict: true } },
      chat_template_kwargs: { enable_thinking: this.thinking },
    };

    let res: ChatResponse;
    try {
      res = await this.client.chat.completions.create(body, { signal: opts.signal });
    } catch (e) {
      if (opts.signal?.aborted) throw new LLMAbortError(undefined, this.toUsage(undefined, true));
      throw e;
    }

    // Log the tokens even when the answer turns out unusable: they were spent.
    const usage = this.toUsage(res.usage);
    await opts.onUsage?.(usage, opts.purpose);

    const choice = res.choices?.[0];
    const content = choice?.message?.content;
    if (!content?.trim()) {
      throw new NemotronError(
        choice?.finish_reason === 'length'
          ? `ran out of tokens before answering (max_tokens=${this.maxTokens}); raise NVIDIA_MAX_TOKENS`
          : `empty answer (finish_reason=${choice?.finish_reason ?? 'none'})`,
      );
    }
    return { output: parseJson(content) as T, usage };
  }

  async runWorker(_task: string, _opts: WorkerOptions): Promise<WorkerResult> {
    throw new Error('nemotron runWorker is phase 2 (--engine nemotron) and not built yet; run workers with LLM_PROVIDER=claude-code');
  }

  private toUsage(u: ChatResponse['usage'], estimated = false): Usage {
    const prompt = u?.prompt_tokens ?? 0;
    const completion = u?.completion_tokens ?? 0; // includes reasoning tokens
    return {
      prompt_tokens: prompt,
      completion_tokens: completion,
      cache_read_tokens: Math.min(u?.prompt_tokens_details?.cached_tokens ?? 0, prompt),
      cost_usd: (prompt * this.priceIn + completion * this.priceOut) / 1e6,
      ...(estimated ? { estimated } : {}),
    };
  }
}

/** JSON.parse, tolerating a code fence or prose around one JSON object. */
export function parseJson(text: string): unknown {
  const tries = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) tries.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) tries.push(text.slice(first, last + 1));
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
      // try the next form
    }
  }
  throw new NemotronError(`answer is not JSON: ${text.slice(0, 200)}`);
}
