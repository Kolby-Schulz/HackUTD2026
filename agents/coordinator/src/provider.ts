// Which model backs the coordinator. COORDINATOR_PROVIDER lets the coordinator run on Nemotron
// while workers stay on Claude Code (LLM_PROVIDER), since Nemotron workers aren't built yet.
import { DEFAULT_NEMOTRON_MODEL } from '@contract/llm';

type Env = Record<string, string | undefined>;

export function coordinatorProvider(env: Env = process.env): string {
  return env.COORDINATOR_PROVIDER || env.LLM_PROVIDER || 'claude-code';
}

/** Stored in the coordinator's agent.model column: the database's record of who decides. */
export function coordinatorModel(provider: string, env: Env = process.env): string {
  if (provider === 'nemotron') return `nemotron:${env.NVIDIA_COORDINATOR_MODEL || DEFAULT_NEMOTRON_MODEL}`;
  if (provider === 'claude-code') return `claude-code:${env.COORDINATOR_MODEL || 'claude-opus-5-5'}`;
  return provider;
}
