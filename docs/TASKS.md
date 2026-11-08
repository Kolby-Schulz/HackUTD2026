# Contract: task list

Built from the updated spec (`docs/SPEC.md`, Nov 7). Grouped by milestone (section 16), then by owner.
`[x]` = done and verified. Owners: **BE** backend · **AG** agents · **CM** coordinator + mapper · **DD** dashboard + demo.

## Decisions needed first (whole team, before milestone 1 closes)

- [x] **Identity across processes.** Each worker is 3 processes (worker script, Contract MCP server, `contract-hook`) acting as one agent. `register_agent` rejects an id "already linked to another identity". Proposal: the worker passes its SpacetimeDB token to the other two via `CONTRACT_TOKEN` (already wired in `agents/worker`). Confirm BE checks identity by token, not by connection. **BE: confirmed** — reducers check `ctx.sender`, which is the token's identity; a live test reuses the worker token from a second connection.
- [x] **`contract-hook` vs `report_change` rejection.** Section 7 says `report_change` rejects "`modify` on a symbol the agent hasn't claimed", but `kind` has no `modify` value. If it means "rejects unclaimed symbols", the hook's auto-detected signature changes are silently dropped exactly when the agent forgot to claim, which is the case the hook exists for. Proposal: accept unclaimed reports (they still run Rule 1), or open a `claim_contention` conflict instead of rejecting. **BE: implemented the proposal** (`REQUIRE_CLAIM_FOR_CHANGE = false` in `server/src/index.ts`; flip to enforce).
- [x] **Hook must not overwrite the shared code map.** Section 11 says the hook "re-maps that file". From a worktree that must only compare `signature_hash` against the shared `symbol` row, never call `upsert_symbols`, or the code map flips between agents' versions. **Agreed;** recorded at the top of `agents/worker/src/hook.ts` (implementation is the milestone 3 hook task).
- [x] **Hook config location.** Spec puts it in each worktree's `.claude/settings.json`, which gets committed to the agent's branch and merged. Framework passes it with `--settings agents/worker/hook-settings.json` instead (nothing to commit). Confirm. **Agreed;** the worker passes `--settings agents/worker/hook-settings.json`.
- [x] **Scoreboard units.** A trivial Claude Code task measured 81,515 prompt tokens: Claude Code re-sends ~40k tokens of agent prompt per turn, mostly cache reads. Raw token totals will be dominated by this. Proposal: scoreboard headline = cost in $ (from `total_cost_usd`), with tokens shown split into fresh vs cached. Needs a `cache_read_tokens` and `cost_usd` column on `token_usage` (section 6 change; BE + DD). **Done:** `token_usage.cache_read_tokens` (u32) and `cost_usd` (f64), both default 0, appended so existing databases migrate in place; `log_tokens` takes both; `logTokens()` passes them (clamped). Dashboard: fresh = `promptTokens - cacheReadTokens`.
- [x] **Early-stop estimate.** An aborted run reports estimated usage (input exact, output ≈ streamed chars / 4, hidden thinking not counted). Fine for the per-feature "estimated" savings; just know the waste number is a lower bound. **Accepted.**
- [x] **`claim_symbol` "reject + insert conflict" (BE).** A reducer that throws rolls back everything, including the conflict row. So `claim_symbol` records the `claim_contention` conflict and returns without taking the claim; `ContractClient.claim()` must check the `claim` row afterwards and throw "already claimed" itself (AG). **Done both sides;** `ContractClient.claim()` reads the `claim` row and throws `ClaimedError`.
- [x] **Marking a conflict `resolving` (BE + CM).** Coordinator step 1 marks a conflict `resolving`, but section 7 has no reducer for it. `resolve_conflict`/`dismiss_conflict` accept `open` or `resolving`. **Done:** `mark_conflict_resolving(conflict_id)`, coordinator only, `open` → `resolving` (rejects anything not `open`, so two coordinators never both take one); bindings regenerated (`conn.reducers.markConflictResolving`).
- [ ] **Signatures on planned creates (BE + AG).** Rule 2's type match (same params + return, shared name token) needs a signature, but plan items are only `symbol_id` + `intent`. Today the type match runs when `report_change('created', new_signature)` arrives; at plan time only names match (`formatDate` vs `format_date` yes, `formatDate` vs `toDisplayDate` no). Proposal: optional `signature` on `publish_plan` items (+ `plan_item.signature` column) so the demo's duplicate is caught before any code is written.
- [ ] Open questions from spec section 19 (track rules, deadline, scheduled-reducer syntax, 8090, Jev key). **Answered:** Claude Code JSON token fields are `usage.input_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens`, `usage.output_tokens`, `total_cost_usd`, `session_id`.

## Milestone 1: Contracts agreed

- [x] Monorepo, workspaces, shared tsconfig, `.env.example`, CLAUDE.md with section 18 rules
- [x] `packages/llm`: `decide()` + `runWorker()` on Claude Code, `LLM_PROVIDER` switch, token + cost reporting, early stop (`AbortSignal`), resume, stream events. Verified against a real login.
- [x] `packages/client`: `ContractClient` API frozen as TypeScript types (section 10) + `noopClient` for `without_contract`
- [x] Workspaces for `packages/mcp` and `agents/triage` (stubs)
- [ ] **Everyone:** install the SpacetimeDB CLI; `claude` logged in on each laptop (`claude -p "hi"` works)
- [x] **BE:** `spacetime init` the module in `server/`; all section 6 tables (+ indexes) as real `table(...)`/`t.*`
- [x] **BE:** publish locally; generate bindings into `packages/client/src/bindings`; commit them (`npm run generate -w @contract/server`; client columns are camelCase, e.g. `symbolId`)
- [x] **AG:** swap the hand-written row types in `packages/client` for the generated ones (client reads generated rows; re-exported as `rows`)

## Milestone 2: Skeletons talk

- [x] **BE:** reducers `register_agent` (stores identity), `heartbeat`, `start_run`/`end_run`, `create_task`/`set_task_status`, `publish_plan`, `claim_symbol`, `release_claim`, `log_tokens`
- [x] **BE:** scheduled `expire_claims` every 30 s (`onSchedule` schedule table; verified on a live server)
- [x] **AG:** `connect()`: register, 15 s heartbeat, subscribe to own `instruction`/`agent`/`conflict`/`decision` rows; implement every `ContractClient` method (`claim()` throws `ClaimedError`; calls fail fast after disconnect; 17 unit + 26 live tests)
- [x] **AG:** `packages/mcp`: MCP server exposing `declare_plan`, `claim_symbol`, `release_claim`, `report_change`, `get_context`, `find_existing`, `get_instructions`; connects with `CONTRACT_AGENT_ID` + `CONTRACT_TOKEN` (+ `CONTRACT_TASK_ID`, `CONTRACT_REPO_DIR`; `get_instructions` acks what it returns; 8 tests + live smoke)
- [x] **AG:** worker script skeleton: worktree + branch, mode switch, MCP config, rules prompt, hook settings, token logging, pause → abort → wait for instruction → resume loop, commit
- [x] **AG:** worker: `set_task_status('in_progress')` at start, release claims + `'done'` at the end; `early_stop` = baseline average coding step minus tokens already generated (local `.contract/tokens.jsonl`; 4000 default without a baseline); on pause waits for unpause and resumes with the decision, not the "pause" notice; baseline mode also sends tokens to `token_usage` when a server is up
- [x] **CM:** `demo-repo/`: `fees.ts` (rounds down), `invoice.ts`, `checkout.ts`, `models.ts`, unit tests, `integration.test.ts` (half-up, invoice == checkout), `scripts/check-dupes.ts`, own `package.json` with vitest
- [x] **CM:** mapper: ts-morph parse → symbols (id `file#name`, `file#Class.method`), signature + `signature_hash`, call edges; `upsert_symbols` per file; `--watch` with chokidar. **Done** (`mapper/src`; 42 unit + 9 live tests). Signatures are the declaration as written (no inference; un-annotated returns left out, so give demo-repo functions return types for Rule 2). Edges = every value reference to a mapped symbol (calls, `new`, methods, callbacks, const reads) through imports/barrels/namespaces; type-only refs aren't edges. Only files whose interface or edges changed are sent (restart = no writes); `behavior_note`, and the signature text while the hash is unchanged, are kept from the server. Watch re-maps importers too. Run one mapper, on main `demo-repo/` only (it refuses `.worktrees/`).
- [x] **CM:** mapper exports `mapFile(path)` for `contract-hook` to reuse. **Done:** `import { mapFile } from '@contract/mapper'`; `mapFile(absPath, { repoDir: <worktree>/demo-repo, edges: false })` parses one file in ~5 ms and gives the same ids/hashes as the main checkout. **Hook note (AG):** `report_change('signature')` updates the row's `signature` but not `signature_hash`, so comparing hashes alone re-reports on every later edit; also compare `signatureHash(row.signature)` (exported) or remember what was already reported.
- [x] **DD:** dashboard connects with `spacetimedb/react`; Agents panel + Activity feed on real tables (Live, Activity, Tokens, Scoreboard tabs; storyboard rows G/F; `npm test -w @contract/dashboard`)
- [ ] **DD:** `scripts/seed.ts`: create the two tasks and a run

## Milestone 3: Rule 1 end to end

- [x] **BE:** `report_change` with Rule 1 (depend items + `symbol_edge` callers), pause affected agents, insert instructions; dedupe open conflicts
- [x] **BE:** `resolve_conflict` / `dismiss_conflict` (coordinator only), `acknowledge_instruction`
- [x] **CM:** coordinator decision logic: section 12 prompt, JSON schema, validation, retry once, claimed-first fallback (`agents/coordinator/src/decide.ts`). `npm run coordinator -- --demo` verified: owner agent-a, B told not to round again.
- [ ] **CM:** coordinator live loop: connect as `coordinator`, subscribe `conflict WHERE status='open'`, mark `resolving`, gather context, decide, resolve, log `coordination` tokens
- [ ] **AG:** `contract-hook` (`agents/worker/src/hook.ts`): read hook stdin, `mapFile`, compare hashes, `reportChange` for signature changes, always exit 0
- [x] **DD:** Code map panel (React Flow): nodes, caller arrows, claimed/changed/conflict colors, planned creates as dashed ghosts

## Milestone 4: Rule 2 end to end

- [x] **BE:** Rule 2 in `publish_plan` (normalized names, same types + shared token), reuse instruction; Rule 3 in `claim_symbol`/`publish_plan` (Rule 2 also re-runs on `report_change('created')` once the signature is known)
- [ ] **AG:** `findExisting` + `getContext` in the client (and MCP tools), log `reuse` / `context_slice` savings. **Client part done** (`context_slice` and `cache_hit` savings logged); **MCP tools done;** `find_existing` logs one `reuse` saving per matched symbol (score ≥ 0.8; estimate `CONTRACT_REUSE_EST_TOKENS`, default 1500, until a baseline measures it). `get_summary` / `put_summary` MCP tools added so workers can read and fill `summary_cache` (`cache_hit` is now reachable from real runs); rules rewritten as an ordered workflow with the symbol id format. A summary hook (`agents/worker/src/summary-hook.ts`) caches file outlines on read, serves them to later agents and counts a `cache_hit` only when the file isn't read anyway. See `docs/spec-additions-summary-tools.md`.
- [ ] **CM:** check the duplicate-formatter scenario resolves to "reuse A's"

## Milestone 5: Without/with runs

- [x] **BE:** `mark_attempt_wasted`, `log_saving`, `cache_summary`/`record_cache_hit`
- [ ] **DD:** `scripts/run-demo.ts --mode … --seed 7`: run both workers, merge branches, run tests + check-dupes, `merge_fix` pass
- [ ] **DD:** `scripts/reset.ts`: restore demo-repo, remove `.worktrees/`, clear run data
- [x] **DD:** Token meter, Savings ticker, Scoreboard panels (duplicate helpers + tests passing show "not recorded" until run-demo stores them)
- [ ] **Everyone:** 3 runs per mode, average, sanity-check numbers

## Milestone 6: Demo-ready

- [ ] Two laptops, fixed seed, three clean rehearsals
- [ ] Backup demo video
- [ ] README with setup + architecture; repo public
- [ ] Pitch rehearsal (section 17)

## After demo-ready (stretch, in this order)

- [ ] **AG:** Nemotron provider in `packages/llm` + `--engine nemotron` worker (Node tool loop over the same MCP tools); re-run with/without. Needed for the NVIDIA track.
- [ ] **CM:** Jev triage (`agents/triage`, section 12b): questions 1–2 first, then 3–4; schema additions from sections 6–7; fallback to a fast model through `decide()`
- [ ] Live diffs + claim guard (`docs/spec-additions-live-code.md`, parts A and C)
- [ ] Context slices + summary cache shown live; judge-typed third task; 8090 decision-log view
