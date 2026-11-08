---
title: Agents and shared packages
area: agents
sources: [packages/client, packages/mcp, packages/llm, agents/worker]
verified: claude/silly-sinoussi-243c95
---
Summary: `packages/llm` is the only model gateway (`decide` for one structured answer, `runWorker` for a Claude Code run). `packages/client` wraps SpacetimeDB and is the only way a process joins Contract. `packages/mcp` exposes nine tools to workers, and `agents/worker` runs a headless Claude Code session in a git worktree with hooks for claims, change reports and summary caching.
Spec basis: docs/SPEC.md sections 4, 10, 11, 12, plus docs/spec-additions-live-code.md and docs/spec-additions-summary-tools.md (both already built, per their status lines).

Claim guard (`agents/worker/src/claim-guard.ts`) also enforces the protocol since the self-run: no plan -> no edits to mapped source; no own claim -> no edit to a mapped symbol. `CONTRACT_PROTOCOL=off` disables that part.

## packages/llm (sections 4, 12)

Entry: `packages/llm/src/index.ts`. `createLLM()` (index.ts:14) picks the provider from `LLM_PROVIDER`, default `claude-code`. Anything else throws (index.ts:17). Valid values are `claude-code` and `nemotron` (PROVIDERS, index.ts:12).

Interface (`packages/llm/src/types.ts`):
- `Usage` (types.ts:8): `prompt_tokens` (input + cache write + cache read), `completion_tokens`, `cache_read_tokens`, `cost_usd`, optional `estimated` (true only for partial data from an aborted run).
- `decide(prompt, jsonSchema, opts)` (types.ts:68): one answer, no tools. Returns `{ output, usage }`.
- `runWorker(task, opts)` (types.ts:70): a full Claude Code run in `opts.cwd`. Returns `{ sessionId, usage, text }`.
- `WorkerOptions` (types.ts:30): `appendSystemPrompt`, `mcpConfig`, `settings`, `allowedTools`, `env`, `resumeSessionId` (types.ts:45), `onEvent`, `onSessionId`.
- Every option object has `purpose` (types.ts:5 `Purpose` union), `signal` (types.ts:22) and `onUsage` (contract.logTokens hook). Callers must pass `onUsage` or tokens go unlogged.

Abort and resume (`claude-code.ts`):
- `runCli` (claude-code.ts:58) spawns `claude -p --output-format stream-json --verbose` with `signal` (claude-code.ts:78-83). The prompt goes in on stdin (claude-code.ts:132).
- Usage per assistant message is tracked as the stream runs (claude-code.ts:100-117), so an aborted run still reports an estimate (claude-code.ts:69-75, 127).
- An aborted run throws `LLMAbortError` carrying `sessionId` and partial usage (types.ts:74). `decide` and `runWorker` log that partial usage before rethrowing (claude-code.ts:162, 188).
- Resume is `--resume <sessionId>` (claude-code.ts:179).

ClaudeCodeLLM (`claude-code.ts:136`):
- `decide` (claude-code.ts:142): `--tools ''`, `--no-session-persistence`, `--setting-sources ''`, `--json-schema`. Runs in `process.cwd()` (claude-code.ts:157), not a worktree.
- `runWorker` (claude-code.ts:167): `--permission-mode acceptEdits`, `--include-partial-messages`, plus `--strict-mcp-config` (ISOLATION_FLAGS, claude-code.ts:20) so personal MCP servers never load.
- Models come from env: `WORKER_MODEL` (default `claude-sonnet-5-5`, claude-code.ts:138) and `COORDINATOR_MODEL` (default `claude-opus-5-5`, claude-code.ts:139). `CLAUDE_BIN` overrides the binary (claude-code.ts:16).

NemotronLLM (`nemotron.ts:65`):
- `decide` only (nemotron.ts:96). Reads `content` and ignores `reasoning_content` (nemotron.ts:5-7). Thinking off unless `NVIDIA_THINKING=on` (nemotron.ts:84).
- `runWorker` throws "phase 2" (nemotron.ts:137). Workers cannot use Nemotron yet.
- Env: `NVIDIA_API_KEY` (required, nemotron.ts:79), `NVIDIA_BASE_URL`, `NVIDIA_COORDINATOR_MODEL`, `NVIDIA_WORKER_MODEL`, `NVIDIA_MAX_TOKENS`, `NVIDIA_PRICE_IN_PER_M`, `NVIDIA_PRICE_OUT_PER_M`.

## packages/client (sections 4, 10)

Public API is `ContractClient` (`packages/client/src/index.ts:96`). `connect()` is at index.ts:247. Methods:
- Coordination: `publishPlan`, `claim`, `release`, `reportChange`, `reportEdit`.
- Live pushes: `onInstruction`, `onStatusChange`, `ack`, `pendingInstructions`, `status`.
- Tasks and claims: `setTaskStatus`, `myClaims`.
- Token savers: `getContext`, `findExisting`, `getSummary(file, {countHit})` (index.ts:134), `putSummary`.
- Accounting: `logTokens`, `markAttemptWasted`, `logSaving`.

Also exported: `ClaimedError` (index.ts:146), `DbConnection`, `rows` (typed row types), `estimateTokens`, `identity` helpers, `holdService` (service lock), `resolveTarget`/`checkTools`/`DEMO_CHECKS` (target.ts), and `noopClient` (index.ts:504) for without_contract mode.

Behaviors to know:
- `connect` registers the agent and starts a 15 s heartbeat (index.ts:156 `HEARTBEAT_MS`), unless `noHeartbeat` is set (MCP server and hook use it).
- Reconnect loop with 1, 2, 4 ... 30 s backoff (index.ts:192).
- `claim()` (index.ts:362-368) calls `claimSymbol`, then reads the claim row. If another agent holds it, it throws `ClaimedError`. The reducer does not throw, because a throw would roll back the conflict it records.
- `getSummary` counts a hit by default (`countHit` default true, index.ts:442). The summary hook passes `countHit: false` and counts at Stop.
- Identity: one `CONTRACT_TOKEN` per agent id is shared by the worker, its MCP server and its hook (index.ts:38-43 comment). `register_agent` refuses an id held by another identity for 60 s (agents/worker/src/index.ts:107).

Generated bindings:
- `packages/client/src/bindings/` is committed (47 tracked files, including `index.ts`, `types.ts`, and one `*_reducer.ts` per reducer). Do not hand-edit.
- Regenerate with `npm run generate -w @contract/server`. That runs `spacetime generate --lang typescript --out-dir ../packages/client/src/bindings --module-path . --yes` (server/package.json:17). Needs the `spacetime` CLI and a server module that compiles.
- Unverified: whether the bindings are current with `server/src` at HEAD. Regenerate before trusting a new reducer.

## packages/mcp (sections 10, 11)

`packages/mcp/src/index.ts`. Runs as a stdio MCP server, launched by the worker through `--mcp-config`. Its stdout is the protocol channel, so `console.log` is redirected to `console.error` (index.ts:290).

Tools (`TOOLS` array, index.ts:28-38). Each maps to one client call:

| Tool | Client call | Notes |
| --- | --- | --- |
| declare_plan | publishPlan | returns pending instructions at once |
| claim_symbol | claim | `ClaimedError` becomes a tool error that says "do not edit" (index.ts:146-147) |
| release_claim | release | |
| report_change | reportChange | returns pending instructions |
| get_context | getContext | depth 0-3, default 1 |
| find_existing | findExisting | logs one `reuse` saving per symbol (index.ts:225-230) |
| get_instructions | pendingInstructions + ack | delivered once, then acked (index.ts:90-94) |
| get_summary | getSummary | miss returns a read-then-put_summary hint |
| put_summary | putSummary | token count from `estimateTokens` |

The rules, as enforced by the server and the worker:
- Symbol ids are `<file>#<name>` or `<file>#Class.method`, relative to the working directory (index.ts:49-51). Unknown ids get an `ID_HINT` appended to the error.
- `REUSE_MIN_SCORE = 0.8` (index.ts:41). A match at or above it counts as a reuse and is logged once per symbol per process.
- `REUSE_EST_TOKENS` defaults to 1500, set by `CONTRACT_REUSE_EST_TOKENS` (index.ts:47). This is a rough guess, not a measured baseline.
- Claim before modify and report after change are enforced by the claim-guard and hook, not by the server (see agents/worker below).

Startup (index.ts:288-331): needs `CONTRACT_AGENT_ID`, `CONTRACT_TASK_ID`, and `SPACETIME_HOST`/`SPACETIME_DB_NAME`. Token is `CONTRACT_TOKEN`, else the saved identity (index.ts:294). `CONTRACT_HEARTBEAT=1` makes a joined editor register and heartbeat itself (index.ts:296-301, header index.ts:8-12).

## agents/worker (section 11)

Entry: `agents/worker/src/index.ts`, run as `npm run worker -- --id agent-a --task 1 --mode with_contract|without_contract`. Other entry points: `--prompt` and `--wait` (two-laptop session flow), `watch.ts` (sidecar for non-Claude editors), `session-task.ts` (task rows).

Lifecycle of one run:
1. Target and worktree (index.ts:81-93). Target from `--repo`, `CONTRACT_TARGET`, else the demo repo. Worktree is `worktreeDir(REPO, target, id)` (`packages/client/src/target.ts`): `.worktrees/<id>` for the demo, `.worktrees/<repoKey>/<id>` for any other repo, on branch `agent/<id>`. Then `runInstall` installs the target's dependencies (`target.install`, detected from lockfiles or `contract.json` `install`), and the agent's env gets `toolPath(cwd)` (`.venv/bin`, `node_modules/.bin` first). Commits use `DEP_PATHSPEC` so installed folders are never committed. Work happens in `cwd`, the target's subdir inside it.
2. Connect (index.ts:103-126). `with_contract` calls `connect`. `without_contract` uses a fake client (`noopClient`) and logs tokens locally to `.contract/tokens.jsonl` (index.ts:98).
3. Task (index.ts:129-142). Canned from `TASKS` (`tasks.ts`), `--task-text`, `--prompt`, or `--wait`.
4. Wiring (index.ts:148-172). Writes `.contract/mcp/<id>.json` (index.ts:159). Passes `appendSystemPrompt: CONTRACT_RULES` (rules.ts:3), `--settings agents/worker/hook-settings.json`, and `allowedTools` including `mcp__contract`.
5. Mark `in_progress` (index.ts:180).
6. Run loop (index.ts:231-286). `runWorker` on the task. Status `paused` aborts the controller (index.ts:184-186). On pause: log `early_stop` saving (index.ts:269-273), wait for the coordinator (index.ts:276), then resume the same session with `Coordinator decision: ... Continue your task.` (index.ts:283).
7. Guard rails (index.ts:189-209): `--max-minutes`, `--max-output-tokens`. Operator messages from the dashboard interrupt and resume (index.ts:212-227).
8. Finish (index.ts:299-305). `git add -A`, commit, release claims, set `done`.
9. Session flow only (index.ts:307-316): `git push --force -u origin agent/<id>`.

Claude Code hooks (`agents/worker/hook-settings.json`):
- PreToolUse `Read|Bash` runs `summary-hook.ts` (serves cached summaries, caches outlines, counts hits at Stop).
- PreToolUse `Edit|Write|MultiEdit` runs `claim-guard.ts` (blocks edits on others' claims, blocks edits while paused, enforces `CONTRACT_ALLOWED_PATHS`).
- PostToolUse `Edit|Write|MultiEdit` runs `hook.ts` (`contract-hook`: report_change for signature changes, report_edit with the diff).
- Stop runs `summary-hook.ts` again (cache-hit counting).
- The edit hooks are thin: they POST to the agent's sidecar (`sidecar.ts`; 127.0.0.1, port + secret in `.contract/sidecar/<id>.json`), which the worker starts on its own connection (`ContractClient.raw()`) and `watch.ts` starts on a persistent one. No sidecar -> `report.ts` (`directReport`/`directGuard`, a fresh connection, ~1 s). Keep `hook.ts`/`claim-guard.ts` free of mapper/SDK imports or every edit pays ~0.5 s again. `npm run latency` measures it.

Early-stop estimate (`resume.ts:22`): average completion tokens of baseline `code` runs, minus what the stopped attempt already generated. Falls back to `DEFAULT_CODING_STEP_TOKENS = 4000` (resume.ts:15) without a baseline.

Env var names read by the worker and its processes (values not recorded here):
`CONTRACT_AGENT_ID`, `CONTRACT_TOKEN`, `CONTRACT_TASK_ID`, `CONTRACT_REPO`, `CONTRACT_REPO_DIR`, `CONTRACT_ALLOWED_PATHS`, `CONTRACT_TARGET`, `CONTRACT_TEST_CMD`, `SPACETIME_HOST`, `SPACETIME_DB_NAME`, `CONTRACT_MACHINE`, `CONTRACT_OWNER`, `CONTRACT_AGENT_NAME`, `CONTRACT_MODEL`, `CONTRACT_HEARTBEAT`, `CONTRACT_REUSE_EST_TOKENS`, `WORKER_MODEL`, `COORDINATOR_MODEL`, `LLM_PROVIDER`, `CLAUDE_BIN`, `INIT_CWD`, plus `USER`/`HOSTNAME` for defaults.

## Tests

Unit tests (no server). Run from the repo root:
- `npm test -w @contract/llm`: `packages/llm/test/nemotron.test.ts` (fake OpenAI client; covers decide, usage, abort, parseJson, createLLM). Nothing tests `ClaudeCodeLLM`; it has no unit test (unverified: nothing else covers it).
- `npm test -w @contract/client`: `packages/client/test/{context,service,target}.test.ts` (pure helpers: buildContext, rankExisting, summaryKey, holdService, resolveTarget).
- `npm test -w @contract/mcp`: `packages/mcp/test/tools.test.ts` (fake client; lists exactly the spec tools; checks the worker rules mention every tool).
- `npm test -w @contract/worker`: `agents/worker/test/{hook,live-code,resume,summary-hook,sidecar}.test.ts` (pure helpers; sidecar over real HTTP with a fake connection). No `vitest.config` in agents/worker; defaults apply.

Live tests (need a running SpacetimeDB):
- `packages/client/test-live/client.test.ts` and `packages/mcp/test-live/mcp.test.ts`.
- Start the server: `spacetime start` (add `--listen-addr 127.0.0.1:3001` if 3000 is taken).
- Run: `SPACETIME_HOST=ws://localhost:3000 npm run test:live -w @contract/client`, and the same with `-w @contract/mcp`.
- Each setup publishes `server/` to a throwaway database with `spacetime publish ... --delete-data=always` (`contract-clienttest`, `contract-mcptest`; test-live/setup.ts). Needs the `spacetime` CLI on PATH.
- MCP live test starts two real MCP server processes over stdio and covers the Rule 1 and Rule 2 paths (mcp.test.ts header).
- No live test exists for `agents/worker` (unverified: nothing exercises a full `npm run worker` run in CI; the demo scripts under `scripts/` were not read for this note).

## Gotchas, TODOs, spec deviations

Spec deviations (inferred from code vs. docs/SPEC.md section 11 unless noted):
- MCP config path: spec `.contract/mcp.json`, code `.contract/mcp/<agentId>.json` (index.ts:159).
- Hook config: spec says write `.claude/settings.json` into each worktree. Code passes `--settings agents/worker/hook-settings.json` (index.ts:171) and never writes into the worktree.
- Task text: spec shows `claude -p "<task text>"`. Code sends it on stdin (claude-code.ts:132).
- Hooks: spec lists one PostToolUse hook. Code also has the PreToolUse guard, the Read/Bash summary hook, and the Stop hook. These come from the two addition docs, which mark them as built.
- `tokenBudget` is hard-coded to 200 000 (agents/worker/src/index.ts:110, packages/mcp/src/index.ts:309).
- `--engine nemotron` is not built. `runWorker` throws (nemotron.ts:137).

Gotchas:
- `claim()` throws after the fact. The reducer records a conflict even when the claim loses (index.ts:362-368). Anything that reads conflicts will see a losing claim.
- The guard-rail discard runs `git checkout -- .` and `git clean -fd` in the agent's worktree (agents/worker/src/index.ts:291-292). This removes uncommitted work in that worktree only.
- The session push uses `--force` (index.ts:310).
- `COORDINATOR_PROVIDER` (`.env.example:7`) is real: it overrides `LLM_PROVIDER` for the coordinator only (`agents/coordinator/src/provider.ts:8`). Workers use `LLM_PROVIDER` (packages/llm/src/index.ts:14).
- `parseJson` is duplicated: claude-code.ts:194 (fence or raw only) and nemotron.ts:155 (also tries the first-to-last brace span). Claude's `decide` only uses it when `structured_output` is absent.
- `decide()` for Claude Code runs in `process.cwd()`, not the agent worktree (claude-code.ts:157). Harmless today; note if decide ever needs repo files.
- `watch.ts` and `claim-guard.ts` import `repoFile` from `summary-hook.ts`, so the summary hook is a shared dependency. Renaming there breaks both.
- Joined editor (`npm run join`) rules and hooks: `joinedRules` in rules.ts:29 expects the editor's hooks to be set up elsewhere. That setup was not read (unverified).
- Default models `claude-sonnet-5-5` and `claude-opus-5-5` are env-overridable. Confirm they exist for the local Claude Code login before a demo (unverified).
