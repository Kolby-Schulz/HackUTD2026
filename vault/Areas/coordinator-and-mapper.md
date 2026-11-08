---
title: Coordinator, mapper, triage, demo-repo
area: coordinator
sources: [mapper/, agents/coordinator/, agents/triage/, demo-repo/]
verified: af2707c+standby
---
Summary: The mapper parses demo-repo into symbol and edge rows and pushes them through upsert_symbols. The coordinator asks a model (Nemotron or Claude Code) to resolve each open conflict, validates the answer, and falls back to a first-claimant rule. Triage (Jev) is a stub that exits unless TRIAGE=on. Demo-repo is the billing app with two planted conflicts; its integration test is red by design.

## Mapper (spec 9)

- Parser: `mapper/src/map.ts`. Maps exported functions, arrow/function consts, other exported consts, classes and their methods (header rules at `map.ts:1-31`). Edges are value references that resolve to mapped symbols, not only calls (`map.ts:1-31`). Type-only references are not edges.
- TS/JS: `RepoMapper` (`map.ts`) builds a ts-morph project over the repo. Exports-only rule, except a JS file with no exports at all (browser script or entry module, e.g. demoRepo's `js/checkout.js`): its top-level declarations are mapped (`isPlainScript`). Before this, agents planning on such a file got `publish_plan: plan item references unknown symbol`. Python, Go, Java, Rust, Ruby, PHP, C#, C/C++: `mapper/src/polyglot.ts` + `lang.ts` via tree-sitter (`@vscode/tree-sitter-wasm` pinned 0.3.1); signatures are canonical `name(p: T): R` so Rule 2 parses them unchanged; call edges are matched by name (same file first, else a unique repo-wide name). `createRepoMapper(dir)` (async) combines both; hooks use `mapFileAsync` / `symbolRangesAsync`. `SKIP_DIRS` at `map.ts:377`; `test/tests/__tests__/scripts` are non-source (`NON_SOURCE_DIRS`), unless the target's `contract.json` has `"map": { "include": [...], "exclude": [...] }` (`MapPolicy` in `map.ts`; module state set by `useMapPolicy(repoDir)`, which `listMappableFiles`/`mapFile` and the worker hooks call). The monorepo's own `contract.json` includes `scripts/` and excludes `demo-repo/` so Contract can run on itself (`--repo .`).
- Output: `FileMap` per file, pushed by `MapSync.push` (`mapper/src/sync.ts:127`). `planUpsert` (`sync.ts:41`) sends only when symbols, hashes or edges differ, so restarts and no-op saves bump nothing.
- Sync never sends `behavior_note`; it always sends `''` (`sync.ts:6-8`). Agents set it through `report_change`.
- CLI (`mapper/src/cli.ts`): `--repo` (default `CONTRACT_TARGET`, else demo-repo, `cli.ts:106`); refuses `.worktrees/` paths (`cli.ts:107`). every run takes the `mapper` service lock (one-shot releases it after the push; the server accepts `upsert_symbols` only from its holder, #62), debounces 150 ms or 1 s in bursts (`cli.ts:33-35`), and re-maps the whole repo above 50 changed files (`cli.ts:37`).
- Feeds the server through `upsert_symbols`; the coordinator reads the same rows via `client.getContext`.

## Coordinator (spec 12)

- Entry: `agents/coordinator/src/index.ts`. Provider = `COORDINATOR_PROVIDER`, else `LLM_PROVIDER`, else `claude-code` (`provider.ts:7-9`). `index.ts:21-23` picks the provider and model. `--demo [duplicate]` runs one planted conflict with no DB (`index.ts:26-31`).
- Agent row `model` (the DB's record of who decides): `nemotron:<NVIDIA_COORDINATOR_MODEL>` or `claude-code:<COORDINATOR_MODEL>` (`provider.ts:12-16`, written at `live.ts:177`).
- Decision flow: `decideConflict` (`decide.ts:100`) calls `llm.decide` with `purpose: 'coordination'`. It validates (`isValid`, `decide.ts:76`: owner must be one of the two agents, both instructions non-empty) and retries once. On failure it returns `fallbackDecision` (`decide.ts:87`): the first claimant owns the symbol, and the other agent adapts.
- `handleConflict` (`live.ts:106`): mark `resolving`, build context, decide, then `resolve_conflict` or `dismiss_conflict`. Any error after marking applies the fallback so workers are not left paused.
- Serial queue, deduped by conflict id (`live.ts:136`). Subscribes to `conflict`, `decision`, `plan`, `plan_item`, `task`, `change`, `run` (`live.ts:192-200`), and only handles `status === 'open'` (`live.ts:231`).
- Prior decisions: up to 6 earlier decisions from the current run that involve either agent (`live.ts:27-43`, `MAX_PRIOR` at `live.ts:24`).
- Lock and identity: `acquire()` in `runLive` connects, registers `coordinator` and takes the `holdService` "coordinator" lock; saved token in `.contract/coordinator-tokens.json`, or `COORDINATOR_TOKEN`. If the server refuses because another coordinator is live (`takenBy`), it stands by and retries every 10 s, taking over when the lock is released (Ctrl-C or SIGTERM from the control daemon release it). `COORDINATOR_STANDBY=off` fails fast instead.
- Prompt: `buildPrompt` (`decide.ts:63-74`). Per-kind hint for `duplicate` says agent A came first and B reuses A's function (`decide.ts:54-61`). Says "what, not how": no code or formulas. Output schema `DECISION_SCHEMA` (`decide.ts:28-39`): action, owner_agent, instructions_a, instructions_b, reason.
- Nemotron provider: `packages/llm/src/nemotron.ts`, `temperature: 0` (`nemotron.ts:100`), `response_format: json_schema` (`nemotron.ts:109`). `createLLM('nemotron')` in `packages/llm/src/index.ts:16`. Workers stay on Claude Code; Nemotron `runWorker` is phase 2 (unverified in this pass, per `docs/nemotron-coordinator-plan.md` section 6).
- Planted fixtures: `FEE_CONFLICT` (`fixtures.ts:8`, broken_dependency on calculateFee, owner agent-a) and `DUPLICATE_CONFLICT` (`fixtures.ts:22`, owner agent-a, B reuses formatDate).

### Spec deviations (coordinator)

- Spec 12 prompt is extended: `priorDecisions`, `kindHint`, and a "no code" rule (`decide.ts:54-72`). Recorded in the Nemotron plan section 6.
- Spec 12 says subscribe to `open`, plus `escalated` when triage is on. Code subscribes to `open` only (`live.ts:231`); no escalated path exists yet.

## Triage, Jev (spec 12b, stretch)

- `agents/triage/src/index.ts`: exits with "TRIAGE is off" unless `TRIAGE=on`. When on, it only logs "not implemented yet" (`index.ts:4-8`). No Jev calls exist.
- Planned in spec 12b: four questions (real conflict, behavior change, duplicate, plan clash). Thresholds are env names only: `TRIAGE_RESOLVE_P`, `TRIAGE_BEHAVIOR_P`, `TRIAGE_DUPLICATE_P`, `TRIAGE_PLAN_CLASH_P`, plus `JEV_API_KEY` (`.env.example:29-35`).
- Everything must work with `TRIAGE=off`. It does today.

## Demo-repo (spec 14)

- Billing app, no runtime deps (`demo-repo/README.md`). Not an npm workspace.
- `src/billing/fees.ts:7-8`: `calculateFee` rounds DOWN (`Math.floor`), 2.5%. This is the planted behavior conflict.
- `src/billing/invoice.ts:10-23`: `buildInvoice` uses `calculateFee`.
- `src/checkout/checkout.ts:7-9`: `computeTotal` uses `calculateFee`.
- Planted duplicate: no date formatter exists; `scripts/check-dupes.ts:19-20` heuristics, and it exits 1 when there are more than one (`check-dupes.ts:64-66`).
- Tasks (spec 14): A adds late fees (half-up) and a due date on invoices; B adds a receipt with the total and order date, formatted like `Nov 7, 2026`.
- `tests/integration.test.ts` is the judge. Half-up test on 1020 and 1010 cents (`:15-18`); invoice total equals checkout total (`:20-24`); receipt match on `/10\.46|1046/` and `Nov 7, 2026` (`:44-51`); invoice shows `Dec 7, 2026` (`:53-55`). Agents must not edit it.
- Dates in fixtures use `Date.UTC` (`tests/fixtures.ts:9-17`).

## How to run and test

Root scripts: `npm run mapper`, `npm run coordinator`, `npm run triage`, `npm run demo` (`scripts/run-demo.ts`), `npm run reset` (`scripts/reset.ts`).

Mapper:
- `npm run mapper -- --dry-run [--json]` prints the map with no server. Add `--repo ../demo-repo` to point elsewhere.
- Unit: `npm test -w @contract/mapper` (tests in `mapper/test/`). Not run in this pass.
- Live: `SPACETIME_HOST=ws://localhost:3000 npm run test:live -w @contract/mapper`. Needs `spacetime start`. Uses a throwaway DB, `CONTRACT_MAPPER_LIVE_DB` (default `contract-mappertest`).

Coordinator:
- Unit: `npm test -w @contract/coordinator` (last reported 15/15 in `docs/nemotron-coordinator-plan.md:263`; not re-run here).
- Real Nemotron, no DB: `npm run test:nemotron -w @contract/coordinator`. Needs `NVIDIA_API_KEY`; optional `NVIDIA_COORDINATOR_MODEL`, `NEMOTRON_RUNS` (default 3). Skipped without the key.
- Live DB: `npm run test:live -w @contract/coordinator`. Needs `spacetime start`. Env: `SPACETIME_LIVE_HOST` (default `ws://localhost:3000`) and `CONTRACT_COORD_LIVE_DB` (default `contract-livetest-coord`). Nemotron case needs `NVIDIA_API_KEY`.
- Manual: `COORDINATOR_PROVIDER=nemotron npm run coordinator -- --demo [duplicate]`.
- Env names: `COORDINATOR_PROVIDER`, `LLM_PROVIDER`, `COORDINATOR_MODEL`, `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_COORDINATOR_MODEL`, `NVIDIA_MAX_TOKENS`, `NVIDIA_THINKING`, `NVIDIA_PRICE_IN_PER_M`, `NVIDIA_PRICE_OUT_PER_M`, `COORDINATOR_TOKEN`, `CONTRACT_MACHINE`, `SPACETIME_HOST`, `SPACETIME_DB_NAME`.

Demo-repo (from `demo-repo/`):
- `npm test`: unit tests only. The integration file is excluded (`vitest.config.ts:4`).
- `npm run test:integration`: red by design until both tasks merge.
- `npm run check:dupes`, `npm run typecheck`, `npm run selftest` (`scripts/selftest.ts`, applies hand-written solutions and proves both conflicts fire).
- `npm run verify` chains unit, integration and dupes. Integration is red, so verify fails at baseline.
- Dependencies come from the root `node_modules`. This checkout has none (`ls node_modules` missing), so nothing was run in this pass.

## Gotchas, TODOs, and inferred items

- Retry is weak (inferred): `decideConflict` retries with the same prompt, and Nemotron uses `temperature: 0`, so the retry will often repeat the same answer. Consider a varied retry or a second model.
- `live.ts:177` defaults the agent `model` to `claude-code` when no model is passed. `index.ts` always passes one, so this only matters for other callers.
- Layer 3 test env: the nemotron plan (section 2) says `SPACETIME_HOST`, but `test-live/env.ts:3` reads `SPACETIME_LIVE_HOST`. Use the code's name.
- `--demo` warns "expected owner agent-a" but exits 0 (`index.ts:31`). Do not rely on it as a pass check.
- Mapper spec 9 says the mapper runs on every agent save. Actually the mapper's own watch (chokidar) handles saves in the main checkout; agents update the map through `report_change` (`cli.ts:5-8`, `sync.ts:6-12`). Worktrees are refused.
- `mapper/package.json` pins `chokidar: ^6.0.0`. Unverified against the registry; check on install.
- Triage is a stub. Escalation path (`escalated` status, `record_triage`) does not exist yet. Build only after MVP is green (spec 12b).
- `demo-repo/README.md` says `scripts/run-demo.ts` runs the judge. The file is at root `scripts/run-demo.ts`, not in `demo-repo/`.
- Demo-planned tasks are in `demo-repo/README.md` and spec 14; reset with `npm run reset` before each demo.
