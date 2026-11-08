# Nemotron as the coordinator: implementation, tests, hosting

Goal: the coordinator (spec section 12) makes its conflict decisions with NVIDIA Nemotron
instead of Claude Code, the decisions land in SpacetimeDB like today, and we can prove it
both locally and on the shared maincloud database. Workers stay on Claude Code for now.

Status at time of writing (main @ 0f090e8):

- Nemotron key works: `nvidia/nemotron-3.5-lightning-30b-a3b` answered a test call from
  Kolby's laptop through `https://integrate.api.nvidia.com/v1`.
- It is a reasoning model: the reply has `reasoning_content` (thinking) and `content` (answer).
  With `max_tokens: 20` all tokens went to thinking and `content` was `null`
  (`finish_reason: "length"`). With 500 it answered (117 completion tokens, 99 of them reasoning).
- `packages/llm/src/index.ts` throws for any provider other than `claude-code`.
- `openai` is already a dependency of `@contract/llm`; `.env.example` already has
  `NVIDIA_API_KEY` and `NVIDIA_BASE_URL`.
- The coordinator only calls `llm.decide()` (`agents/coordinator/src/decide.ts`). It already
  validates, retries once and falls back to "first claimant owns it", so a bad model answer
  never leaves workers paused.

---

## 1. Implementation

### Step 1: `nemotron` provider in `packages/llm` (owner: agents)

New file `packages/llm/src/nemotron.ts`, class `NemotronLLM implements LLM`.

`decide(prompt, jsonSchema, opts)`:

1. `new OpenAI({ apiKey: NVIDIA_API_KEY, baseURL: NVIDIA_BASE_URL })`.
2. `chat.completions.create` with
   - `model`: `opts.model ?? NVIDIA_COORDINATOR_MODEL ?? 'nvidia/nemotron-3.5-lightning-30b-a3b'`
   - `messages`: optional `opts.system`, then the prompt plus the JSON schema text and
     "Reply with one JSON object only, no prose, no code fences."
   - `response_format: { type: 'json_schema', json_schema: { name: 'decision', schema, strict: true } }`.
     **Verify first** that build.nvidia.com honours this for Lightning (one curl). If it is
     rejected, drop it and rely on the prompt + parsing below.
   - `max_tokens`: `NVIDIA_MAX_TOKENS ?? 4096` (thinking eats most of it; 20 was not enough
     for "say hi").
   - `temperature: 0` for repeatable demo decisions.
   - `signal: opts.signal` for early stop.
3. Read `choices[0].message.content` only, never `reasoning_content`.
   - `finish_reason === 'length'` or empty content: throw `NemotronError('ran out of tokens')`
     so `decideConflict` retries, then falls back.
   - Parse JSON: try `JSON.parse`; if that fails, strip ```` ``` ```` fences / take the first
     `{ ... }` block and parse again; if that fails, throw.
4. Map usage to our `Usage` and call `opts.onUsage`:
   - `prompt_tokens` = `usage.prompt_tokens`
   - `completion_tokens` = `usage.completion_tokens` (already includes reasoning tokens)
   - `cache_read_tokens` = `usage.prompt_tokens_details?.cached_tokens ?? 0`
   - `cost_usd` = tokens x `NVIDIA_PRICE_IN_PER_M` / `NVIDIA_PRICE_OUT_PER_M` (default 0:
     the hackathon tier is free; set prices if we want a comparable cost column).
5. Aborted request: throw `LLMAbortError(undefined, usageSoFar)` like the Claude provider.

`runWorker()`: throw `Error('nemotron runWorker is phase 2 (--engine nemotron), not built yet')`.

`packages/llm/src/index.ts`: `if (provider === 'nemotron') return new NemotronLLM();` and
export it.

### Step 2: let the coordinator pick its own provider (owner: coordinator + mapper)

Today `createLLM()` reads one global `LLM_PROVIDER`. Setting it to `nemotron` would also
switch workers, whose `runWorker` doesn't exist on Nemotron yet. So:

- `agents/coordinator/src/index.ts`: `createLLM(process.env.COORDINATOR_PROVIDER ?? process.env.LLM_PROVIDER)`.
- `agents/coordinator/src/live.ts`: the agent row is registered with `model: 'claude-code'`
  hard-coded. Set it to the real model, e.g. `nemotron:nvidia/nemotron-3.5-lightning-30b-a3b`.
  This is our **proof in the database** that Nemotron is the coordinator (the `agent` table
  already has a `model` column, so no schema change).
- Log the provider and model in the startup line and in each `conflict N resolved by model` line.

### Step 3: config

Add to `.env.example` (no secrets):

```
# Coordinator provider, independent of the workers' LLM_PROVIDER
COORDINATOR_PROVIDER=nemotron
NVIDIA_COORDINATOR_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
# NVIDIA_COORDINATOR_MODEL=nvidia/nemotron-3-ultra-550b-a55b   # stronger, slower; confirm slug
NVIDIA_MAX_TOKENS=4096
NVIDIA_PRICE_IN_PER_M=0
NVIDIA_PRICE_OUT_PER_M=0
```

Separate `NVIDIA_*_MODEL` names so `COORDINATOR_MODEL=claude-opus-5-5` doesn't get sent to NVIDIA.

### Step 4 (optional): dashboard shows who decided (owner: dashboard)

Show the coordinator agent's `model` next to each decision ("decided by Nemotron 3.5
Lightning"). Read-only, no server change.

### Not changing

`server/` (tables, reducers), `packages/client`, `packages/mcp`, the workers. If we later
want a per-decision `source`/`model` column on `decision`, that is a schema change: ask
first (CLAUDE.md rule).

---

## 2. Tests

Four layers, cheapest first. Layers 1 and 3 run in CI-like `npm test` without a key; 2 and 4
need `NVIDIA_API_KEY`.

### Layer 1: unit tests, no network (`packages/llm/test/nemotron.test.ts`)

Mock the OpenAI client (inject it through the constructor). Add `packages/llm` to the
`projects` list in the root `vitest.config.ts` and give it a `vitest.config.ts`.

| Case | Expect |
| --- | --- |
| `content` is valid JSON, `reasoning_content` present | output = parsed `content`; reasoning ignored |
| `content` wrapped in a code fence / with prose around it | still parsed |
| `content: null`, `finish_reason: 'length'` (our real first curl) | throws, so the coordinator retries |
| `content` not JSON at all | throws |
| usage `{prompt 18, completion 117, reasoning 99}` | `Usage` = 18 / 117 / cache 0 / cost 0, `onUsage` called once with purpose `coordination` |
| prices set in env | `cost_usd` computed correctly |
| `signal` aborted | `LLMAbortError` |
| missing `NVIDIA_API_KEY` | clear error at construction, not a 401 later |
| `createLLM('nemotron')` | returns `NemotronLLM`; `runWorker` throws the "phase 2" error |

Coordinator unit test (`agents/coordinator/test/`): `createLLM` gets `COORDINATOR_PROVIDER`
over `LLM_PROVIDER`; agent row `model` reflects the provider.

### Layer 2: real Nemotron, no database (`agents/coordinator/test/nemotron.live.test.ts`)

Skipped unless `NVIDIA_API_KEY` is set. Uses the two planted conflicts that
`npm run coordinator -- --demo` already defines (move the two `ConflictContext`s into a
shared `fixtures.ts`).

- `broken_dependency` on `calculateFee`: `source === 'model'`, `owner_agent === 'agent-a'`,
  both instructions non-empty, B's instruction mentions not rounding again.
- `duplicate` `formatOrderDate` vs `formatDate`: `source === 'model'`, owner `agent-a`,
  B told to reuse `formatDate`.
- Run each 3 times; record pass rate, latency and tokens. Target: 3/3 `source: 'model'`
  (fallback counts as a fail here) and under ~20 s each. If Lightning misses, try Ultra.

Manual equivalent:

```bash
COORDINATOR_PROVIDER=nemotron npm run coordinator -- --demo
COORDINATOR_PROVIDER=nemotron npm run coordinator -- --demo duplicate
```

### Layer 3: coordinator + local SpacetimeDB (`agents/coordinator/test-live/`)

Same pattern as `server/test-live`: `spacetime start`, publish to the throwaway
`contract-livetest` database (wiped first, never touches `contract`), one client per
simulated laptop.

1. Register `agent-a` and `agent-b`, open a run, create both tasks, declare plans
   (agent-a modifies `calculateFee`, agent-b depends on it), agent-a reports a behavior
   change. The server opens a `broken_dependency` conflict and pauses agent-b.
2. Start `runLive(new NemotronLLM())` in-process.
3. Wait (timeout 60 s) and assert in the database:
   - `conflict.status` = `resolved` (or `dismissed`), `resolved_at` set
   - one `decision` row for that conflict, `owner_agent` in {agent-a, agent-b},
     both instructions non-empty
   - an `instruction` row for each agent; agent-b is no longer `paused`
   - a `token_usage` row with `agent_id = 'coordinator'`, `purpose = 'coordination'`,
     `prompt_tokens > 0`, `completion_tokens > 0`
   - `agent` row `coordinator` has `model` starting with `nemotron:`
   - `service` row `coordinator` held by this test's identity
4. Fallback case: run with a bad API key. Same assertions except no model tokens, the
   decision `reason` starts with `Fallback rule:`, and agent-b is still unpaused.
5. Double-handling: two conflicts back to back are handled once each (serial queue).

Run: `SPACETIME_HOST=ws://localhost:3000 npm run test:live -w @contract/coordinator`.

### Layer 4: shared maincloud database (manual smoke, before the demo)

Use a **separate** cloud database so tests never pollute the demo one:

```bash
npm run publish:cloud -w @contract/server            # publishes to contract-hackutd26
spacetime publish --module-path server --server maincloud contract-hackutd26-test
```

1. On one laptop: `.env` with `SPACETIME_HOST=wss://maincloud.spacetimedb.com`,
   `SPACETIME_DB_NAME=contract-hackutd26-test`, `COORDINATOR_PROVIDER=nemotron`;
   run `npm run coordinator`.
2. On the other laptop(s): `npm run demo -- --mode with_contract --runs 1`
   (workers on Claude Code, coordinator on Nemotron).
3. Check the cloud database directly:

```bash
spacetime sql --server maincloud contract-hackutd26-test "SELECT id, kind, status FROM conflict"
spacetime sql --server maincloud contract-hackutd26-test "SELECT * FROM decision"
spacetime sql --server maincloud contract-hackutd26-test "SELECT agent_id, purpose, prompt_tokens, completion_tokens FROM token_usage WHERE agent_id = 'coordinator'"
spacetime sql --server maincloud contract-hackutd26-test "SELECT id, model, machine FROM agent WHERE id = 'coordinator'"
```

4. Dashboard (Vercel or `npm run dashboard`) pointed at the same database shows the
   conflict turn resolved live and the coordinator's tokens on the scoreboard.
5. Pass = the planted conflicts resolved by the model (not the fallback), both tasks
   finish, merge checks pass. Then repeat once against `contract-hackutd26`, the demo DB.

---

## 3. Hosting

| Piece | Where it runs | Status |
| --- | --- | --- |
| SpacetimeDB module + data | SpacetimeDB **maincloud**, `contract-hackutd26` (`npm run publish:cloud -w @contract/server`) | Script exists. Confirm it's published with the latest module. |
| Dashboard | **Vercel**, static build of `dashboard/` | `vercel.json` exists but is **untracked**: commit it. Vercel env vars must point the dashboard at maincloud. |
| Coordinator | **A small always-on Node host** (Railway, Render background worker, or Fly.io), or one laptop | New. See below. |
| Workers, mapper | Laptops | They need git worktrees, the repo on disk and the Claude Code login. Stay local. |

Why the coordinator can move off a laptop now: with Claude Code it needed a logged-in
`claude` CLI on the machine. With Nemotron it only needs Node, an internet connection and
`NVIDIA_API_KEY`, so any Node host works.

Coordinator host setup:

- Start command: `npm ci && npm run coordinator`. Long-running process, no HTTP port
  (choose "background worker" / "worker" service type).
- Env vars in the host's dashboard, not in the repo: `NVIDIA_API_KEY`, `COORDINATOR_PROVIDER=nemotron`,
  `NVIDIA_COORDINATOR_MODEL`, `NVIDIA_MAX_TOKENS`, `SPACETIME_HOST=wss://maincloud.spacetimedb.com`,
  `SPACETIME_DB_NAME=contract-hackutd26`.
- Identity: the coordinator saves its SpacetimeDB token in `.contract/coordinator-tokens.json`.
  Hosts wipe the disk on redeploy, so it reconnects with a new identity and may be rejected
  for ~60 s until the old heartbeat goes stale (issue #19 lock). Fix: read the token from a
  `COORDINATOR_TOKEN` env var when set (small change in `live.ts`), or attach a volume.
- Only one coordinator per database (the `service` lock). Don't also run one on a laptop
  against the same database, or one of them exits.
- Rate limits: one NVIDIA key is shared by everything on that host. Coordinator traffic is
  a few calls per run, well under the free tier's limit.

Fallback if hosting eats time: run the coordinator on one laptop against maincloud. The
demo works the same; hosting only removes the "that laptop must stay on" dependency.

---

## 4. Order of work and owners

1. Agents owner: Step 1 + Layer 1 tests. (~1-1.5 h)
2. Coordinator owner: Step 2 + Step 3 + Layer 2. (~1 h, can start once Step 1's `decide()` exists)
3. Coordinator owner: Layer 3 live DB test. (~1 h)
4. Everyone: Layer 4 maincloud smoke. (~30 min)
5. Dashboard + demo owner: commit `vercel.json`, deploy dashboard, optional Step 4. (~30 min)
6. Coordinator host + `COORDINATOR_TOKEN`. (~45 min, optional)
7. Phase 2 (optional, NVIDIA track bonus): `--engine nemotron` workers (TASKS.md line 76).

## 5. Open questions

- Does build.nvidia.com accept `response_format: json_schema` for Lightning? (one curl)
- Lightning or Ultra for the coordinator? Decide from Layer 2 pass rate and latency.
- Does the NVIDIA track require a specific Nemotron model, or Nemotron workers too?
- Free tier: rate-limited or credit-based for our accounts? (ask the NVIDIA table)

---

## 6. Results (branch `feat/nemotron-coordinator`)

Built: Steps 1–3 and test Layers 1–3. Not yet: Step 4 (dashboard label), Layer 4
(maincloud smoke), hosting.

| What | Command | Result |
| --- | --- | --- |
| Layer 1, provider unit tests | `npm test -w @contract/llm` | 16/16 |
| Coordinator unit tests | `npm test -w @contract/coordinator` | 15/15 |
| Layer 2, real Nemotron, 3 runs x 2 planted conflicts | `npm run test:nemotron -w @contract/coordinator` | Lightning 6/6 (~1 s each), Ultra 6/6 (~2 s each) |
| Layer 3, real coordinator process + local SpacetimeDB | `npm run test:live -w @contract/coordinator` | 2/2 (model path + fallback path) |
| Whole repo | `npx vitest run` | 385/385 |

Findings that changed the design:

- `response_format: json_schema` works on build.nvidia.com for Lightning and Ultra.
- Thinking off (`chat_template_kwargs.enable_thinking: false`) cut a decision from ~16 s /
  ~1.6k tokens to under 1 s / ~60–120 tokens. Thinking on was 12–56 s and still got the
  duplicate wrong once, so it's off by default (`NVIDIA_THINKING=on` to enable).
- Before a prompt fix, Lightning, Ultra and Lightning-with-thinking all gave the planted
  duplicate to agent-b: the prompt asked "who owns formatOrderDate" (B's symbol) with
  nothing saying A's formatter came first. `buildPrompt` now adds a hint for `duplicate`
  conflicts (agent A came first, B reuses A's function). This also applies to the
  Claude provider.
- Lightning sometimes put made-up code in its instructions, e.g. telling agent-a to round
  with `Math.floor((amountCents + 5) / 10) * 10` (wrong). The prompt now asks for "what,
  not how: no code, formulas or snippets", and the Layer 2 test fails on code-like text.
  After the fix: 10/10 clean decisions over 5 runs per conflict, ~1 s each.
- `nvidia/nemotron-3-super-120b-a12b` returns 404 for our account (not enabled); the
  coordinator fell back to the rule as designed.
- The coordinator's `agent.model` row now reads e.g.
  `nemotron:nvidia/nemotron-3.5-lightning-30b-a3b`: the database record of who decides.

Merge note: the in-progress issue #19 work (service lock, `holdService`) also edits
`agents/coordinator/src/live.ts`. This branch only changes three lines there (the
`runLive` signature, the agent `model`, `COORDINATOR_TOKEN`), so the merge should be
small. After both land, re-run `npm run test:live -w @contract/coordinator`: its fallback
test restarts the coordinator with the same identity, which the lock must allow.
