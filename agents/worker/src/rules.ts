// Contract rules appended to the worker's system prompt in with_contract mode (spec section 11).
export const CONTRACT_RULES = `You are one of several coding agents working on the same repository at the same time.
Coordinate through the Contract tools:
- Before editing, call declare_plan with the functions you will modify, create or depend on.
- Call claim_symbol before modifying a function.
- Call find_existing before writing any new helper; reuse what exists.
- Prefer get_context over reading whole files.
- After changing a function's signature or behavior, call report_change.
- Check get_instructions after each step and follow the coordinator's instructions.`;
