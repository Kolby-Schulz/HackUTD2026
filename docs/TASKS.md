# Contract: task list

Built from the updated spec (`docs/SPEC.md`, Nov 7). Grouped by milestone (section 16), then by owner.
`[x]` = done and verified. Owners: **BE** backend · **AG** agents · **CM** coordinator + mapper · **DD** dashboard + demo.

## Decisions needed first (whole team, before milestone 1 closes)

- [ ] **Identity across processes.** Each worker is 3 processes (worker script, Contract MCP server, `contract-hook`) acting as one agent. `register_agent` rejects an id "already linked to another identity". Proposal: the worker passes its SpacetimeDB token to the other two via `CONTRACT_TOKEN` (already wired in `agents/worker`). Confirm BE checks identity by token, not by connection. **BE: confirmed** — reducers check `ctx.sender`, which is the token's identity; a live test reuses the worker token from a second connection.
- [ ] **`contract-hook` vs `report_change` rejection.** Section 7 says `report_change` rejects "`modify` on a symbol the agent hasn't claimed", but `kind` has no `modify` value. If it means "rejects unclaimed symbols", the hook's auto-detected signature changes are silently dropped exactly when the agent forgot to claim, which is the case the hook exists for. Proposal: accept unclaimed reports (they still run Rule 1), or open a `claim_contention` conflict instead of rejecting.
- [ ] **Hook must not overwrite the shared code map.** Section 11 says the hook "re-maps that file". From a worktree that must only compare `signature_hash` against the shared `symbol` row, never call `upsert_symbols`, or the code map flips between agents' versions.
- [ ] **Hook config location.** Spec puts it in each worktree's `.claude/settings.json`, which gets committed to the agent's branch and merged. Framework passes it with `--settings agents/worker/hook-settings.json` instead (nothing to commit). Confirm.
- [ ] **Scoreboard units.** A trivial Claude Code task measured 81,515 prompt tokens: Claude Code re-sends ~40k tokens of agent prompt per turn, mostly cache reads. Raw token totals will be dominated by this. Proposal: scoreboard headline = cost in $ (from `total_cost_usd`), with tokens shown split into fresh vs cached. Needs a `cache_read_tokens` and `cost_usd` column on `token_usage` (section 6 change; BE + DD).
- [ ] **Early-stop estimate.** An aborted run reports estimated usage (input exact, output ≈ streamed chars / 4, hidden thinking not counted). Fine for the per-feature "estimated" savings; just know the waste number is a lower bound.
- [ ] Open questions from spec section 19 (track rules, deadline, scheduled-reducer syntax, 8090, Jev key). **Answered:** Claude Code JSON token fields are `usage.input_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens`, `usage.output_tokens`, `total_cost_usd`, `session_id`.

## Milestone 1: Contracts agreed

- [x] Monorepo, workspaces, shared tsconfig, `.env.example`, CLAUDE.md with section 18 rules
- [x] `packages/llm`: `decide()` + `runWorker()` on Claude Code, `LLM_PROVIDER` switch, token + cost reporting, early stop (`AbortSignal`), resume, stream events. Verified against a real login.
- [x] `packages/client`: `ContractClient` API frozen as TypeScript types (section 10) + `noopClient` for `without_contract`
- [x] Workspaces for `packages/mcp` and `agents/triage` (stubs)
- [ ] **Everyone:** install the SpacetimeDB CLI; `claude` logged in on each laptop (`claude -p "hi"` works)
- [x] **BE:** `spacetime init` the module in `server/`; all section 6 tables (+ indexes) as real `table(...)`/`t.*`
- [x] **BE:** publish locally; generate bindings into `packages/client/src/bindings`; commit them (`npm run generate -w @contract/server`; client columns are camelCase, e.g. `symbolId`)
- [ ] **AG:** swap the hand-written row types in `packages/client` for the generated ones

## Milestone 2: Skeletons talk

- [x] **BE:** reducers `register_agent` (stores identity), `heartbeat`, `start_run`/`end_run`, `create_task`/`set_task_status`, `publish_plan`, `claim_symbol`, `release_claim`, `log_tokens`
- [x] **BE:** scheduled `expire_claims` every 30 s (`onSchedule` schedule table; verified on a live server)
- [ ] **AG:** `connect()`: register, 15 s heartbeat, subscribe to own `instruction`/`agent`/`conflict`/`decision` rows; implement every `ContractClient` method
- [ ] **AG:** `packages/mcp`: MCP server exposing `declare_plan`, `claim_symbol`, `release_claim`, `report_change`, `get_context`, `find_existing`, `get_instructions`; connects with `CONTRACT_AGENT_ID` + `CONTRACT_TOKEN`
- [x] **AG:** worker script skeleton: worktree + branch, mode switch, MCP config, rules prompt, hook settings, token logging, pause → abort → wait for instruction → resume loop, commit
- [ ] **AG:** worker: release claims + `set_task_status('done')` at the end; real `early_stop` estimate
- [ ] **CM:** `demo-repo/`: `fees.ts` (rounds down), `invoice.ts`, `checkout.ts`, `models.ts`, unit tests, `integration.test.ts` (half-up, invoice == checkout), `scripts/check-dupes.ts`, own `package.json` with vitest
- [ ] **CM:** mapper: ts-morph parse → symbols (id `file#name`, `file#Class.method`), signature + `signature_hash`, call edges; `upsert_symbols` per file; `--watch` with chokidar
- [ ] **CM:** mapper exports `mapFile(path)` for `contract-hook` to reuse
- [ ] **DD:** dashboard connects with `spacetimedb/react`; Agents panel + Activity feed on real tables
- [ ] **DD:** `scripts/seed.ts`: create the two tasks and a run

## Milestone 3: Rule 1 end to end

- [x] **BE:** `report_change` with Rule 1 (depend items + `symbol_edge` callers), pause affected agents, insert instructions; dedupe open conflicts
- [x] **BE:** `resolve_conflict` / `dismiss_conflict` (coordinator only), `acknowledge_instruction`
- [x] **CM:** coordinator decision logic: section 12 prompt, JSON schema, validation, retry once, claimed-first fallback (`agents/coordinator/src/decide.ts`). `npm run coordinator -- --demo` verified: owner agent-a, B told not to round again.
- [ ] **CM:** coordinator live loop: connect as `coordinator`, subscribe `conflict WHERE status='open'`, mark `resolving`, gather context, decide, resolve, log `coordination` tokens
- [ ] **AG:** `contract-hook` (`agents/worker/src/hook.ts`): read hook stdin, `mapFile`, compare hashes, `reportChange` for signature changes, always exit 0
- [ ] **DD:** Code map panel (React Flow): nodes, caller arrows, claimed/changed/conflict colors

## Milestone 4: Rule 2 end to end

- [ ] **BE:** Rule 2 in `publish_plan` (normalized names, same types + shared token), reuse instruction; Rule 3 in `claim_symbol`/`publish_plan`
- [ ] **AG:** `findExisting` + `getContext` in the client (and MCP tools), log `reuse` / `context_slice` savings
- [ ] **CM:** check the duplicate-formatter scenario resolves to "reuse A's"

## Milestone 5: Without/with runs

- [x] **BE:** `mark_attempt_wasted`, `log_saving`, `cache_summary`/`record_cache_hit`
- [ ] **DD:** `scripts/run-demo.ts --mode … --seed 7`: run both workers, merge branches, run tests + check-dupes, `merge_fix` pass
- [ ] **DD:** `scripts/reset.ts`: restore demo-repo, remove `.worktrees/`, clear run data
- [ ] **DD:** Token meter, Savings ticker, Scoreboard panels
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
