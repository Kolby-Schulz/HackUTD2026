// What a composer message does (COMMENT-8, COMMENT-9): pure planning, no React. useChat posts the cards and requests.
import { GENERAL, needsAllConfirm, parseMentions, route, splitGeneral } from '../../agents/router';
import type { Decision, RouterAgent, RouterInput } from '../../agents/router';

export type Delivery = { decision: Decision; text: string };
export type SendPlan = {
  /** One line per unknown or ambiguous @name; when present nothing is sent. */
  errors: string[];
  /** Mentioned agents that are stopped: the UI asks "X is stopped, start?" and may restart them. */
  stopped: RouterAgent[];
  /** `@all` reaches more agents than the confirm limit. */
  confirmAll: boolean;
  deliveries: Delivery[];
};

const mention = (a: RouterAgent): Decision => ({ to: a.id, why: 'mention', label: 'mentioned' });

/**
 * A General message (or any message with @mentions). Order: mentions (error lines for unknown/ambiguous names),
 * then `splitGeneral` for "build a landing page: hero, stats, profile card" (no layer, no mention), then `route`.
 * `inp.shapeId` makes the message a layer note, which is never split.
 */
export function planMessage(text: string, inp: RouterInput): SendPlan {
  const m = parseMentions(text, inp.agents);
  const errors = [
    ...m.unknown.map((n) => `No agent named @${n} on this board.`),
    ...m.ambiguous.map((n) => `@${n} matches more than one agent. Use the full name.`),
  ];
  const plan: SendPlan = { errors, stopped: m.stopped, confirmAll: false, deliveries: [] };
  if (errors.length) return plan;
  if (m.all) {
    const live = inp.agents.filter((a) => !a.stopped);
    plan.confirmAll = needsAllConfirm(inp.agents);
    plan.deliveries = live.map((a) => ({ decision: mention(a), text }));
    return plan;
  }
  if (m.agents.length) {
    plan.deliveries = m.agents.filter((a) => !a.stopped).map((a) => ({ decision: mention(a), text }));
    return plan;
  }
  if (!inp.shapeId) {
    const parts = splitGeneral(text, inp);
    if (parts) {
      plan.deliveries = parts.map((p) => ({ decision: { to: p.agent.id, why: 'split', label: `split: ${p.part}` }, text: p.text }));
      return plan;
    }
  }
  plan.deliveries = [{ decision: route(inp), text }];
  return plan;
}

export { GENERAL };
