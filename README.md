# Contract

Live coordination for AI coding agents. A shared SpacetimeDB server lets a team's
coding agents see each other's plans as they work, so conflicting changes are caught
while code is being written, not at merge time. A coordinator agent resolves
conflicts and a live dashboard shows everything. Every model call goes through one
provider switch (`LLM_PROVIDER`); today that is Claude Code, and NVIDIA Nemotron is planned.

> Contract isn't another coding agent. It's what lets your team's coding agents work like a team.

Built at HackUTD 2026. Full spec: [docs/SPEC.md](docs/SPEC.md).

## Layout

```text
server/              SpacetimeDB module: tables, reducers, conflict checks
packages/client/     Contract client library + generated SpacetimeDB bindings
packages/llm/        Shared model wrapper (Claude Code today): calls, token + cost logging
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
3. `cp .env.example .env`, and log in to Claude Code on this laptop (`claude -p "hi"` should
   answer). `NVIDIA_API_KEY` is only needed once the Nemotron provider lands.
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

## Running it from the dashboard

The easiest way: open the dashboard's **Chat** tab and say what you want, the way you'd prompt a
coding agent ("Add late fees to invoices, and have another agent format receipt dates").
Contract plans it (one `decide()` call through `packages/llm`), starts the coordinator and a
session if they aren't running, puts one agent on each independent piece, and merges and runs
the checks when they all finish. While agents work, follow-ups ("make it round half up") go to
them as messages. It needs one daemon running on the laptop
that does the work:

```bash
npm run control     # first run: opens the dashboard in your browser, already linked to this laptop
```

The daemon connects out to SpacetimeDB as this laptop's `machine` row; nothing listens on a port,
so the hosted dashboard drives it the same as a local one. Set `CONTRACT_DASHBOARD_URL` to your
hosted dashboard so the link points there (default `http://localhost:5173`). Pairing is once per
browser: the code works once, expires after 10 minutes, and never reaches the database (the
browser sends a hash of it with its own identity). Press Enter in the daemon's terminal for a new
code. When no browser is paired yet, the daemon opens the link itself (`--no-open` to skip,
`--open` to force). The daemon keeps its identity in `.contract/identities.json`, so pairings survive restarts.
**Manual controls** under the chat start and stop each piece yourself (coordinator, session,
workers, judge, merge, reset) and show each process's output. Only paired browsers can send it
commands, every command goes through a fixed allowlist, and it runs things only on the laptop
it runs on (each laptop runs its own). Workers push `agent/<id>` to origin as usual.

## Joining from a new laptop

```bash
npm run join -- --agent agent-b --name "Agent B" --owner Bob
```

Checks Node, `.env`, the `claude` login and git, registers the agent, and prints the worker
command. Only one coordinator and one watching mapper run per database (a second one
refuses to start). Rehearsal steps and network fallbacks: `docs/two-laptop-rehearsal.md`.

To join from your own Claude Code, Cursor or Codex session instead of our worker:
`npm run join -- --agent dana --client claude-code` (see `docs/join-contract.md`).

## Your own repo

Contract works on any git repository, not only `demo-repo/` (issue #18). The easiest way:
run `npm run control`, open the dashboard's **Chat** tab and paste a GitHub link
(`owner/name` works too) into **Repository**. From the command line, pick it with
`--repo <path|git URL>` or `CONTRACT_TARGET` in `.env`; a folder inside a repo works too.

```bash
npm run session -- start --repo ../my-app --tasks tasks.json   # maps it, queues tasks
npm run worker -- --id agent-a --repo ../my-app --wait          # on each laptop
npm run session -- merge --repo ../my-app                       # merge + run its checks
npm run reset -- --repo ../my-app
```

`tasks.json` is `[{ "agent": "agent-a", "task": "Add a dark mode toggle" }]`.

- **Checks.** The merge runs the commands in the target's `contract.json`
  (`{ "checks": { "unit tests": "pytest -q" } }`), else `CONTRACT_TEST_CMD`, else what it
  detects: `npm test`, `python -m pytest -q`, `go test ./...`, `cargo test`, `mvn -q test` /
  `./gradlew test`, `bundle exec rspec`, `vendor/bin/phpunit`, `dotnet test`. Workers may run
  those without asking.
- **Dependencies.** Each worker worktree and the merge worktree get an install step detected
  from lockfiles (`npm ci`, `pnpm`/`yarn`/`bun install`, a `.venv` with pip, `uv sync`,
  `poetry install`, `go mod download`, `cargo fetch`, `bundle install`, `composer install`,
  `dotnet restore`). Tools missing on the laptop are skipped. Override with
  `"install": "make deps"` in `contract.json`, or turn it off with `"install": false`.
  `node_modules`, `.venv` and friends are never committed to agent branches.
- **Worktrees.** The demo's are `.worktrees/<id>`; another repo's are
  `.worktrees/<name>-<hash>/<id>`, so switching repos never reuses a folder.
- **Push access.** The repo needs an `origin` you can push to for the two-laptop flow
  (workers push `agent/<id>` there); a local-only repo works on one laptop.
- **Code map folders.** Tests and tooling folders (`test/`, `tests/`, `__tests__/`, `scripts/`)
  are left out of the code map. If your app's code lives in one, or a folder should never be
  mapped, say so in `contract.json`: `"map": { "include": ["scripts"], "exclude": ["demo-repo"] }`.
  This monorepo's own `contract.json` does exactly that, so Contract can run on itself
  (`--repo .`); keep agents out of `server/` there, since a schema change needs
  `npm run generate -w @contract/server` and a publish, which no agent should do.
- **Languages.** The code map reads TypeScript and JavaScript (ES modules), plus Python, Go,
  Java, Rust, Ruby, PHP, C# and C/C++ through tree-sitter. For those, call edges are matched by
  name, so they're approximate.

## Benchmark

`npm run bench` runs every scenario in `scripts/scenarios.ts` (the planted rounding +
duplicate case, a duplicate helper, claim contention, a signature change with several
callers, and a no-conflict control) in both modes, then rewrites this table
(`--scenarios a,b --runs N` to narrow it; `--report-only` to rebuild it from recorded runs).

The table below is a first, small sample (1 run per mode, 2 scenarios, generated with
`npm run bench -- --scenarios claim-contention,control --runs 1`); run the full benchmark
(`npm run bench -- --runs 3`) before quoting a number.

<!-- bench:begin -->
Across 2 scenario(s) and 4 runs, Contract saved **26%** of the cost (0% of tokens) and left 0/2 merges broken vs 1/2 without it.

| Scenario | Runs (without / with) | Cost without | Cost with | Saved | Tokens without | Tokens with | Wasted without | Broken merges without | Broken merges with |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claim contention (both modify calculateFee) | 1 / 1 | $0.89 | $0.30 | 66% | 1274.1k | 931.6k | 978.6k | 1/1 | 0/1 |
| Control: unrelated changes | 1 / 1 | $0.29 | $0.33 | -15% | 906.5k | 1147.4k | 0 | 0/1 | 0/1 |

_Generated 2026-11-08T07:33:30.039Z by `npm run bench`. Averages per run; tokens include cache reads (cost is what was billed)._
<!-- bench:end -->

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
