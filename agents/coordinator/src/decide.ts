// Coordinator decision logic (spec section 12): prompt, JSON schema, validation, fallback.
import type { LLM, Usage } from '@contract/llm';

export interface ConflictContext {
  kind: 'broken_dependency' | 'duplicate' | 'claim_contention' | 'plan_clash';
  symbolId: string;
  agentA: string;
  agentB: string;
  planA: string;
  planB: string;
  oldSignature?: string;
  newSignature?: string;
  description?: string;
  /** Agent that claimed the symbol first, for the fallback rule. */
  firstClaimant?: string;
}

export interface Decision {
  action: 'resolve' | 'dismiss';
  owner_agent: string;
  instructions_a: string;
  instructions_b: string;
  reason: string;
}

export const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['resolve', 'dismiss'] },
    owner_agent: { type: 'string' },
    instructions_a: { type: 'string' },
    instructions_b: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['action', 'owner_agent', 'instructions_a', 'instructions_b', 'reason'],
  additionalProperties: false,
} as const;

export function buildPrompt(c: ConflictContext): string {
  return `You coordinate AI coding agents on one repo. Two agents have a conflict.
Conflict: ${c.kind} on ${c.symbolId}
Agent A (${c.agentA}) plan: ${c.planA}
Agent B (${c.agentB}) plan: ${c.planB}
Change: ${c.oldSignature ?? '(none)'} -> ${c.newSignature ?? '(none)'}; ${c.description ?? ''}
Decide who owns ${c.symbolId} and give each agent one short, concrete instruction
that lets both tasks finish without duplicate or conflicting code.
Prefer: reuse over new code, the smallest change, and keeping the change already made.
Reply with JSON only.`;
}

export function isValid(d: Decision | undefined, c: ConflictContext): d is Decision {
  return (
    !!d &&
    (d.action === 'resolve' || d.action === 'dismiss') &&
    (d.owner_agent === c.agentA || d.owner_agent === c.agentB) &&
    d.instructions_a.trim().length > 0 &&
    d.instructions_b.trim().length > 0
  );
}

/** Rule-based fallback: the agent that claimed first owns the symbol. */
export function fallbackDecision(c: ConflictContext): Decision {
  const owner = c.firstClaimant ?? c.agentA;
  const other = owner === c.agentA ? c.agentB : c.agentA;
  return {
    action: 'resolve',
    owner_agent: owner,
    instructions_a: owner === c.agentA ? `Keep your change to ${c.symbolId}.` : `Do not change ${c.symbolId}; adapt to ${owner}'s version.`,
    instructions_b: owner === c.agentB ? `Keep your change to ${c.symbolId}.` : `Do not change ${c.symbolId}; adapt to ${owner}'s version.`,
    reason: `Fallback rule: ${owner} claimed ${c.symbolId} first; ${other} adapts.`,
  };
}

/** Ask the model, validate, retry once, then fall back to the rule. */
export async function decideConflict(
  llm: LLM,
  c: ConflictContext,
  onUsage: (u: Usage) => void | Promise<void>,
): Promise<{ decision: Decision; source: 'model' | 'fallback_rule' }> {
  for (let i = 0; i < 2; i++) {
    try {
      const { output } = await llm.decide<Decision>(buildPrompt(c), DECISION_SCHEMA, {
        purpose: 'coordination',
        onUsage: (u) => onUsage(u),
      });
      if (isValid(output, c)) return { decision: output, source: 'model' };
    } catch (e) {
      console.error('[coordinator] decide failed:', (e as Error).message);
    }
  }
  return { decision: fallbackDecision(c), source: 'fallback_rule' };
}
