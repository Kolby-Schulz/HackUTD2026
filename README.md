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

2. Start a worker: `npm run worker -- --id agent-b --task 2` (use a different `--id` per laptop).
3. Check who is online. A worker heartbeats every 15 s and goes stale after 60 s:

   ```bash
   spacetime sql --server maincloud contract-hackutd26 "SELECT id, machine, status, last_heartbeat FROM agent"
   ```

After a change to `server/`, the owner republishes with `npm run publish:cloud -w @contract/server`.
Keep live tests local (they wipe their database); they default to `ws://localhost:3000`.

Until `scripts/seed.ts` exists the cloud database has no tasks, so workers log
`unknown task` on status updates; they still connect and run.

## Commands

```bash
npm run mapper -- --repo ../demo-repo --watch
npm run coordinator
npm run worker -- --id agent-a --task 1 --mode with_contract
npm run dashboard
npm run demo -- --mode without_contract --seed 7
npm run reset
npm run typecheck
```
