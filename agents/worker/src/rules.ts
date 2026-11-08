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
