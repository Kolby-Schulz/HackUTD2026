// Shared LLM wrapper. Backend chosen by LLM_BACKEND (default: claude-code).
//   claude-code: the local Claude Code CLI, headless (`claude -p`), using this machine's login
//   nemotron:    NVIDIA hosted Nemotron (spec section 4), not implemented yet
import { ClaudeCodeLLM } from './claude-code.ts';
import type { LLM } from './types.ts';

export * from './types.ts';
export { ClaudeCodeLLM } from './claude-code.ts';

export type Role = 'worker' | 'coordinator';

export function createLLM(role: Role = 'worker'): LLM {
  const backend = process.env.LLM_BACKEND ?? 'claude-code';
  if (backend === 'claude-code') {
    const model =
      role === 'coordinator'
        ? (process.env.COORDINATOR_MODEL ?? 'claude-opus-5-5')
        : (process.env.WORKER_MODEL ?? 'claude-sonnet-5-5');
    return new ClaudeCodeLLM(model);
  }
  throw new Error(`LLM_BACKEND=${backend} is not implemented yet (use claude-code)`);
}
