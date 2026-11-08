import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../src/decide.ts';
import { DUPLICATE_CONFLICT, FEE_CONFLICT } from '../src/fixtures.ts';
import { coordinatorModel, coordinatorProvider } from '../src/provider.ts';

describe('buildPrompt kind hint', () => {
  // Without it, Lightning and Ultra both gave the planted duplicate to agent-b (3/3 runs).
  it('tells the model that agent A came first on duplicates', () => {
    expect(buildPrompt(DUPLICATE_CONFLICT)).toContain("agent-a's function came first");
    expect(buildPrompt(DUPLICATE_CONFLICT)).toContain('agent-b reuses');
  });
  // Lightning once told agent-a to round with Math.floor((amountCents + 5) / 10) * 10, which is wrong.
  it('asks for instructions without code', () => {
    expect(buildPrompt(FEE_CONFLICT)).toContain('no code, formulas or snippets');
  });
  it('adds nothing for other kinds', () => {
    expect(buildPrompt(FEE_CONFLICT)).not.toContain('came first');
  });
});

describe('coordinatorProvider', () => {
  it('prefers COORDINATOR_PROVIDER over LLM_PROVIDER', () => {
    expect(coordinatorProvider({ COORDINATOR_PROVIDER: 'nemotron', LLM_PROVIDER: 'claude-code' })).toBe('nemotron');
  });
  it('falls back to LLM_PROVIDER, then claude-code', () => {
    expect(coordinatorProvider({ LLM_PROVIDER: 'nemotron' })).toBe('nemotron');
    expect(coordinatorProvider({ COORDINATOR_PROVIDER: '' })).toBe('claude-code');
  });
});

describe('coordinatorModel (stored in agent.model)', () => {
  it('names the Nemotron model, default Lightning', () => {
    expect(coordinatorModel('nemotron', {})).toBe('nemotron:nvidia/nemotron-3.5-lightning-30b-a3b');
    expect(coordinatorModel('nemotron', { NVIDIA_COORDINATOR_MODEL: 'nvidia/x' })).toBe('nemotron:nvidia/x');
  });
  it('names the Claude model', () => {
    expect(coordinatorModel('claude-code', { COORDINATOR_MODEL: 'claude-fable-5-1' })).toBe('claude-code:claude-fable-5-1');
  });
});
