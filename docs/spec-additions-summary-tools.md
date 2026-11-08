# Spec additions: summary-cache tools and worker rules

Proposed changes to section 11, written so Tyler can paste each block into place. Already built in `packages/mcp` and `agents/worker`.

**Why:** section 10 gives the client `getSummary(file)` / `putSummary(file, summary, tokens)` and a shared `summary_cache` keyed by content hash, and section 15 counts a `cache_hit` saving. But the seven MCP tools in section 11 don't expose either call, so a Claude Code worker can never read or fill the cache, and `cache_hit` stays at zero in real runs. Two MCP tools fix that: one to read the cache, one to write it.

---

## A. Two new MCP tools (section 11)

| Tool | Arguments | Wraps | Returns |
| --- | --- | --- | --- |
| `get_summary` | `file` (path relative to the working directory, i.e. demo-repo) | `contract.getSummary(file)` | `{ file, summary }` on a hit. On a miss: a hint to read the file, then call `put_summary` |
| `put_summary` | `file`, `summary` (2-5 lines) | `contract.putSummary(file, summary, estimateTokens(summary))` | `cached summary of <file>`; a tool error if the file can't be read |

**Flow:** agent A calls `get_summary` and misses, reads the file, then calls `put_summary`. Agent B later calls `get_summary` on the same, unchanged file and gets a hit. The client calls `record_cache_hit` and logs a `cache_hit` saving equal to the file's tokens minus the summary's tokens. Editing the file changes its content hash, so stale summaries miss on their own.

A cached summary also shows up in `get_context` answers: each symbol carries its file's summary when one is cached.

### Replacement text (section 10, end of the client block, and section 11, tool list; both places)

> Contract MCP tools (`packages/mcp`, wrapping the client): `declare_plan`, `claim_symbol`, `release_claim`, `report_change`, `get_context`, `find_existing`, `get_instructions`, `get_summary`, `put_summary`.

## B. Contract rules as an ordered workflow (section 11)

The current rules list the tools but don't say how symbol ids are formed or what to call first, so the model wastes calls guessing ids or reads whole files. Replacement paragraph (the exact text is `CONTRACT_RULES` in `agents/worker/src/rules.ts`):

> Contract rules (appended to the system prompt): symbol ids are `"<file>#<name>"` or `"<file>#Class.method"`, with the file relative to the working directory (demo-repo); look up unknown ids with `find_existing` instead of guessing. Workflow: (1) orient with `get_context` on the functions the task names; call `get_summary` before reading a file, and `put_summary` after reading one whole. (2) Call `find_existing` before writing any new helper and reuse a match with score >= 0.8. (3) `declare_plan` with every function you'll modify, create or depend on. (4) Claim before modifying; if the claim fails, don't edit, call `get_instructions`. (5) After changing a function's signature or behavior, call `report_change`; release claims when done. (6) Check `get_instructions` after each step and follow the coordinator's instructions.

A test (`packages/mcp/test/tools.test.ts`) checks that the rules name every MCP tool, so the two can't drift apart.

## C. Summary hook: fill and serve the cache automatically (section 11, next to "Automatic change reporting")

**Why:** in test runs (Haiku, demo-repo tasks 1 and 2), workers never called `get_summary` or `put_summary` on their own: not from the rules, and not when a hook told them to after each read. They `cat` or `Read` every file first. So the cache has to work without the model's help.

**What:** `agents/worker/src/summary-hook.ts`, a `PreToolUse` hook on `Read|Bash` in `agents/worker/hook-settings.json`:

| Event | What the hook does |
| --- | --- |
| First whole-file `Read` of a source file in a session, summary cached | Denies the read and passes the summary to the model instead (`getSummary` records the hit and logs the `cache_hit` saving). A second `Read` of that file is allowed, e.g. before editing it |
| First whole-file `Read`, no summary | Allows the read and caches an outline of the file with `putSummary`: header comment, each export's signature and doc comment, small interface/type bodies. No model call. Skipped when the file has no exports or the outline wouldn't be at least 30% smaller |
| `Bash` running `cat` on source files | Denied with "use the Read tool", so reads go through the hook |
| Any later `Read` of a file that was served a summary (whole or partial) | Allowed, and the file is marked "re-read": the summary wasn't enough |
| `Stop` (end of each run, including resumed runs) | Counts a cache hit (`record_cache_hit` + `cache_hit` saving) for each served file that wasn't re-read, once per file |

Serving looks the summary up with `getSummary(file, { countHit: false })`; the hit is only counted at `Stop`, once the hook knows the model worked from the summary. A run killed before `Stop` counts nothing (it undercounts rather than overcounts). Reads through other Bash commands (`head`, `sed -n`, `grep`) aren't tracked.

Partial reads (`offset`/`limit`) and files outside the working directory, in `node_modules`, or not `.ts/.js` are left alone. Per-session "already read" markers are one file each under the OS temp dir, so parallel reads don't race. The hook always exits 0.

**Measured** (Haiku, task 1 then task 2): agent-a's reads cached 3 outlines. Agent-b was served all 3, later re-read `checkout.ts`, and worked from the other two, so 2 cache hits were counted (`invoice.ts` 142 + `tests/fixtures.ts` 107 tokens) and `checkout.ts` was not.
