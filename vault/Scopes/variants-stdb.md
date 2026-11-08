---
title: Variants on SpacetimeDB (PR V design)
area: dashboard, agents
sources: [vault/Scopes/integration-plan.md, dashboard/src/variants/, dashboard/vite-variants.ts, server/src/index.ts]
verified: 7b160fc
---
Summary: How `#/variants` moves from `lineage.json` + a Vite dev plugin to the PR S tables, and how a Node
variant agent generates variants from queued jobs. Git keeps the code; SpacetimeDB keeps everything else.
Written against the PR S contract (types only) before its bindings land.

# Variants on SpacetimeDB

## Split of truth
| What | Where | Written by |
|---|---|---|
| Variant code (`designs/<screen>/<id>/index.tsx`) | git | the variant agent (commit), or a person |
| Variant metadata, lineage, status, tokens | `variant` | `start_variant_job` / `finish_variant_job` |
| Generation requests | `variant_job` | the page (`queue_variant_job`), the agent (start/finish/fail) |
| Mixes | `variant_mix` (+ a `variant` row, kind `mix`) | the page (`save_variant_mix`) |
| Final pick, votes | `variant_pick`, `variant_vote` | the page |
| Folder leases | `design_claim` (kind `variant`) | the agent |

The page merges two sources into one graph: code nodes from `import.meta.glob` (as today) and DB rows. A
`variant` row with no code in this build renders as a placeholder ("generating", "failed: …", or "ready in
commit abc123, not in this build yet"). Code with no row is a hand-written variant and works as it does now.

## Page (dashboard/src/variants)
- `#/variants` renders inside the existing `SpacetimeDBProvider` with `data.ts`'s `connectionBuilder`. No new
  connection adapter and no shared net helper (told the board session).
- `store.ts` `useLineage()` becomes `useVariantsLive(screen)`: `useTable` on `variant`, `variant_job`,
  `variant_mix`, `variant_pick`, `variant_vote`, filtered by screen, mapped into the existing `Lineage` shape
  so `model.ts` and the UI keep working. Writes call reducers; errors show in the existing toast.
- Undo stays: undo of a pick re-picks the previous node (or clears); undo of a mix delete re-saves it.
- New UI, kept small: a **Generate** item in a node's ⋯ menu ("New child from this…" → brief dialog →
  `queue_variant_job`), a job chip in the status bar (queued / running by agent X / failed), and a vote count
  next to each node in the sidebar.
- Removed: `vite-variants.ts` and the plugin entry in `vite.config.ts`; the localStorage fallback; the scaffold
  button (the agent creates folders now; a person can still add a folder by hand). `lineage.json` goes away;
  the seed mix is re-created by a tiny seed script (`scripts/` owner) or by hand in the demo.
- Playground frames: PR V deletes the dormant localStorage bridge from #78 (`boards.ts`, `boards.test.ts`,
  `BoardView.tsx`, the import dialog). It reads a save format that PR B replaces, and its `describe.skipIf` tests are the two
  skipped tests on main today. If frames come back, they read `board_snapshot` plus `board_op` folded in `seq` order after PR B lands,
  using the `variant` columns asked for below.

## Variant agent (new folder `agents/variants/`)
One Node process, `npm run variants-agent`:
1. Connects with `@contract/client` `connect()`, calls `register_agent('variant-<host>', …)`, heartbeats.
2. Subscribes to `variant_job` where `status = 'queued'`. For each: `start_variant_job(job_id, agent_id,
   variant_id)` (a lost race throws; skip), then `claim_design('variant:<screen>/<id>', 'variant', screen,
   'replace', 600)`.
3. Builds the prompt from `screen.tsx` (slots + labels), the parent's resolved source, DESIGN.md tokens and the
   brief. Calls `llm.decide()` with purpose `design` and a JSON schema `{ title, note, slots: { [slot]: tsx },
   css }`. Nemotron runs in json_object mode; the output is validated in code (known slot ids, each value
   exports a component, no imports outside an allowlist) and retried once with the validation error.
4. Writes `designs/<screen>/<id>/index.tsx` (+ `.module.css`), runs `tsc --noEmit` on the dashboard project;
   on errors, one repair round through `decide()` with the compiler output.
5. Commits the folder on the agent's checkout branch (`git add designs/<screen>/<id> && git commit`), then
   `finish_variant_job(job_id, agent_id, commit, prompt_tokens, completion_tokens, cost_usd, duration_ms)`
   and `log_tokens(..., purpose 'design')` for every call (repairs included). Releases the claim.
6. Any failure: `fail_variant_job(job_id, agent_id, error)`, release the claim, nothing committed.

Where the code shows up: the host laptop's dev server picks the commit up by HMR; other laptops and the
Vercel build see it after a pull/push. The placeholder text says so, which is honest about git holding code.

## Contract notes for PR S (please settle before the schema freezes)
1. **Reducer signatures** (not in the plan yet), proposed:
   - `queue_variant_job(screen, parent, brief, model)`; `parent` empty = new root.
   - `start_variant_job(job_id: u64, agent_id, variant_id)`: queued → running, inserts the `variant` row
     (status `generating`, parent from the job, author = agent). Throws if not queued or the id exists.
   - `finish_variant_job(job_id, agent_id, commit, tokens: u64, cost_usd, duration_ms: u64)` → job `done`,
     variant `ready`. Caller must be the job's agent.
   - `fail_variant_job(job_id, agent_id, error)` → job `failed`, variant `failed`.
   - `save_variant_mix(id, screen, parent, slots_json)`: inserts `variant_mix` and a `variant` row (kind `mix`)
     in one transaction, so lineage lives in one table.
   - `pick_variant(screen, node_id)`; empty `node_id` clears the pick (needed for undo).
   - `vote_variant(screen, node_id)`; empty clears the caller's vote.
2. **Missing reducer**: `delete_variant_mix(id)` (author or operator): the page can delete mixes today.
3. **Who may write**: the page runs as an anonymous browser identity, not an operator. Proposed: picks, mixes
   and votes are open to any identity (recorded in `by`/`author`/`voter`); job start/finish/fail require a
   registered agent; `reset_variants` operator only.
4. **`log_tokens` keys**: it needs `run_id`, `task_id`, `attempt`. Proposed: `task_id = variant_job.id`,
   `attempt` = repair round, `run_id` = the open run or 0. Please confirm the dashboard doesn't join
   `token_usage.task_id` to `task` without checking purpose, or job ids will collide with task ids.
5. **`design` purpose in two places**: the server's `PURPOSES` list and the `Purpose` union in
   `packages/llm/src/types.ts` (shared package; agents owner).
6. **Playground frames as variants** (optional, but only possible before the freeze): `variant.board_id` and
   `variant.frame_id` (both `option<string>`) plus kind `frame`, so a board frame can sit in the lineage.
   If you'd rather not, frames stay out of variants and nothing else changes.
7. **New folder**: `agents/variants/` for the agent (not in the ownership table yet).
