// Layer 1 (docs/nemotron-coordinator-plan.md): NemotronLLM with a fake OpenAI client, no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLLM, LLMAbortError, NemotronError, NemotronLLM, parseJson, type ChatClient } from '../src/index.ts';
import type { ChatResponse } from '../src/nemotron.ts';

const SCHEMA = { type: 'object', properties: { owner_agent: { type: 'string' } }, required: ['owner_agent'] };

function fake(res: ChatResponse | (() => Promise<ChatResponse>)) {
  const create = vi.fn(async (_body: Record<string, unknown>, _o?: { signal?: AbortSignal }) =>
    typeof res === 'function' ? res() : res,
  );
  return { client: { chat: { completions: { create } } } as ChatClient, create };
}

const reply = (content: string | null, finish = 'stop', usage = { prompt_tokens: 18, completion_tokens: 117 }): ChatResponse => ({
  choices: [{ finish_reason: finish, message: { content, reasoning_content: 'Here is a thinking process: {"owner_agent":"WRONG"}' } }],
  usage: { ...usage, prompt_tokens_details: { cached_tokens: 0 } },
});

afterEach(() => vi.unstubAllEnvs());

describe('NemotronLLM.decide', () => {
  it('returns the parsed answer from content and ignores reasoning_content', async () => {
    const { client } = fake(reply('{"owner_agent":"agent-a"}'));
    const r = await new NemotronLLM({ client }).decide(' p', SCHEMA, { purpose: 'coordination' });
    expect(r.output).toEqual({ owner_agent: 'agent-a' });
  });

  it('maps usage (our real "say hi" numbers) and reports it once with the purpose', async () => {
    const { client } = fake(reply('{"owner_agent":"agent-a"}'));
    const onUsage = vi.fn();
    const r = await new NemotronLLM({ client }).decide('p', SCHEMA, { purpose: 'coordination', onUsage });
    expect(r.usage).toEqual({ prompt_tokens: 18, completion_tokens: 117, cache_read_tokens: 0, cost_usd: 0 });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(r.usage, 'coordination');
  });

  it('computes cost from per-million prices', async () => {
    const { client } = fake(reply('{"owner_agent":"a"}', 'stop', { prompt_tokens: 1_000_000, completion_tokens: 500_000 }));
    const r = await new NemotronLLM({ client, priceInPerM: 0.1, priceOutPerM: 0.4 }).decide('p', SCHEMA, { purpose: 'coordination' });
    expect(r.usage.cost_usd).toBeCloseTo(0.3);
  });

  it('sends the schema, thinking off, temperature 0 and the coordinator model', async () => {
    const { client, create } = fake(reply('{"owner_agent":"a"}'));
    await new NemotronLLM({ client, coordinatorModel: 'nvidia/coord', workerModel: 'nvidia/work' }).decide('the prompt', SCHEMA, {
      purpose: 'coordination',
    });
    const body = create.mock.calls[0][0] as Record<string, any>;
    expect(body.model).toBe('nvidia/coord');
    expect(body.temperature).toBe(0);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.response_format.json_schema.schema).toEqual(SCHEMA);
    expect(body.messages.at(-1).content).toContain('the prompt');
    expect(body.max_tokens).toBe(2048);
  });

  it('uses the worker model for non-coordination purposes and opts.model over both', async () => {
    const { client, create } = fake(reply('{"owner_agent":"a"}'));
    const llm = new NemotronLLM({ client, coordinatorModel: 'nvidia/coord', workerModel: 'nvidia/work' });
    await llm.decide('p', SCHEMA, { purpose: 'plan' });
    await llm.decide('p', SCHEMA, { purpose: 'coordination', model: 'nvidia/override' });
    expect(create.mock.calls.map((c) => (c[0] as any).model)).toEqual(['nvidia/work', 'nvidia/override']);
  });

  it('reads thinking, max tokens and models from env', async () => {
    vi.stubEnv('NVIDIA_THINKING', 'on');
    vi.stubEnv('NVIDIA_MAX_TOKENS', '5000');
    vi.stubEnv('NVIDIA_COORDINATOR_MODEL', 'nvidia/env-coord');
    const { client, create } = fake(reply('{"owner_agent":"a"}'));
    const llm = new NemotronLLM({ client });
    expect(llm.modelFor('coordination')).toBe('nvidia/env-coord');
    await llm.decide('p', SCHEMA, { purpose: 'coordination' });
    const body = create.mock.calls[0][0] as Record<string, any>;
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(body.max_tokens).toBe(5000);
  });

  it('throws a NemotronError when thinking used up max_tokens (content null), but still logs usage', async () => {
    const { client } = fake(reply(null, 'length', { prompt_tokens: 18, completion_tokens: 20 }));
    const onUsage = vi.fn();
    await expect(new NemotronLLM({ client }).decide('p', SCHEMA, { purpose: 'coordination', onUsage })).rejects.toThrow(
      /ran out of tokens/,
    );
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ completion_tokens: 20 }), 'coordination');
  });

  it('throws a NemotronError on a non-JSON answer', async () => {
    const { client } = fake(reply('agent-a should own it'));
    await expect(new NemotronLLM({ client }).decide('p', SCHEMA, { purpose: 'coordination' })).rejects.toBeInstanceOf(NemotronError);
  });

  it('throws LLMAbortError when the signal is aborted', async () => {
    const ctl = new AbortController();
    const { client } = fake(async () => {
      ctl.abort();
      throw new Error('Request was aborted.');
    });
    const err = await new NemotronLLM({ client }).decide('p', SCHEMA, { purpose: 'coordination', signal: ctl.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(LLMAbortError);
    expect(err.usage).toMatchObject({ estimated: true });
  });

  it('does not call the API when already aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { client, create } = fake(reply('{}'));
    await expect(new NemotronLLM({ client }).decide('p', SCHEMA, { purpose: 'coordination', signal: ctl.signal })).rejects.toBeInstanceOf(
      LLMAbortError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('passes API errors (e.g. 401) through for the coordinator to retry or fall back', async () => {
    const { client } = fake(async () => {
      throw Object.assign(new Error('401 Unauthorized'), { status: 401 });
    });
    await expect(new NemotronLLM({ client }).decide('p', SCHEMA, { purpose: 'coordination' })).rejects.toThrow('401');
  });
});

describe('parseJson', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });
  it('throws NemotronError on junk', () => {
    expect(() => parseJson('nope')).toThrow(NemotronError);
  });
});

describe('createLLM / construction', () => {
  it('fails clearly without NVIDIA_API_KEY', () => {
    vi.stubEnv('NVIDIA_API_KEY', '');
    expect(() => new NemotronLLM()).toThrow(/NVIDIA_API_KEY is not set/);
  });

  it("createLLM('nemotron') gives a NemotronLLM whose runWorker is not built yet", async () => {
    vi.stubEnv('NVIDIA_API_KEY', 'nvapi-test');
    const llm = createLLM('nemotron');
    expect(llm).toBeInstanceOf(NemotronLLM);
    await expect(llm.runWorker('t', { cwd: '.' })).rejects.toThrow(/phase 2/);
  });

  it('rejects unknown providers', () => {
    expect(() => createLLM('gpt')).toThrow(/not supported/);
  });
});
