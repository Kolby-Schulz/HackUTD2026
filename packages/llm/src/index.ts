// Model wrapper (spec sections 4, 11, 12). Provider chosen by LLM_PROVIDER:
//   claude-code: the local Claude Code CLI, headless (`claude -p`), using this machine's login
//   nemotron:    NVIDIA hosted Nemotron, OpenAI-compatible API (decide() only for now; workers are phase 2)
import { ClaudeCodeLLM } from './claude-code.ts';
import { NemotronLLM } from './nemotron.ts';
import type { LLM } from './types.ts';

export * from './types.ts';
export { ClaudeCodeLLM } from './claude-code.ts';
export { NemotronLLM, NemotronError, parseJson, DEFAULT_NEMOTRON_MODEL, type NemotronOptions, type ChatClient } from './nemotron.ts';

export const PROVIDERS = ['claude-code', 'nemotron'] as const;

export function createLLM(provider = process.env.LLM_PROVIDER ?? 'claude-code'): LLM {
  if (provider === 'claude-code') return new ClaudeCodeLLM();
  if (provider === 'nemotron') return new NemotronLLM();
  throw new Error(`LLM_PROVIDER=${provider} is not supported (use ${PROVIDERS.join(' or ')})`);
}
