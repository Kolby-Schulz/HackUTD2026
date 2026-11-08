---
title: Dashboard and scripts
area: dashboard
sources: [dashboard/, scripts/]
verified: claude/npm-control-script-error-d96be9
---
Summary: The dashboard is a React 19 + Vite single page that reads 15 SpacetimeDB tables through live `useTable` subscriptions and only writes via reducers (create task, send instruction). `scripts/` holds the demo, reset, session, join, judge and bench entry points, all run with `tsx` from the root `package.json`. Unit tests exist for both but were not run here (no `node_modules` at the root).

## Dashboard

- **Framework**: React 19, Vite 8 (`dashboard/package.json`), `@xyflow/react` (React Flow) for the code map (`dashboard/src/CodeMap.tsx`), `spacetimedb/react` hooks. Entry: `dashboard/src/main.tsx:8-12` wraps `<App/>` in `SpacetimeDBProvider`.
- **Connection**: `dashboard/src/data.ts:22-31` builds `DbConnection` with `withUri(SPACETIME_HOST)`, `withDatabaseName`, and a token saved in localStorage per server (`data.ts:18-19`, `onConnect` at `:26`). Host comes from `vite.config.ts:14-19` (root `.env`, `VITE_SPACETIME_HOST` or `SPACETIME_HOST`). A localhost host falls back to `ws://<page hostname>:3000` (`data.ts:12`), so a second laptop can open `http://<demo-laptop>:5173`.
- **Bindings**: imported only from `@bindings/*`, aliased to `packages/client/src/bindings` (`vite.config.ts:9,18`). Spec section 18 rule respected.
- **Subscriptions** (`data.ts:35-49`): agent, task, symbol, symbolEdge, plan, planItem, claim, change, conflict, decision, instruction, run, tokenUsage, tokenSaving (as `savings`), fileEdit. `fileEdit` and `task` are not in the spec 13 table list (see gotchas).
- **Views**: tabs in `App.tsx:16`: Live (`LiveTab.tsx`), Code (`CodeTab.tsx`), Activity (`ActivityTab.tsx`), Tokens (`TokensTab.tsx`, includes the savings ticker at about `:45`), Scoreboard (`ScoreboardTab.tsx` + `BenchTable.tsx`, which fetches `/bench.json` at `:15`), Replay (`ReplayTab.tsx`, rebuilds state via `model.replayAt`). `AgentsPanel.tsx` stays on every tab.
- **Writes**: only reducers. `NewTaskForm.tsx:11,24` (`createTask` with `agentId`, `runId`), `JudgeBox.tsx:21,39` (`createTask` to `agent-judge`, 300-char cap at `:10`), `MessageBox.tsx:10` (`sendInstruction`).
- **Logic**: all derivations are pure functions in `dashboard/src/model.ts` (622 lines): `cases` :145, `agentCards` :224, `feed` :296, `codeMap` :406, `tokenStats` about :470-500, `replayAt`. `App.tsx:33` `useLive()` returns one snapshot shared by every panel.
- **Clock**: `useNow(1000)` (`data.ts:59`) is a local tick for the T+ timer and claim expiry. It reads nothing from the server, so the no-polling rule holds.

## Scripts

All run as `npm run <name> -- <args>` from the root `package.json:13-28`, or `npx tsx scripts/<file>.ts`.

- `seed.ts`: opens a run (ends any open run) and creates the two demo tasks. `npm run seed -- [--mode with_contract|without_contract] [--seed 7]`. `run-demo.ts` calls `seed()` directly.
- `control.ts` + `daemon.ts` + `assistant.ts` (`npm run control [-- --machine id] [--pair <identity hex>]`): the laptop daemon behind the Control tab and chat. No HTTP: it connects out to SpacetimeDB as a `machine` row (id = hostname, token saved under `machine:<id>` in `.contract/identities.json`), runs `machine_command` rows from paired dashboards through `Registry` + `toCommand`, and mirrors processes/logs (`machine_process`) and chat (`machine_chat`) back every 1 s. Commands older than 60 s are failed, not run. The server keeps a same-identity daemon's `machine_process` rows across restarts, so on start the daemon marks rows left at `running` by an earlier daemon as stopped (`Daemon.adopt`), and on SIGINT/SIGTERM or takeover it pushes the stopped states before exiting (`Daemon.shutdown`); otherwise a dead judge or coordinator row locks the Repository Change button for good. Holds the target repo (`repo` command; saved in `.contract/control.json`), passes it to every child as `CONTRACT_TARGET`. Private repos use this laptop's own git credentials (never send tokens through the DB); children get `GIT_TERMINAL_PROMPT=0` + SSH `BatchMode` so missing creds fail fast, and a failed clone ends with a `gitAccessHint` fix line. Pairing: the daemon prints `<CONTRACT_DASHBOARD_URL>/#/pair?machine=…&code=…` (one-time code, 10 min, 20 wrong tries; Enter prints a new one; opened in the default browser automatically while no dashboard is paired, `--no-open` / `--open`); the browser sends `sha256("<CODE>:<identity hex>")` via `request_machine_pairing` (plain-JS hash in `dashboard/src/sha256.ts`, because `crypto.subtle` is missing on http LAN pages) and the daemon answers with `resolve_machine_pairing`. Dashboard side: `dashboard/src/machine.tsx` (`MachineProvider`/`useMachine`); `send()` waits for the daemon to mark the command done/failed, so the dashboard must subscribe to `machine_command`; a pair link also works when it only changes the hash of an open tab (`hashchange`). One daemon per machine, from both sides: a new `npm run control` first SIGTERMs the pid the last daemon in this checkout left in `.contract/control-<id>.pid` (`takeOverPidFile`, daemon.ts), then registers; the older daemon also sees `started_at` move on its `machine` row (`TakeoverGuard`, checked on update and every 1 s) and exits. Newest wins. The database check alone was not enough: a daemon started before it shipped (2026-11-08) outlived the newer one. Set `CONTRACT_DASHBOARD_URL` in `.env` so the link points at the hosted dashboard.
- `reset.ts`: removes the run's worktrees (`.worktrees/<id>`, or `.worktrees/<repoKey>/<id>` for other repos) and `agent/*`, `demo/*` branches, restores the target to HEAD, ends the run and clears server state. `npm run reset -- [--force] [--offline] [--repo <path|url>]`. Keeps `.contract/`.
- `run-demo.ts`: one measured run (seed, both workers, merge, checks, merge-fix, end). `npm run demo -- --mode without_contract|with_contract [--seed 7] [--runs 1] [--timeout-min 20] [--no-fix] [--scenario planted]` (`:31-35`).
- `session.ts`: the two-laptop live flow. `npm run session -- start [--no-map] [--tasks f.json]`, then `npm run session -- merge [--agents a,b] [--integration] [--no-fix] [--fixer id] [--push]` (dispatch at `:49-50`).
- `join.ts`: joins a laptop to a run. `npm run join -- --agent <id> --name "<name>" [--owner X] [--repo …]`, or `--client claude-code|cursor|codex [--dir .] [--task "…"]`. Checks Node 22+, `.env`, `claude` CLI login. Writes no tokens.
- `join-clients.ts`: pure helpers for `join.ts` editor configs (MCP entry, hooks, rules block).
- `judge.ts`: keeps `agent-judge` waiting for dashboard tasks. `npm run judge -- [--max-minutes 6] [--max-output-tokens 20000] [--allow-paths src/,tests/]`. Each task gets a fresh worktree.
- `bench.ts`: runs `run-demo` for each scenario and mode, then writes `.contract/bench/report.{json,md}`, `dashboard/public/bench.json`, and the README table between markers. `npm run bench -- [--scenarios all|planted,control,…] [--modes …] [--runs 1] [--report-only] [--since-run <id>]`.
- `bench-report.ts`: pure averaging and README rendering, unit tested.
- `scenarios.ts`: five scenarios: `planted`, duplicate helper, claim contention, signature change, control.
- `merge.ts`: shared merge, check and merge-fix helpers. `CHECKS` at `:12`.
- `lib.ts`: `REPO` (`:9`), `DEMO_REPO`, dotenv load, `adminConnect`, `endOpenRuns`, `AGENTS`, `MODES`, `machineId` (shared with `control.ts`). `adminConnect` is an operator connection (#62): it connects as this laptop's `machine` row with the daemon's saved token (`machine:<hostname>`), registers the row when no daemon has, and refuses when the row belongs to another identity (another checkout's daemon; set `CONTRACT_MACHINE`). The Chat composer tells an unpaired browser to pair before it creates a task.

## Demo flow

1. Start: `npm run coordinator` on one laptop, `npm run session -- start`. Each laptop runs `npm run join ...` and `npm run worker -- --id <id> --wait` (or `--prompt`).
2. Work: workers run in `.worktrees/<id>` (other repos: `.worktrees/<repoKey>/<id>`, with dependencies installed), push `agent/<id>`, and the dashboard shows live state.
3. Merge: `npm run session -- merge` (or `npm run demo` for the measured version, which does merge, checks, then merge-fix).
4. Proof: `npm run reset`, then the same demo with the other `--mode`. Run `npm run bench` for averaged results and `dashboard/public/bench.json`. Spec 15 wants at least 3 runs per mode.
5. Watch: `npm run dashboard`, then the Scoreboard and Replay tabs.

## Tests and how to run

- Dashboard: `cd dashboard && npm test` (`vitest run`) runs `dashboard/test/model.test.ts` (model derivations: tokens, agents, conflicts, code map, scoreboard, operator messages, live code, offline laptops, replay). Typecheck: `npm run typecheck -w @contract/dashboard`.
- Scripts: root `npm test` runs `scripts/test/{join,join-clients,bench-report}.test.ts`.
- Not run in this note: no `node_modules` at the repo root, so the tests were not executed. Status unverified.

## Gotchas, TODOs, spec deviations

- **Spec 13 layout**: spec asks for one page (code map center, agents left, feed right, meter and scoreboard bottom). The build uses tabs (`App.tsx:16`). Inferred from code; the storyboard in spec 13 is not fully in view here.
- **Reconnect is in the SDK**: `SpacetimeDBProvider` (spacetimedb 2.14) builds the connection with `withAutomaticReconnect()` and 1 to 30 s backoff, and `App.tsx:104` shows the "Not connected... Retrying" banner from `conn.isActive`. Issue #54's "no reconnect" item is stale; what it still lacks is the offline/local mode.
- **Extra subscriptions**: `task` and `fileEdit` are subscribed (`data.ts:36,50`) but not in spec 13's table list. Harmless, but the spec table is out of date.
- **Savings**: the ticker is only on the Tokens tab, not a persistent panel. `ScoreboardTab.tsx:93` labels per-feature savings as estimates, matching spec 15.
- **Bench runs**: `bench.ts` defaults to `--runs 1`, while spec 15 says to run each mode at least 3 times and average. Use `--runs 3` for the headline numbers (unverified what the committed `bench.json` used).
- **Destructive reset**: `reset.ts:51` runs `git clean -fd` on the target repo and refuses dirty trees only without `--force`. Check the target before running it on a repo with real work.
- **bench writes tracked files**: `bench.ts:52-59` rewrites `dashboard/public/bench.json` and the README table. Expect diffs after each bench run.
- **vitest is not declared** in the root or `dashboard/package.json` devDependencies, though both have a `test` script. It presumably resolves from other workspaces (unverified).
- **Replay** and **Judge box** are extras beyond the spec and are not in the storyboard.
- **Cross-platform processes**: scripts start tsx as `node` + `TSX_CLI` (`scripts/lib.ts`), and `Registry.stop` uses `taskkill /T` on Windows. `scripts/test/spawn.test.ts` starts and stops real processes; CI runs the scripts suite on Windows, macOS and Linux (`.github/workflows/scripts-cross-platform.yml`). The Control card picks setup commands per OS (`dashboard/src/os.ts`).
