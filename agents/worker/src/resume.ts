// Pure helpers for the worker's early stop and resume (spec sections 11, 15).
import { readFileSync } from 'node:fs';
import type { Instruction } from '@contract/client';

/** One line of the local token log (.contract/tokens.jsonl), written by the worker for every run. */
export interface TokenLogLine {
  agentId: string;
  mode: 'with_contract' | 'without_contract';
  purpose: string;
  completion_tokens: number;
  estimated?: boolean;
}

/** Used when no baseline run has been logged on this machine yet. */
export const DEFAULT_CODING_STEP_TOKENS = 4000;

/**
 * early_stop saving (spec section 15): "average completion tokens of a full coding step in
 * the baseline run", minus what the stopped attempt had already generated (that part was
 * spent, not avoided). Falls back to DEFAULT_CODING_STEP_TOKENS without a baseline.
 */
export function earlyStopEstimate(log: TokenLogLine[], alreadyGenerated: number): { tokens: number; fromBaseline: boolean } {
  const steps = log.filter((l) => l.mode === 'without_contract' && l.purpose === 'code' && !l.estimated);
  const avg = steps.length ? steps.reduce((n, l) => n + l.completion_tokens, 0) / steps.length : DEFAULT_CODING_STEP_TOKENS;
  return { tokens: Math.max(0, Math.round(avg - alreadyGenerated)), fromBaseline: steps.length > 0 };
}

export function readTokenLog(path: string): TokenLogLine[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TokenLogLine);
  } catch {
    return [];
  }
}

/**
 * What to tell the resumed session. A conflict sends the paused agent a "pause and wait"
 * notice first and the coordinator's decision later; only the newest instruction per
 * conflict is current. Instructions without a conflict are all kept, in order.
 */
export function resumeInstructions(pending: Instruction[]): Instruction[] {
  const latest = new Map<string, Instruction>();
  const loose: Instruction[] = [];
  for (const i of pending) {
    if (i.conflictId === undefined) loose.push(i);
    else {
      const k = i.conflictId.toString();
      const prev = latest.get(k);
      if (!prev || i.id > prev.id) latest.set(k, i);
    }
  }
  return [...loose, ...latest.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
