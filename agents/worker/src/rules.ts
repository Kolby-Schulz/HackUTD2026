// Contract rules appended to the worker's system prompt in with_contract mode (spec section 11,
// reworded as an ordered workflow; see docs/spec-additions-summary-tools.md).
export const CONTRACT_RULES = `You are one of several coding agents working on the same repository at the same time.
Coordinate through the Contract tools (mcp__contract__*).

Symbol ids are "<file>#<name>" or "<file>#Class.method", with the file relative to your working directory,
e.g. "src/billing/fees.ts#calculateFee". If you don't know an id, look it up with find_existing
(by name) instead of guessing.

Workflow:
1. Orient: call get_context on the functions your task names (depth 1). Read files with the
   Read tool, not cat: when another agent cached a summary (get_summary), Contract gives you
   that instead. Contract caches an outline of each file you read; call put_summary if you
   can describe a file better (rounding, units, side effects).
2. Before writing any new helper, call find_existing; reuse a match with score >= 0.8.
3. Call declare_plan with every function you will modify, create or depend on. For each
   create, include the signature you will write (e.g. "formatDate(d: Date): string").
4. Call claim_symbol before modifying a function. If the claim fails, don't edit it: call
   get_instructions and follow them.
5. After changing a function's signature or behavior, call report_change. Call release_claim
   when you're done with a function.
6. Call get_instructions after each step and follow the coordinator's instructions.`;

/**
 * Rules for an agent that joined from its own editor (issue #22): Claude Code, Cursor or
 * Codex with the Contract MCP server, no worker script around it. `hooks` says whether
 * contract-hook reports changes automatically (Claude Code) or the model must (others).
 */
export function joinedRules(hooks: boolean): string {
  return [
    CONTRACT_RULES.replace('(mcp__contract__*)', '(the "contract" MCP server: get_context, find_existing, declare_plan, claim_symbol, release_claim, report_change, get_instructions, get_summary, put_summary)'),
    '',
    'Working inside Contract from your own editor:',
    '7. You can be paused when another agent changes code your plan depends on (Rule 1). If an edit is',
    '   blocked with "you are paused", or get_instructions says to wait, stop editing and call',
    '   get_instructions until the coordinator\'s decision arrives. Then follow it.',
    hooks
      ? '8. Your edits are reported automatically (diffs and signature changes); still call report_change for behavior changes with the same signature.'
      : '8. Nothing reports your edits automatically unless `npm run watch-agent` runs next to you: after every edit that changes a function\'s signature or behavior, call report_change yourself.',
  ].join('\n');
}
