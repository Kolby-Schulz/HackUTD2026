---
title: Server (SpacetimeDB module)
area: server
sources: [server/]
verified: issue-62-operators+standby
---
Summary: The whole backend is one SpacetimeDB TypeScript module (`server/src/index.ts`, 1140 lines) with pure rule helpers in `server/src/rules.ts`. All state changes go through reducers; Rule 1-3 conflict checks run inline inside `report_change`, `publish_plan` and `claim_symbol`. Reducers that act for an agent check the caller's identity; run bookkeeping and the reset take operators only (`requireOperator`: an agent, machine or machine_access identity), and the code map takes the mapper lock holder only (`requireMapper`); see Identity and auth.

## Purpose and owner
- Owner: backend (CLAUDE.md ownership table; spec sections 6, 7, 8).
- Schema is the single source of truth for the generated client bindings in `packages/client/src/bindings` (regenerate with `npm run generate` after any schema change).
- Module entry: `server/src/index.ts:17-19` imports; `schema({...})` export at `index.ts:~276-303`.

## Tables (all `public: true` unless noted)
- `agent` (`id` PK string): identity, status, current_task_id, token_budget, last_heartbeat. index.ts:58
- `task` (`id` autoInc): title, agent_id, status, attempt, run_id. index.ts:74
- `symbol` (`id` PK = "file#name"): kind, file (btree), signature, signature_hash, behavior_note, version. index.ts:88
- `symbol_edge` (`id` autoInc): caller_id and callee_id, both btree. index.ts:104
- `summary_cache` (`key` PK): summary, summary_tokens, hits. index.ts:113
- `plan` (`id` autoInc): agent_id (btree), task_id, summary, active. index.ts:124
- `plan_item` (`id` autoInc): plan_id and symbol_id (btree), intent, optional `signature` (extra, not in spec). index.ts:136
- `claim` (`symbol_id` PK): agent_id, claimed_at, expires_at. index.ts:150
- `change` (`id` autoInc): agent_id, symbol_id, kind, old/new signature, description. index.ts:160
- `conflict` (`id` autoInc): kind, symbol_id, agent_a, agent_b, status (btree), resolved_at. index.ts:174
- `decision` (`id` autoInc): conflict_id, owner_agent, instructions_a/b, reason. index.ts:189
- `instruction` (`id` autoInc): agent_id (btree), conflict_id, text, acknowledged. index.ts:203
- `file_edit` (`id` autoInc, extra): agent_id and file (btree), diff, symbol_ids. Capped to 50 per agent. index.ts:217
- `service` (`name` PK, extra): one-holder lock for `coordinator` / `mapper`, with holder and heartbeat_at. index.ts:231
- Laptop daemons (extra, `scripts/control.ts`): `machine` (id PK, daemon identity, repo info, heartbeat), `machine_access` (paired dashboard identities; only the daemon writes), `machine_command` (queue; paired dashboards insert, daemon finishes; 20 pending max, 50 kept), `machine_process` (key `<machine>/<proc>`, log tail ≤16k), `machine_chat` (200 kept), `machine_pair_request` (proof hash only; 20 per machine). Reducers: `request_machine_pairing`, `resolve_machine_pairing` (daemon only), `register_machine` (another identity takes over only after 60 s silence and wipes access/commands/processes/chat), `update_machine`, `grant_machine_access`, `revoke_machine_access`, `send_machine_command`, `finish_machine_command`, `put_machine_process`, `delete_machine_process`, `post_machine_chat`. Tests: `server/test/machine.test.ts`.
- `run` (`id` autoInc): mode, seed, started_at, ended_at. index.ts:244
- `token_usage` (`id` autoInc): run_id (btree), agent_id, task_id, attempt, purpose, tokens, wasted, cache_read_tokens, cost_usd. index.ts:255
- `token_saving` (`id` autoInc): run_id, agent_id, kind, tokens_avoided_est, note. index.ts:276
- `expire_claims_schedule` (private, scheduled table): drives `expire_claims` every 30 s. index.ts:290

## Reducers
Arguments are abbreviated; see the code for exact types.
- `init()` (lifecycle): inserts the 30 s schedule row for `expire_claims`. index.ts:544
- `register_agent(id, name, owner_dev, machine, model, token_budget)`: insert, or relink identity. A different identity can take over only after 60 s without heartbeat (message names the machine and the wait). Exception: the `coordinator` id follows the `coordinator` service lock: refused ("coordinator is already running on <machine>") while another identity holds a live lock, otherwise taken over at once. index.ts:697
- `heartbeat(agent_id)`: updates last_heartbeat. Caller must own the agent. index.ts:601
- `start_run(mode, seed)` / `end_run(run_id)`: operators only. Refuses to open a second run while one is open.
- `reset_demo_state()`: deletes symbol_edge, symbol, plan, plan_item and claim rows; acks undelivered instructions; dismisses open conflicts; sets agents idle. Operators only. Refused while a run is open, and while any agent is working or paused with a heartbeat under 60 s (`isLiveWorker`): stop the workers first. Keeps change, conflict, decision and token history.
- `upsert_symbols(file, symbols[], edges[])`: caller must hold the `mapper` service lock (`requireMapper`; the mapper CLI holds it in both one-shot and `--watch` mode). Replaces one file's symbols and outgoing edges. Keeps agent-owned behavior_note, and keeps signature and version while the hash is unchanged.
- `create_task(title, description, agent_id, run_id)`: operators only (a paired dashboard, the scripts, or any agent). Status starts at `todo`.
- `set_task_status(task_id, status)`: only the task's agent identity or the coordinator. Enforces TASK_TRANSITIONS (index.ts:45). Syncs the agent row.
- `publish_plan(agent_id, task_id, summary, items[])`: deactivates the agent's old plan. Rejects unknown symbols except for `create`. Then runs Rule 3 (modify) and Rule 2 (create). index.ts:739
- `claim_symbol(agent_id, symbol_id, ttl_secs)`: Rule 3. On contention it returns without throwing (see Gotchas). index.ts:783
- `release_claim(agent_id, symbol_id)`: caller must hold the claim. index.ts:798
- `report_change(agent_id, symbol_id, kind, new_signature?, description)`: writes a change, updates the symbol, and for `created` runs Rule 2 and returns. Otherwise runs Rule 1 and pauses affected agents with an instruction. index.ts:812
- `mark_conflict_resolving(conflict_id)` (coordinator only): open to resolving. index.ts:906
- `resolve_conflict(conflict_id, owner_agent, instructions_a, instructions_b, reason)` (coordinator only): writes a decision and one instruction per agent, marks resolved, and unpauses both. index.ts:917
- `dismiss_conflict(conflict_id, reason)` (coordinator only): marks dismissed and tells a paused agent_b to continue. index.ts:952
- `acknowledge_instruction(instruction_id)`: caller must be the instruction's agent. index.ts:970
- `claim_service(name, machine, holder)` / `release_service(name, holder)`: single-holder lock. Stale after 30 s. index.ts:985, 1011
- `report_edit(agent_id, file, diff, symbol_ids[])`: diff truncated at 20,000 chars. Keeps newest 50 rows per agent. index.ts:1020
- `send_instruction(agent_id, text)`: operator push. `'*'` targets working or paused workers. Prefixes text with `Operator: `. Open to any caller by design. index.ts:1039
- `log_tokens(...)`: checks that cache_read_tokens <= prompt_tokens and cost >= 0, and validates purpose. index.ts:1064
- `mark_attempt_wasted(task_id, attempt)`: operators only. Flags that attempt's token rows and bumps task.attempt.
- `log_saving(...)`: `requireAgent(agent_id)`; validates kind.
- `cache_summary(key, summary, summary_tokens)` / `record_cache_hit(key)`: caller must be some registered agent's identity (`requireRegistered`).
- `expire_claims` (scheduled, 30 s): deletes expired claims. Sets working or paused agents with heartbeat older than 60 s to idle. index.ts:1124

## Rules (rules.ts and index.ts helpers)
- Rule 1, broken dependency: in `report_change` for signature or behavior changes. Affected agents are those with a `depend` plan item on S, plus agents whose active plan items touch a symbol that calls S (via symbol_edge). Each gets a conflict, is paused, and receives an instruction. Dedup is by open/resolving (kind, symbol, pair) in openConflict. index.ts:812-903 and openConflict at index.ts:394
- Rule 2, duplicate: `checkDuplicates` (index.ts:476). Matches by normalized name, or by same types plus a shared token, via `duplicateReason` (rules.ts:112). Skips symbols the agent created itself.
- Rule 3, contention: `checkContention` (index.ts:526), called by claim_symbol and publish_plan(modify).
- Helpers: `requireAgent` index.ts:365, `requireCoordinator` :374, `openConflict` :394, `sendInstruction` :422, `activePlanItemsOn` :434, `liveClaim` :444, `maybeUnpause` :451.

## Identity and auth
- `requireAgent` (index.ts:365): the agent row must exist and its identity must equal `ctx.sender`.
- `requireCoordinator`: the agent row with id `coordinator` must match the sender.
- `requireOperator` (#62): the sender is the identity of any `agent` row, any `machine` row (a laptop's `npm run control` daemon) or any `machine_access` row (a dashboard paired with one). Gates `start_run`, `end_run`, `create_task`, `mark_attempt_wasted`, `reset_demo_state`. The admin scripts (`scripts/lib.ts` `adminConnect`) connect as this laptop's machine with the daemon's saved token (`machine:<hostname>` in `.contract/identities.json`) and register the machine row themselves when no daemon has; an unpaired dashboard is told to pair before it can create a task.
- `requireMapper`: the sender holds the `service` row named `mapper` (`claim_service`). Gates `upsert_symbols`. Registration (`register_agent`, `register_machine`, `claim_service`) stays open, so this stops anonymous and accidental calls on the public database name, not a determined attacker.
- The mapper and coordinator are identified by convention (`service` lock plus the fixed agent ids), not by a separate role.

## Build, publish, test
- `npm run typecheck -w @contract/server`: tsc --noEmit.
- `npm run build -w @contract/server`: `spacetime build --module-path .`
- `npm run publish` (local, db `contract`) and `npm run publish:cloud` (maincloud, `contract-hackutd26`).
- `npm run generate`: writes TypeScript bindings to `packages/client/src/bindings`.
- `npm test -w @contract/server`: vitest unit tests, 15 files under `test/`. These run the real module in SpacetimeDB's in-process harness (`test/helpers.ts`). No server needed.
- `npm run test:live -w @contract/server`: needs `spacetime start` at `SPACETIME_HOST` (default ws://localhost:3000). `test-live/setup.ts` republishes to `contract-livetest` with `--delete-data=always`, which wipes that database. Takes about 30 s because one test waits for the real schedule. Needs generated bindings.
- postinstall symlinks `node_modules/.bin/tsc` (hack, see Gotchas).

## Gotchas
- Operator gating (#62) means a plain `DbConnection` with a fresh identity can no longer reset, open or close runs, or create tasks: tests use `asOperator(t, ...)` (registers machine `laptop` as the `daemon` identity) and `asMapper(t, ...)` (takes the `mapper` lock) from `test/helpers.ts`; a new script must go through `adminConnect`. `upsert_symbols` from a connection without the `mapper` lock fails with `only the mapper can write the code map`, so a one-shot `npm run mapper` fails while a `--watch` mapper runs elsewhere (`mapper is already running on <machine>`). reset_demo_state also refuses while a worker is live (`isLiveWorker`). Still open to any identity: send_instruction (by design) and the registration reducers.
- No client-disconnect lifecycle reducer, on purpose: every hook process (`hook.ts`, `claim-guard.ts`, `summary-hook.ts`) opens a short connection with the agent's identity, and a wifi blip drops the worker's socket while it keeps running. Presence is heartbeat (15 s) plus the 30 s sweep (`expire_claims`, 60 s timeout). Expect 60 to 90 s before a dead worker shows idle.
- claim_symbol does not reject on contention. It returns without throwing, so the conflict row survives. Callers must read the claim row to learn the outcome. Spec section 7 says "Reject". This is deliberate per index.ts:1-14 header comment.
- register_agent allows identity takeover after 60 s of silence. Spec says "already linked to another identity" rejects. Also deliberate per header comment. For `coordinator` the lock decides instead, so a standby coordinator on the other laptop takes over without the 60 s wait.
- Rule 2 on a pre-existing mapper symbol only sends an instruction and opens no conflict (index.ts:476-500). Spec section 8 says a match inserts conflict(kind='duplicate'). Deliberate per comment.
- Rule 1 step 3 includes callers with `depend` plan items. Spec says only "modifies or creates" (index.ts:812-903, Rule 1 block). Minor mismatch.
- checkDuplicates scans the full symbol table, and creatorOf (index.ts:464) scans the full change table for each symbol. That is O(symbols x changes) per plan. (unverified: performance impact at demo scale)
- Orphaned doc comment "Rule 3 (claim contention)..." sits above creatorOf at index.ts:462. It belongs to checkContention.
- report_change(kind='created') inserts a symbol with kind hardcoded to `function` (index.ts:~836-846).
- publish_plan does not check that task_id belongs to the agent.
- Extra schema not in spec: file_edit, service, plan_item.signature, expire_claims_schedule, the TASK_TRANSITIONS rules, and reducers reset_demo_state, send_instruction, claim_service, release_service, report_edit. Spec-additions doc: docs/spec-additions-live-code.md.
- Jev stretch items (record_triage, flag_conflict, conflict.status 'escalated', change.source) are not present. Expected, since they are stretch.
- Spec section 7 `log_tokens` "Rejects when: the agent hasn't claimed" is garbled. The code checks identity plus token and cost bounds instead.
- Tests were not run for this note. Counts are from grep.
