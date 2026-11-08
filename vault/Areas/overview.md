---
title: Project overview
area: overview
sources: [README.md, docs/SPEC.md, docs/TASKS.md, CLAUDE.md]
verified: 87debe9
---
Summary: Contract is a SpacetimeDB coordination layer. Coding agents publish plans, claims and changes to it, so conflicts are caught while code is written, not at merge.
Claude Code runs every agent and the coordinator today; Nemotron and Jev triage are stretch goals.
Team of four owner areas (BE, AG, CM, DD) per CLAUDE.md. Milestones 1-4 and most of 5 are done per TASKS.md; rehearsals, benchmark runs and the public README are open.

## What Contract is and the demo story
- Contract is developer infrastructure, not a coding agent. It writes no feature code (SPEC section 1).
- Problem: git only catches text-level conflicts. Agents make incompatible decisions that merge cleanly and break later, or write duplicate helpers.
- Demo: two laptops, each running a Claude Code worker on `demo-repo/` (a small TypeScript billing app). Agent A changes `calculateFee` to round half-up. Agent B's checkout depends on it. Rule 1 fires, B pauses, the coordinator tells B not to round again. Both agents also write a date formatter; Rule 2 catches the duplicate and B reuses A's. A dashboard shows it live (SPEC sections 14, 17).
- Proof: with/without runs, scored on tokens, wasted tokens, conflicts at merge, duplicate helpers and tests passing (SPEC section 15).
- Pitch line: "Contract isn't another coding agent. It's what lets your team's coding agents work like a team."

## Architecture
```
 laptop A / laptop B                         operator laptop
 +--------------------------+                +------------------------------+
 | worker (agents/worker)   |                | coordinator (agents/coordinator)
 |   claude -p (packages/llm)|               |   decide() -> resolve/dismiss |
 |   contract MCP server    |                +---------------+--------------+
 |   contract-hook (edits)  |                                |
 +------------+-------------+                                |
              | reducers + live subscriptions                |
              v                                              v
        +-------------------------------------------------------+
        | SpacetimeDB module (server/)                          |
        | tables (SPEC 6), reducers (SPEC 7), rules (SPEC 8)    |
        +-------------------------------------------------------+
              ^ upsert_symbols                  ^ subscribe
              |                                 |
        mapper (mapper/, ts-morph + tree-sitter)      dashboard (dashboard/, React)
```
- SpacetimeDB server: all state. Reducers are the only writers, each a transaction. No network or filesystem access inside reducers (CLAUDE.md).
- Worker (`agents/worker`): registers the agent, makes a git worktree and branch, runs Claude Code headless, handles pause/resume and token logging. Its MCP tools live in `packages/mcp`.
- Contract hook (`agents/worker/src/hook.ts`): PostToolUse hook; maps the edited file and reports signature changes.
- Coordinator (`agents/coordinator`): subscribes to open conflicts, asks the model for a JSON decision, calls `resolve_conflict` or `dismiss_conflict`. Never edits code (SPEC 12).
- Mapper (`mapper/`): repo files to `symbol` and `symbol_edge` rows via `upsert_symbols`. Watch mode on the operator laptop only (SPEC 9; docs/two-laptop-rehearsal.md).
- Dashboard (`dashboard/`): read-only subscriber, plus start/reset controls (SPEC 13).
- LLM layer (`packages/llm`): `decide()` and `runWorker()`; provider picked by `LLM_PROVIDER` / `COORDINATOR_PROVIDER`; logs tokens and cost (SPEC 4, 12).
- Client (`packages/client`): `ContractClient` API (SPEC 10); generated bindings in `packages/client/src/bindings`. Triage (`agents/triage`): optional Jev process, off by default (SPEC 12b).

## Tech stack and versions (from package.json files)
- SpacetimeDB TypeScript SDK `spacetimedb ^2.14.1` (server, client, dashboard). SpacetimeDB CLI version not pinned in repo; SPEC 4 cites v2.8.0 as latest seen (unverified current CLI).
- Node: README says 20+, rehearsal doc says 22+ (see gaps). TypeScript `~5.9.3`, `tsx ^4.23.15`, `vitest ^3.2.7`.
- Mapper `ts-morph ^28.0.0`, `chokidar ^6.0.0`; MCP `@modelcontextprotocol/sdk ^1.32.2`, `zod ^3.25.76`; LLM `openai ^7.53.0` (Nemotron path).
- Dashboard: React `^19.3.1`, `@xyflow/react ^12.12.1` (React Flow), Vite `^8.3.6`, `@vitejs/plugin-react ^5.0.0`.
- Models (`.env.example`, unverified that these slugs exist): worker `claude-sonnet-5-5`, coordinator `claude-opus-5-5`. Nemotron: `nvidia/nemotron-3.5-lightning-30b-a3b` (coordinator default), `nvidia/nemotron-3-ultra-550b-a55b` (SPEC 4).

## Requirements
MVP checklist (SPEC section 16). Status from docs/TASKS.md where it says something; unchecked means not confirmed done.
- [x] Demo repo with tests and both planted conflicts (`demo-repo/`; TASKS M2)
- [x] Mapper loads symbols and edges (TASKS M2)
- [x] Plans, claims and changes through reducers (TASKS M2-M3)
- [x] Rules 1 and 2 detect the planted conflicts (Rule 2 "not yet seen in a full live `npm run demo`", TASKS M4)
- [ ] Coordinator resolves both; workers pause, take instructions and resume (coordinator and pause loop built; full live run not confirmed)
- [x] Token logging on every model call; early stop working (TASKS M2)
- [ ] Dashboard: code map, agents, feed, token meter, scoreboard (token meter, savings, scoreboard built; live code map and feed status not stated, TASKS M2-M5)
- [ ] Without/with runs averaged over 3 runs each (run-demo unchecked; README benchmark is a 1-run sample)
- [ ] Public GitHub repo with README (README exists; repo-public status unknown)
- [ ] Backup demo video

Milestone 6 also: two laptops, fixed seed, three clean rehearsals, pitch rehearsal (SPEC 16, TASKS M6). All open.

Stretch (SPEC 16, after MVP; do not start before MVP passes):
- Nemotron swap: `--engine nemotron` worker, coordinator on Nemotron. Coordinator provider switch exists in `.env.example`; worker Nemotron status unverified.
- Jev triage (SPEC 12b): `agents/triage` is a stub workspace; questions 1-2 first.
- Context slices and summary cache shown live (`get_summary`/`put_summary` MCP tools exist, TASKS M4).
- Developer's own Claude Code/Cursor/Codex session joining live: `npm run join` exists (docs/join-contract.md).
- Judge-typed third task: `npm run judge` exists (docs/two-laptop-rehearsal.md).
- 8090 decision-log view (optional third track, SPEC 19).

## Key fixed names
Names are fixed by spec sections 6, 7, 10 (CLAUDE.md: do not rename without asking).

Tables (SPEC 6, 15 tables): agent, task, symbol, symbol_edge, summary_cache, plan, plan_item, claim, change, conflict, decision, instruction, run, token_usage, token_saving.
- Jev-only additions to conflict/change/token_usage/token_saving (SPEC 6, 12b). Not yet confirmed in code.
- Scheduled `expire_claims` uses an `onSchedule` schedule table (TASKS M2; name unverified).

Reducers (SPEC 7): register_agent, heartbeat, start_run, end_run, upsert_symbols, create_task, set_task_status, publish_plan, claim_symbol, release_claim, report_change, resolve_conflict, dismiss_conflict, acknowledge_instruction, log_tokens, mark_attempt_wasted, log_saving, cache_summary, record_cache_hit, expire_claims (scheduled).
- Added beyond spec: `mark_conflict_resolving` (TASKS decision 15, coordinator only).
- Jev additions: record_triage, flag_conflict (SPEC 7).

Identities (SPEC 7): coordinator registers as agent id `coordinator`; triage as `triage`.

Conflict kinds (SPEC 6): broken_dependency, duplicate, claim_contention (+ plan_clash for Jev). Status: open, resolving, resolved, dismissed (+ escalated for Jev).

## How to run
Setup (README "Setup", SPEC 4, TASKS M1):
1. Node and the SpacetimeDB CLI.
2. `npm install`.
3. `cp .env.example .env`. Local defaults are `SPACETIME_HOST=ws://localhost:3000`, `SPACETIME_DB_NAME=contract`.
4. `spacetime start`, then `npm run publish -w @contract/server` and `npm run generate -w @contract/server`. (Script names from `server/package.json`.)
5. `claude -p "hi"` must work on each laptop (`claude` login; no key needed for the claude-code provider).

Env var names (values never recorded here): LLM_PROVIDER, CLAUDE_BIN, WORKER_MODEL, COORDINATOR_MODEL, COORDINATOR_PROVIDER, NVIDIA_API_KEY, NVIDIA_BASE_URL, NVIDIA_COORDINATOR_MODEL, NVIDIA_WORKER_MODEL, NVIDIA_THINKING, NVIDIA_MAX_TOKENS, NVIDIA_PRICE_IN_PER_M, NVIDIA_PRICE_OUT_PER_M, COORDINATOR_TOKEN, TRIAGE, JEV_API_KEY, TRIAGE_RESOLVE_P, TRIAGE_BEHAVIOR_P, TRIAGE_DUPLICATE_P, TRIAGE_PLAN_CLASH_P, SPACETIME_HOST, SPACETIME_DB_NAME, CONTRACT_TARGET, CONTRACT_TEST_CMD. Also read by code but not in .env.example: CONTRACT_TOKEN, CONTRACT_AGENT_ID, CONTRACT_TASK_ID, CONTRACT_REPO_DIR, CONTRACT_MACHINE, CONTRACT_REUSE_EST_TOKENS (from TASKS and README; unverified against code).

Root npm scripts (root package.json):
- `test` (vitest), `typecheck` (all workspaces), `reset`, `seed` (scripts/seed.ts; TASKS says seed unchecked).
- `mapper`, `worker`, `coordinator`, `triage`, `mcp`, `dashboard`.
- `session` (start | merge), `join`, `judge`, `bench`, `demo`.
Per-workspace: `publish:cloud` and `generate` (server), `watch-agent` (worker), `check:dupes` and `verify` (demo-repo), `test:live` (several).

Two-laptop flow (README "Shared cloud database", docs/two-laptop-rehearsal.md):
- Shared DB is `contract-hackutd26` on maincloud; `.env` sets `SPACETIME_HOST=wss://maincloud.spacetimedb.com`. Only the owner can publish.
- Each laptop: `git pull && npm install`, then `npm run join -- --agent <id> --name ... --owner ...`, then `npm run reset`.
- Operator laptop only: `npm run coordinator`, `npm run dashboard`, `npm run session -- start`, optional `npm run mapper -- --watch`. A second coordinator or watching mapper refuses to start.
- Each laptop: `npm run worker -- --id agent-a --wait` (or `--prompt "..."`), then assign tasks from the dashboard.
- When all agents finish: `npm run session -- merge` (add `--integration` for canned tasks, `--push` to push).
- Network fallbacks: phone hotspot; or a LAN `spacetime start` (rehearsal doc). Claude Code still needs internet.
- Known limit: one coordinator per database; after a crash another laptop can take over 30 s after the last heartbeat.

## Team and ownership (CLAUDE.md, SPEC 5 and 16)
| Folder | Owner | Spec sections |
| --- | --- | --- |
| `server/` | BE (backend) | 6, 7, 8 |
| `packages/client/`, `packages/mcp/`, `agents/worker/` | AG (agents) | 10, 11 |
| `packages/llm/` | shared; interface frozen, AG maintains | 4, 12 |
| `mapper/`, `agents/coordinator/`, `demo-repo/`, `agents/triage/` (stretch) | CM (coordinator + mapper) | 9, 12, 12b, 14 |
| `dashboard/`, `scripts/` | DD (dashboard + demo) | 13, 15, 17 |

Names are blank in SPEC 16 ("name: ___"); not filled in any doc.

## Glossary
- Symbol: a named function, class, method or exported const, id `file#name` or `file#Class.method`.
- Agent: one connected coding agent working one task.
- Plan: an agent's declared summary and plan items (modify / create / depend).
- Claim: exclusive right to change a symbol; expires if the agent goes quiet.
- Change: a reported signature or behavior change.
- Conflict: a detected clash; the coordinator resolves it, or a rule dismisses it.
- Decision and instruction: the coordinator's audit record, and the push sent to each agent.
- Rule 1 (broken dependency), Rule 2 (duplicate implementation), Rule 3 (claim contention): SPEC 8.
- Planted conflict: the two designed collisions in demo-repo (changed rounding, duplicate date helper).
- Early stop: a paused worker's Claude Code process is stopped; logged as a saving.
- Wasted tokens: tokens of an attempt that was thrown away or needed a merge fix.
- Worktree: `.worktrees/<agent-id>` (gitignored); `.worktrees/merge-<run>` for merges. Non-demo targets nest them under `.worktrees/<repoKey>/`.
- contract-hook: PostToolUse hook; reads only, never upserts the shared code map (TASKS decision 10). Claim guard: join-time hook that blocks edits to claimed code or while paused.
- Service lock: one coordinator and one watching mapper per database.
- Jev / triage: TypeSafe's fast decision model, optional triage (SPEC 12b).

## Known gaps and doc conflicts (unverified where noted)
- Node version: README says 20+; rehearsal doc says 22+.
- README setup step 3 says to add `NVIDIA_API_KEY`, but `.env.example` defaults to `claude-code` and SPEC says Nemotron is later.
- TASKS "Decisions" item 17 is unchecked but its body says answered.
- TASKS decisions 9, 14 and 16 change spec behavior (no reject on unclaimed `report_change`; `claim_symbol` records the conflict instead of rejecting; `signature` added to plan items). CLAUDE.md says to stop and ask before renaming tables or reducers. Decision 15 adds `mark_conflict_resolving`, which is not in SPEC 7.
- `run-demo.ts` is unchecked in TASKS M5, but README's Commands list and `npm run demo` are presented as working. Unclear.
- Spec `token_usage` carries `cache_read_tokens` and `cost_usd`, added after the PDF (TASKS decision 12).
- `.env.example` model names and `NVIDIA_*` prices are unverified.
