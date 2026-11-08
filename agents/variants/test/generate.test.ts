import { describe, expect, it } from 'vitest';
import type { DecideOptions, LLM, Usage } from '@contract/llm';
import { answerSchema, buildPrompt, generate, render, validate } from '../src/generate.ts';
import type { Answer, GenerateInput } from '../src/generate.ts';

const SLOTS = ['nav', 'hero', 'cta'];
const input: GenerateInput = {
  screen: { id: 'landing', title: 'Landing page', slots: { nav: 'Top nav', hero: 'Hero', cta: 'Primary button' } },
  id: 'gen-rounder', parent: 'b-calm', brief: 'Rounder buttons', context: { 'x/index.tsx': 'old' }, design: '# tokens',
};
const good: Answer = { title: 'Rounder', note: 'Pill button.', slots: [{ slot: 'cta', jsx: '<button className={s.cta}>Go</button>' }], css: '.cta { border-radius: 999px; }' };
const usage: Usage = { prompt_tokens: 100, completion_tokens: 20, cache_read_tokens: 0, cost_usd: 0.01 };

function fakeLLM(answers: unknown[]): LLM & { prompts: string[]; opts: DecideOptions[] } {
  const prompts: string[] = [];
  const opts: DecideOptions[] = [];
  return {
    prompts, opts,
    async decide<T>(prompt: string, _schema: Record<string, unknown>, o: DecideOptions) {
      prompts.push(prompt);
      opts.push(o);
      return { output: answers[prompts.length - 1] as T, usage };
    },
    runWorker: () => Promise.reject(new Error('not used')),
  };
}

describe('answers', () => {
  it('uses a strict schema with the screen slots', () => {
    const s = answerSchema(SLOTS) as { additionalProperties: boolean; properties: { slots: { items: { properties: { slot: { enum: string[] } } } } } };
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.slots.items.properties.slot.enum).toEqual(SLOTS);
  });

  it('accepts a good answer and explains bad ones', () => {
    expect(validate(good, SLOTS, false)).toBe('');
    expect(validate(null, SLOTS, false)).toMatch(/not a JSON object/);
    expect(validate({ ...good, slots: [{ slot: 'footer', jsx: '<p/>' }] }, SLOTS, false)).toMatch(/not a slot/);
    expect(validate({ ...good, slots: [good.slots[0], good.slots[0]] }, SLOTS, false)).toMatch(/twice/);
    expect(validate({ ...good, slots: [{ slot: 'cta', jsx: 'return 1' }] }, SLOTS, false)).toMatch(/one JSX element/);
    expect(validate({ ...good, slots: [{ slot: 'cta', jsx: '<img src="https://x.com/a.png" />' }] }, SLOTS, false)).toMatch(/external URLs/);
    expect(validate({ ...good, slots: [{ slot: 'cta', jsx: '<div dangerouslySetInnerHTML={{__html: 1}} />' }] }, SLOTS, false)).toMatch(/dangerously/);
    expect(validate({ ...good, css: '@media (max-width: 1px) {}' }, SLOTS, false)).toMatch(/container queries/);
    expect(validate(good, SLOTS, true)).toMatch(/must fill every slot; missing nav, hero/);
  });

  it('renders a variant folder that extends its parent', () => {
    const f = render(input, good);
    expect(f['index.tsx']).toContain("import s from './styles.module.css';");
    expect(f['index.tsx']).toContain('const Cta = () => (\n  <button className={s.cta}>Go</button>\n);');
    expect(f['index.tsx']).toContain('extends: "b-calm",');
    expect(f['index.tsx']).toContain('slots: { "cta": Cta },');
    expect(f['styles.module.css']).toBe('.cta { border-radius: 999px; }\n');
  });

  it('tells the model about the parent and the last problem', () => {
    const p = buildPrompt(input, 'slots is empty');
    expect(p).toContain('child of "b-calm"');
    expect(p).toContain('--- x/index.tsx\nold');
    expect(p).toContain('rejected: slots is empty');
  });
});

describe('generate', () => {
  it('retries an invalid answer, repairs compiler errors, and reports every call', async () => {
    const llm = fakeLLM([{ title: '' }, good, good]);
    const logged: number[] = [];
    let checks = 0;
    const r = await generate(input, {
      llm,
      onUsage: (_u, attempt) => { logged.push(attempt); },
      check: async () => (++checks === 1 ? "index.tsx(3,1): error TS1005: ')' expected." : ''),
    });
    expect(r.attempts).toBe(3);
    expect(logged).toEqual([0, 1, 2]);
    expect(r.usage).toMatchObject({ prompt_tokens: 300, completion_tokens: 60 });
    expect(llm.prompts[1]).toContain('title is missing');
    expect(llm.prompts[2]).toContain('does not compile');
    expect(llm.opts.every((o) => o.purpose === 'design')).toBe(true);
  });

  it('gives up after the last attempt', async () => {
    await expect(generate(input, { llm: fakeLLM([null, null, null]), onUsage: () => {}, check: async () => '' })).rejects.toThrow(/no usable variant after 3 attempts \(the answer is not a JSON object\)/);
  });
});
