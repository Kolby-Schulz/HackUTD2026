# Contract — rules for coding agents

Shared context for agents (status, decisions, pitfalls, per-part notes) lives in `vault/`. See "Shared vault" below.

The full build spec is in `docs/SPEC.md` (text of Tyler's PDF; the PDF wins for tables
and diagrams). The task list is `docs/TASKS.md`. Read your part's sections before coding.

## Ownership (stay in your folder)

| Folder | Owner | Spec sections |
| --- | --- | --- |
| `server/` | backend | 6, 7, 8 |
| `packages/client/`, `packages/mcp/`, `agents/worker/` | agents | 10, 11 |
| `packages/llm/` | shared (interface frozen; agents owner maintains) | 4, 12 |
| `mapper/`, `agents/coordinator/`, `demo-repo/`, `agents/triage/` (stretch) | coordinator + mapper | 9, 12, 12b, 14 |
| `dashboard/`, `scripts/` | dashboard + demo | 13, 15, 17 |

## Rules (spec section 18)

- You are building one part of Contract. Stay inside your folder; never edit another
  part's folder. Shared types come only from packages/client's generated bindings.
- Table names, column names, reducer names and arguments are fixed by the spec
  (sections 6, 7, 10). Do not rename them. If one must change, stop and ask the human.
- Use the official SpacetimeDB TypeScript docs for exact syntax. Do not invent APIs;
  if unsure, check the docs or ask.
- Reducers have no network or filesystem access. Anything calling a model or reading
  files runs in a Node process (agents, coordinator, mapper).
- Every model call (Claude Code now, Nemotron later) goes through packages/llm, so
  tokens are always logged and the provider can be swapped with LLM_PROVIDER.
- Jev triage is optional (TRIAGE=off by default). Everything must work without it.
- Build the MVP first (section 16). No stretch features until the MVP checklist passes.
- Prefer simple, readable code over abstractions. This is a 24-hour hackathon.
- Keep secrets in .env; never commit API keys. The repo will be public.
- After each change, run the part's tests and the end-to-end script if it exists.

## Shared vault (light touch: context, not a gate)

- **Start of a task:** read `vault/Status.md` and the `Summary:` line of your part's note in `vault/Areas/`
  (map in `vault/Home.md`). Read further only if the task needs it. Skip the vault for small, local fixes.
- **Code and spec win.** If a note disagrees with the code, trust the code and fix the note.
- **End of a task, same PR:** if you changed how your part works (a table, reducer, env var, script, or a new trap),
  update your part's Area note in a line or two and bump its `verified:` to the commit. Add a line to
  `vault/Pitfalls.md` or `vault/Decisions.md` only for something the next agent would trip on.
- **Never block on it.** Don't wait for, or ask someone to update, a note before coding. Don't write diaries or
  run logs into the vault. Keep notes short, and only edit your own part's Area note.
- **Bulk reading:** if your tool supports subagents, send wide repo or doc searches to a cheaper subagent and keep
  only its conclusion.

## packages/llm in practice

- `decide(prompt, jsonSchema, opts)` -> `{ output, usage }`: one structured answer, no tools.
- `runWorker(task, opts)` -> `{ sessionId, usage, text }`: a Claude Code run in `opts.cwd`
  (stream-json). Pass `signal` for early stop; an aborted run throws `LLMAbortError`
  and still reports estimated usage through `onUsage`. Resume with `resumeSessionId`.
- Usage: `{ prompt_tokens, completion_tokens, cost_usd, estimated? }`, from Claude Code's
  JSON (`usage.input_tokens` + cache tokens, `usage.output_tokens`, `total_cost_usd`).
- Calls ignore the user's personal MCP servers (`--strict-mcp-config`) so every laptop
  behaves the same and calls don't pay ~9k tokens of unrelated tool definitions.

## Conventions

- TypeScript everywhere, ES modules, run with `tsx` (no build step for Node parts).
- Workspace packages are imported by name (`@contract/client`, `@contract/llm`) and
  export their `src/index.ts` directly.
- `demo-repo/` is NOT an npm workspace; it has its own package.json and tests.
- Worker worktrees live in `.worktrees/<agent-id>` (gitignored); agents work in its `demo-repo/`.
