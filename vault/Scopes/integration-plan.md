---
title: Integration plan: board and variants into main on SpacetimeDB
area: dashboard
sources: [server/src/index.ts, dashboard/src/playground/, dashboard/src/variants/, dashboard/vite-variants.ts]
verified: eead29e
---
Summary: The plan for landing the design board (`#/playground`) and the design comparison page (`#/variants`) in
`main`, with all multi-agent work going through SpacetimeDB (a track requirement: without it we're disqualified).
Git still holds code and commits. SpacetimeDB holds every agent action, live state and decision. The integration lead
owns this note; the two feature sessions build against the contract below.

# Integration plan

## Hard rules (both features)
1. **Every agent action reaches other clients only through SpacetimeDB reducers.** No in-memory-only agents, no
   per-viewer agent copies, no localStorage or JSON file as the shared source of truth. localStorage is allowed only
   as an offline cache or for local mode.
2. **Agents are SpacetimeDB clients with an identity.** Each board or variant agent links to a row in the existing
   `agent` table (`register_agent`), so the dashboard, the coordinator and the token logging see it like any worker.
3. **No dev-server-only paths in the product.** `vite-variants.ts` (`apply: 'serve'`) is not a backend: picks, mixes
   and jobs move to reducers. A Node agent process writes the variant code files and commits them through git.
4. **Clean code:** no `TODO: hack`, no disabled tests, no `as any` to get past bindings, no skipped checks. Each PR is
   green on `npm run typecheck`, the server unit tests, `cd dashboard && npx vitest run`, and a dashboard build.
   Tests that need a live server run against local SpacetimeDB (`spacetime start`), never against Maincloud.
5. **Schema in one pass:** additive only, and frozen before publishing to Maincloud. A column change later needs
   `--delete-data`, which would wipe the shared demo database.

## Landing order
1. **PR S (server contract), owned by the integration lead.** Adds the tables and reducers below to `server/` with
   unit tests in the in-process test setup, and regenerates `packages/client` bindings. Merge, then the DB owner (this host laptop, on the owner's go-ahead)
   publishes to Maincloud.
2. **PR B (board).** The board session consolidates its branches (`playground/features`, `playground/wiring`,
   `wire2/*`) into `feat/dashboard-playground`, lets the Wave 2-3 work packages already running merge, starts no new
   ones, merges `origin/main`, then builds the `net/` adapter and runs its agents over PR S.
3. **PR V (variants).** The variants session builds on `main` (its first PR, #78, is merged): moves picks, mixes and
   votes to PR S's reducers, replaces the Vite plugin, and adds the generation job runner as a Node agent.
4. **Integration check on `main`:** two browsers plus the agent processes against local SpacetimeDB, then Maincloud.
   The checklist is at the bottom.

PR B and PR V don't touch each other's folders. Both depend only on PR S's generated bindings.

## SpacetimeDB contract (PR S): names approved by the owner on 2026-11-08
All new tables are `public: true` unless marked. Ids are strings unless noted. Time values use `ctx.timestamp`.

### Shared
| Table | Key | Columns | Purpose |
|---|---|---|---|
| `design_claim` | `target` | kind (`board`/`variant`), scope id (board id or screen), holder actor, `agent_id` (option), intent (`replace`/`extend`), `expires_at`, contention count | Leases on a shape, frame or variant folder. Contention opens a Contract `conflict` (`claim_contention`) that the existing coordinator resolves |

Reducers: `claim_design(target, kind, scope, intent, ttl_secs)` (throws on contention), `renew_design_claim`,
`release_design_claim`. The existing scheduled `expire_claims` sweep also expires `design_claim` rows.

### Board
| Table | Key | Columns | Purpose |
|---|---|---|---|
| `board` | `id` | name, created_by, created_at, `next_seq` (u64), `snapshot_seq` (u64) | Board meta and the server sequence counter |
| `board_actor` | `actor` | board_id (btree), identity, kind (`human`/`agent`/`system`), name, color, `agent_id` (option), joined_at, last_seen | Binds an actor id to one identity |
| `board_op` | `op_id` (`actor:seq`) | board_id (btree), `seq` (u64, btree: server order), actor, tx, body (JSON), created_at | The op log. The server stamps `seq`, and clients fold ops in `seq` order |
| `board_presence` | `connection` (connection id) | board_id (btree), actor, selection (JSON), status, viewport (JSON), updated_at | Low-frequency presence, one row per connection, so two tabs don't overwrite each other |
| `board_cursor` | `event: true` | board_id, actor, x, y, target x/y, move_ms | Short-lived cursor intents (event table) |
| `board_snapshot` | `board_id` | upto_seq, doc (JSON), written_by, written_at | Lets late joiners skip old ops; older ops are deleted |

Reducers: `create_board`, `join_board(board_id, actor, kind, name, color, agent_id?)`, `leave_board`,
`push_ops(board_id, ops[])` (checks that the caller owns the actor; at most 100 ops and 8 KB per body; an existing
op id with the same body is skipped, with a different body it throws), `move_cursor`, `set_board_presence`,
`write_board_snapshot` (host or operator only), `reset_board` (operator only). `clientDisconnected` deletes that
connection's presence, and releases claims only when the identity has no other connection.

### Variants
| Table | Key | Columns | Purpose |
|---|---|---|---|
| `variant` | `id` (`screen/variant`) | screen (btree), parent, kind (`root`/`child`/`mix`), author agent id, model, status (`generating`/`ready`/`failed`), tokens, cost_usd, duration_ms, commit, created_at | Metadata and lineage. The code stays in git |
| `variant_job` | `id` (u64 autoInc) | screen, brief, model, parent, status (`queued`/`running`/`done`/`failed`), agent_id, variant_id, error, created_at | Generation work, which agents pick up through a subscription |
| `variant_mix` | `id` | screen (btree), slots (JSON slot→node map), author, created_at | Saved mixes |
| `variant_pick` | `screen` | node_id, by, at | Final pick for each screen |
| `variant_vote` | `id` (`screen:identity`) | screen (btree), node_id, voter, at | One vote per voter per screen |

Reducers: `queue_variant_job`, `start_variant_job` (agent claims a queued job; throws if another agent took it),
`finish_variant_job` (writes the `variant` row), `fail_variant_job`, `save_variant_mix`, `pick_variant`,
`vote_variant`, `reset_variants` (operator only). Tokens go through the existing `log_tokens`, with a new purpose
value `design`.

### Amendments (2026-11-08, from the board team, folded into PR S)
- `board_presence` is keyed by `presence_id` = `<connection hex>:<actor>`, with `connection` as a btree column, because one Node process hosts several agent actors on one connection. It also has `tool`, `detail` and `typing` columns.
- `board_cursor` has a `down` column. `board_actor` has `last_op_seq`, set by `push_ops`, so a client resumes its op counter after a reload or snapshot.
- New `board_message` table (chat and comment threads) with `post_board_message` and `resolve_board_thread`. Under rule 1, shared threads can't live in localStorage.
- `renew_design_claim(target, ttl_secs)`, `release_design_claim(target)`. The snapshot writer is the operator, or the owner of a `system` actor.
- Variants (from the variants team): exact job, mix, pick and vote signatures; `delete_variant_mix`; an empty node id clears a pick or vote; `variant.board_id` / `frame_id` and kind `frame`; `mark_attempt_wasted` skips `design` token rows (job ids would collide with task ids); `design` added to the `Purpose` union in `packages/llm`; `agents/variants/` belongs to the dashboard + demo owner.
- `claim_design` does **not** throw on contention: a throw would roll back the conflict row and contention count it records. Like `claim_symbol`, it returns, and the caller reads `design_claim` to see who holds the target. `design_claim` also stores `holder_identity`.
- `push_ops` skips an op that is missing from the log but at or below the actor's `last_op_seq`. It was accepted and then compacted by a snapshot, so a resend never applies it twice.
- Board agents run in one Node process (one identity; each agent is its own `agent` row), not in an elected tab.

## Integration checklist (before calling it done)
- [ ] Two browsers on one board: edits, cursors and presence sync. A late joiner sees the same board. Turning wifi off
      and on recovers with no lost edits (`withAutomaticReconnect` plus the outbox).
- [ ] Board agents run once in total, not once per viewer; each one appears as an `agent` row with a token count.
- [ ] Two agents contending for one target open a `conflict`, and the coordinator resolves it with an instruction
      the agent follows.
- [ ] Variants: queue a job from the page, and the Node agent generates the variant, commits it and marks it ready.
      Picks, mixes and votes sync across browsers. A production build (`vite build`) works with no Vite plugin.
- [ ] All checks green on the merged `main`; a dashboard bundle check; no new `any` casts or skipped tests.
- [ ] Maincloud publish by the DB owner, then a repeat of the two-browser check against Maincloud.
