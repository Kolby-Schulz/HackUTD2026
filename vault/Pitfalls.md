---
title: Pitfalls
area: map
sources: [server/src/index.ts, packages/client, agents/worker, scripts/reset.ts, .env.example]
verified: 87debe9
---
Summary: Traps found while surveying the repo, and the rule each implies. Area notes hold the file:line details.

# Pitfalls

- **Server auth gaps**: `log_saving`, `mark_attempt_wasted` have no identity check; `reset_demo_state` has no auth at all. Don't rely on them being caller-safe. [[server]]
- **Spec deltas in the server** (deliberate): `claim_symbol` returns silently on contention; `register_agent` allows takeover after 60 s silence; Rule 2 on mapper-owned symbols sends an instruction, not a conflict. [[server]]
- **`claim()` throws after the reducer already recorded the conflict** in packages/client. Callers must not assume "threw = nothing happened". [[agents-and-packages]]
- **Destructive git**: worker guard-rail discard runs `git checkout`/`git clean` in its worktree; session push uses `--force`; `scripts/reset.ts` runs `git clean -fd` on the target repo. Never point these at a checkout with uncommitted work. [[agents-and-packages]] [[dashboard-and-scripts]]
- **Two provider switches**: `COORDINATOR_PROVIDER` (coordinator only) overrides `LLM_PROVIDER` (everyone). [[coordinator-and-mapper]]
- **Live tests read different host vars**: coordinator live test uses `SPACETIME_LIVE_HOST`, not `SPACETIME_HOST`. [[coordinator-and-mapper]]
- **demo-repo integration test is red by design** (planted conflicts). Not a regression. [[coordinator-and-mapper]]
- **Bench defaults to `--runs 1`**; spec §15 wants 3+ for reported numbers. [[dashboard-and-scripts]]
- **Generated bindings** in packages/client can drift from `server/src`; regenerate with `npm run generate -w @contract/server` after any schema change. [[agents-and-packages]]
- **Flaky live tests** have bitten before (MCP Rule 1, PR #42). Re-run once before debugging. [[history]]
- **Running Contract on itself** (`--repo .`): agents must stay out of `server/`. A schema change needs `npm run generate -w @contract/server` plus a publish, and publishing to the database the running coordinator uses breaks the run. Use a separate `SPACETIME_DB_NAME` for self-runs; `npm run reset -- --repo .` would `git clean` the monorepo. [[coordinator-and-mapper]]
- **The claim guard now enforces the protocol**: an edit to a mapped source file is blocked until the agent has an active plan, and an edit touching a symbol in the shared map is blocked until the agent holds its own claim (`agents/worker/src/claim-guard.ts`). Joined editor sessions get the same. `CONTRACT_PROTOCOL=off` restores the old behavior (only other agents' claims and pauses block). [[agents-and-packages]]
- **One `npm run control` per laptop**: every daemon on a laptop registers as the same machine id with the same saved identity, and the server accepts all of them, so each answers every pairing (the wrong ones reject the code) and runs every command. Since the control daemon's takeover check, the newest one wins and older ones exit; before that, three agents each started one and pairing from the hosted dashboard failed. [[dashboard-and-scripts]]
- **Pairing with a teammate's code makes both browsers drive one laptop**: the Control tab used to pre-select the first online laptop (usually someone else's) in its code box, and the chat defaulted to the first agent anywhere. Now you must choose your laptop, confirm if it is already paired, and the chat defaults only to agents on the paired laptop. Everyone still shares one run per database until runs are scoped by repo. [[dashboard-and-scripts]]
