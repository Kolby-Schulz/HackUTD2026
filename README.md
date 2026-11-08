# Contract

Live coordination for AI coding agents. A shared SpacetimeDB server lets a team's
coding agents see each other's plans as they work, so conflicting changes are caught
while code is being written, not at merge time. A Nemotron coordinator resolves
conflicts and a live dashboard shows everything.

> Contract isn't another coding agent. It's what lets your team's coding agents work like a team.

Built at HackUTD 2026. Full spec: [docs/SPEC.md](docs/SPEC.md).

## Layout

```text
server/              SpacetimeDB module: tables, reducers, conflict checks
packages/client/     Contract client library + generated SpacetimeDB bindings
packages/llm/        Shared Nemotron wrapper: calls, tool loop, token logging
agents/worker/       Worker agent loop and its tools
agents/coordinator/  Coordinator agent loop and prompts
mapper/              Code mapper: repo -> symbol rows
dashboard/           React web app
demo-repo/           Small TypeScript codebase with planted conflicts + tests
scripts/             run-demo.ts, reset.ts, seed.ts
```

## Setup

1. Node 20+ and the [SpacetimeDB CLI](https://spacetimedb.com/install).
2. `npm install`
3. `cp .env.example .env` and add your `NVIDIA_API_KEY` from build.nvidia.com.
4. `spacetime start`, then publish `server/` and generate bindings into
   `packages/client/src/bindings` (see the SpacetimeDB TypeScript quickstart).

## Shared cloud database (two laptops)

The demo database `contract-hackutd26` runs on SpacetimeDB maincloud, so both laptops
share it with no LAN setup. Only its owner's login can publish; anyone can connect.

1. In the repo root `.env` (every part loads it, whatever folder it runs from):

   ```bash
   SPACETIME_HOST=wss://maincloud.spacetimedb.com
   SPACETIME_DB_NAME=contract-hackutd26
   ```

2. Both laptops: `git pull && npm run reset`, so they start from the same `origin/main`.
3. Host laptop: `npm run coordinator` and `npm run dashboard` (each in its own terminal), then
   `npm run session -- start`. That ends any open run, clears the last run's state, opens a
   `with_contract` run and maps `demo-repo/`.
4. Each laptop starts its own agent with a different `--id`, and tells it what to build:

   ```bash
   npm run worker -- --id agent-a --prompt "Add late fees to invoices..."
   ```

   Or start it with `--wait` and type the task into the dashboard's **New task** form:

   ```bash
   npm run worker -- --id agent-b --wait
   ```

   Workers branch from `origin/main`. When a worker finishes, it pushes `agent/<id>` to origin
   (`--no-push` skips that).
5. When every agent is done, run this on either laptop:

   ```bash
   npm run session -- merge
   ```

   It fetches every agent's branch, merges them in `.worktrees/merge-<run>` and runs unit
   tests, typecheck and check-dupes. If those fail, a local agent gets a merge-fix pass.
   Then it ends the run. Add `--integration` when the agents ran the two canned tasks
   (`agents/worker/src/tasks.ts`), and `--push` to push the merge branch.

To check who is online (a worker heartbeats every 15 s and goes stale after 60 s):

```bash
spacetime sql --server maincloud contract-hackutd26 "SELECT id, machine, status, last_heartbeat FROM agent"
```

`npm run demo` stays the single-laptop A/B benchmark (both modes, canned tasks, scoreboard).

After a change to `server/`, the owner republishes with `npm run publish:cloud -w @contract/server`.
Keep live tests local (they wipe their database); they default to `ws://localhost:3000`.

## Joining from a new laptop

```bash
npm run join -- --agent agent-b --name "Agent B" --owner Bob
```

Checks Node, `.env`, the `claude` login and git, registers the agent, and prints the worker
command. Only one coordinator and one watching mapper run per database (a second one
refuses to start). Rehearsal steps and network fallbacks: `docs/two-laptop-rehearsal.md`.

## Your own repo

Contract works on any git repository, not only `demo-repo/` (issue #18). Pick it with
`--repo <path|git URL>` or `CONTRACT_TARGET` in `.env`; a folder inside a repo works too.

```bash
npm run session -- start --repo ../my-app --tasks tasks.json   # maps it, queues tasks
npm run worker -- --id agent-a --repo ../my-app --wait          # on each laptop
npm run session -- merge --repo ../my-app                       # merge + run its checks
npm run reset -- --repo ../my-app
```

`tasks.json` is `[{ "agent": "agent-a", "task": "Add a dark mode toggle" }]`. The merge runs
the commands in the target's `contract.json` (`{ "checks": { "unit tests": "pytest -q" } }`),
else `CONTRACT_TEST_CMD`, else `npm test`; workers may run those without asking. The repo
needs an `origin` for the two-laptop flow (workers push `agent/<id>` there); a local-only
repo works on one laptop. The mapper reads TypeScript and JavaScript.

## Commands

```bash
npm run mapper -- --repo ../demo-repo --watch
npm run coordinator
npm run worker -- --id agent-a --task 1 --mode with_contract
npm run worker -- --id agent-b --prompt "..."   # or --wait (dashboard New task form)
npm run session -- start | merge
npm run dashboard
npm run demo -- --mode without_contract --seed 7
npm run reset
npm run typecheck
```
