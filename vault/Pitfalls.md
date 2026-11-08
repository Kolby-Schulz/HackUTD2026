---
title: Pitfalls
area: map
sources: [server/src/index.ts, packages/client, agents/worker, scripts/reset.ts, .env.example]
verified: 87debe9
---
Summary: Traps found while surveying the repo, and the rule each implies. Area notes hold the file:line details.

# Pitfalls

- **Operators only** (#62): `reset_demo_state`, `start_run`, `end_run`, `create_task`, `mark_attempt_wasted` refuse a connection with no agent, machine or pairing row (`only an operator can do this`). Scripts must use `adminConnect` (it connects as this laptop's machine row); a hosted dashboard must pair before its New task form works; a second checkout on the same laptop needs `CONTRACT_MACHINE=<other-name>` or the scripts refuse to touch the other checkout's machine row. `upsert_symbols` needs the `mapper` service lock (the CLI always takes it now), so stop a `--watch` mapper before a one-shot `npm run mapper` on another laptop. [[server]]
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
- **`npm run reset` refuses while a worker is live**: `reset_demo_state` throws `<ids> still running` when any agent is working or paused with a heartbeat under 60 s. Stop the workers (Control tab stop, or Ctrl-C) or wait a minute. [[server]]
- **Don't add a client-disconnect reducer**: hooks share the agent's identity over short connections, and a wifi blip would idle a live worker and release its claims. Heartbeat + sweep is the presence model. [[server]]
- **Mapper and export-less JS**: a JS file with no `export` and no `module.exports` maps its top-level functions, consts and classes. A plain `.cjs` with `module.exports` still maps to nothing. [[coordinator-and-mapper]]
- **Don't spawn `node_modules/.bin/tsx`**: it's `tsx.cmd` on Windows, which `spawn()` can't start without a shell, so the daemon connected but every Start failed. Use `TSX` (node) with `TSX_CLI` first in the args (`scripts/lib.ts`). Setup commands shown to users go one per line with no `&&` or `#` (PowerShell 5.1 and cmd); the Control card picks them per OS (`dashboard/src/os.ts`). [[dashboard-and-scripts]]
- **npm scripts run in cmd on Windows**: `mkdir -p`, `ln`, `rm`, `VAR=x cmd` fail there (server's `ln -sf` postinstall broke `npm install` on every Windows laptop). Put file work in a small Node script (`server/scripts/link-tsc.mjs`). CI's Windows job catches this. [[server]]
