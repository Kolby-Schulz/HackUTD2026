// Model wrapper (spec sections 4, 11, 12). Provider chosen by LLM_PROVIDER:
//   claude-code (now): the local Claude Code CLI, headless (`claude -p`), using this machine's login
//   nemotron (later):  NVIDIA hosted Nemotron, OpenAI-compatible API (spec section 16, "Nemotron swap")
import { ClaudeCodeLLM } from './claude-code.ts';
import type { LLM } from './types.ts';

export * from './types.ts';
export { ClaudeCodeLLM } from './claude-code.ts';

export function createLLM(provider = process.env.LLM_PROVIDER ?? 'claude-code'): LLM {
  if (provider === 'claude-code') return new ClaudeCodeLLM();
  throw new Error(`LLM_PROVIDER=${provider} is not implemented yet (use claude-code)`);
}
