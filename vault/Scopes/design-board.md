---
title: Design board on SpacetimeDB
area: dashboard
sources: [dashboard/src/playground/core/, docs/playground/REQUIREMENTS.md, server/src/index.ts, dashboard/src/data.ts]
verified: bcc1458
---
Summary: How to put the `#/playground` board (plan: [[playground-plan]]) on SpacetimeDB so many browsers and agent
processes share one canvas, and every wiring failure we can foresee with its fix. It builds on decisions D1-D10; it does
not replace them. Proposal only: the new tables need the server owner's OK, and nothing here is built.

# Design board on SpacetimeDB

## Why it fits
The board was designed for this (REQUIREMENTS §5):
- D3: every change is an `OpEnvelope {opId: actor:seq, actor, lamport, tx, body}`. `applyOp` is pure, idempotent on
  `opId`, and merges per field by last-writer-wins on `(lamport, actor)`. Deletes are tombstones. The store already has
  `applyRemote(envs)` and `log(from)` (`core/types.ts:66`).
- D4: presence (cursors, selection, locks, claims) is a separate bus, not part of the document.
- D8: claims echo Contract's `claim` / `conflict` tables.

So **SpacetimeDB is a relay for the op log and presence, not the document engine.** The server stores and orders ops and
checks who sent them. Every client folds them with the same `applyOp`. The server never computes shape state.

## Proposed tables (new, `board_` prefix; no spec'd names change)
| Table | Key | Holds |
|---|---|---|
| `board_actor` | `actor` | identity, board_id, kind, name, color, last_seen. Binds an actor id to one identity |
| `board_op` | `op_id` (`actor:seq`) | board_id (btree), actor, lamport, tx, body (JSON string), committed_at |
| `board_presence` | `actor` | board_id, cursor x/y, target tx/ty + move_ms, selection, lock ids, status, typing, updated_at |
| `board_claim` | `target` (shape, frame or rect id) | board_id, actor, expires_at, contention count |
| `board_snapshot` | `board_id` | doc JSON, upto_lamport, actor seqs (written by the host, see 13) |
| `board_thread` / `board_pin` | autoInc | chat messages and comment pins (today in localStorage `extras`) |

Reducers: `join_board`, `leave_board`, `push_ops(board_id, envs[])`, `set_presence`, `claim_target`, `release_target`,
`write_snapshot`, `post_message`, `add_pin` / `resolve_pin`, `reset_board` (operator only), and a scheduled sweep.

## Data flow
```
human UI / scripted agent / LLM bridge
   └─ board.exec / gesture ─▶ local store (instant) ─▶ outbox ─▶ push_ops ─▶ board_op
                                                                              │ subscription
every client ◀── applyRemote(sorted envs) ◀───────────────────────────────────┘
presence bus ─▶ throttled set_presence ─▶ board_presence ─▶ cursor painter tweens
```

## Failure modes and fixes (★ = bug that exists in today's code)

### Identity and op ids
1. ★ **Every human is `human-you`.** Actor ids are `${kind}-${short}` and every browser is `human-you`. Two humans
   would make the same op ids (`human-you:7`), and idempotency would **silently drop** the second human's edits.
   Fix: derive `short` from the SpacetimeDB identity plus a tab suffix. `join_board` binds actor→identity in
   `board_actor`, and `push_ops` rejects envelopes whose actor isn't the caller's.
2. ★ **Two tabs share one identity.** The dashboard keeps one token in localStorage (`data.ts:19-27`), so tabs share an
   identity, and the persisted seqs (`ids.ts` restoreSeqs) race. Fix: a per-tab actor suffix in sessionStorage. Then
   `push_ops` treats a known `op_id` with a different body as an error (log and alert), not a silent skip.
3. **Spoofed or forged ops.** Validate in `push_ops`: actor matches the caller, `op.t` is known, body ≤ 8 KB, and at most
   100 envelopes per call. Lamport must be ≤ the board max + 10,000, so a runaway clock can't pin every field forever.

### Ordering
4. ★ **`set` / `place` / `remove` on an unknown id are dropped for good** (`ops.ts` set and place cases). Live
   subscription updates arrive in commit order, which is causal, but the **initial snapshot's row order is not
   guaranteed**. Fix: sort the initial batch by `(lamport, actor)` before `applyRemote`. Lamport order respects
   causality as long as clients bump their clock on receive (5). Also hold any op whose target is missing in a small
   pending buffer, and retry it when that create arrives.
5. **Clocks must advance on receive.** Each client must set `lamport = max(local, seen) + 1` for every remote envelope,
   or its next edit loses LWW to an op it has already seen. Add a test.
6. ★ **The `board` op has no stamps** (`ops.ts` board case: "arrival order"). Concurrent renames diverge between
   clients. Fix: stamp meta fields like shape props, or make meta server-owned through a reducer.
7. **Wall clock.** The envelope's `ts` field is client time: show it in the UI only, never use it for ordering or expiry. TTLs use the
   server's `ctx.timestamp`.

### Traffic
8. **Gesture frames.** A drag folds per-frame sets inside an open transaction (commit bcc1458). Send **only committed
   transactions** to `push_ops`, and stream the live preview through presence. Otherwise one drag is about 60 ops/s per user.
9. **Cursors.** Agents publish intents (target + duration), and the cursor painter (`presence/cursors.ts`) tweens them.
   Humans throttle to about 15 Hz and skip moves under 2 px. One `board_presence` row per actor, updated in place.
10. **Typing bursts.** One op per committed burst, not per key. Agents send the full string; reveal it locally.
11. **Big pastes and templates.** Chunk to ≤ 100 envelopes per call, all with the same `tx` so undo stays one entry.

### Who runs what
12. ★ **Scripted agents would run once per viewer.** `agents/runtime.ts` (planned, WP-10) runs in the browser, so 5 viewers would mean
    5× every agent. Fix: one **host** runs agents, chosen with Contract's existing `service` lock
    (`claim_service('board-host', ...)`, stale after 30 s). The others only render. If the host dies, the lock frees
    and another tab or the bridge takes over.
13. **Op log growth and late joiners.** The host writes `board_snapshot` every N ops. Each client loads the snapshot,
    then ops with `lamport > upto`. The server deletes older ops. The SpacetimeDB module does not import `applyOp`
    (it stays out of `server/`).
14. ★ **Text re-measure writes from every client.** D10 has "the host re-measures and writes back". With N viewers,
    that's N writes, and different fonts on each machine would flap the value under LWW. Fix: only the author's client
    or the host writes the measurement back.
15. **LLM agents.** The Node bridge (`agents/llm.ts` seam, WP-83) joins as an actor with `@contract/client` and uses
    `push_ops` like anyone else. Model calls go through `packages/llm`, and tokens go to `log_tokens` (add a `design`
    purpose at `server/src/index.ts:41`, or log under `plan`).

### Locks and claims across the network
16. **Soft locks race.** Two actors can lock the same shape in the same instant. Locks stay presence-based (D4 says no
    lock op), so the worst case is a field LWW. That's acceptable, and humans win anyway (D8).
17. **Claims must be server-side to mean anything.** An agent-vs-agent claim checked only in each client's gate is
    advisory. Have `claim_target` be atomic and **throw** on contention (unlike `claim_symbol`, which returns
    quietly). `push_ops` rejects agent ops on a shape whose own id is claimed by another agent. Frame-level claims
    (where a child's parent is claimed) stay client-checked, because the server holds no tree.
18. **Stale claims and locks.** TTL from server time. A sweep every 5-10 s drops expired claims and presence older
    than 30 s. That covers a laptop that sleeps without ever disconnecting.

### Connection loss
19. ★ **No reconnect or disconnect handling today** (`data.ts` only logs connect errors). Fix: reconnect with backoff
    using the saved token, show a banner, and resubscribe. On resubscribe, ask for ops since the last lamport seen.
20. **Offline edits are safe to queue,** because ops are idempotent and merge by LWW: keep the outbox (capped at about
    2,000), and flush it in order on reconnect. Agents pause while offline, so they don't build on a stale view.
21. **Ghost actors.** Use a disconnect lifecycle reducer (check the SpacetimeDB TS docs for its syntax: the module only
    uses `init` today, `index.ts:544`) that clears presence and releases claims, backed by the sweep in 18.

### Safety, deployment and the demo
22. **Destructive calls.** `reset_board` and the snapshot write must check that the caller is the operator or the
    host. Don't copy `reset_demo_state`, which has no auth.
23. **Shared Maincloud database.** Adding tables is a safe republish. Changing a column later needs `--delete-data`,
    which also wipes the main demo. Freeze the `board_*` schema early, or publish the board to its own database name.
24. **Bindings drift.** After a schema change, run `npm run generate -w @contract/server` and commit the bindings with
    it.
25. **Fallback.** Keep localStorage persistence (D10) as the offline cache and as a **local mode**. With no connection
    in 3 s, or `?board=local`, run fully local with a badge. The demo must work with no network and no API keys.
26. **Public hosting (#20).** There is no built-in rate limit. Add a per-actor writes/sec check in `push_ops` and
    `set_presence`.

## Build order (after Wave 0 lands, so it doesn't churn frozen files)
1. Fix the ★ bugs that matter even locally: actor ids (1, 2), sort and buffer remote ops (4), stamps on the board op (6).
2. Server: `board_actor`, `board_op`, `push_ops` with validation, the lifecycle cleanup, and tests in
   `server/test/helpers.ts`.
3. Dashboard `net/` adapter: outbox, subscribe, sorted `applyRemote`, Lamport bump, reconnect, local-mode fallback.
4. Presence table and throttled cursors; host election through `service`.
5. Claims on the server, snapshots and compaction, then chat and pins.
6. LLM bridge (WP-83) as a remote actor.

## Ownership
Tables and reducers live in `server/` (the backend owner); the adapter, sync and fixes live in `dashboard/src/playground/`
(the board orchestrator; `core/types.ts` is frozen, so changes go through them); the bridge lives in `agents/`. Agree on
reducer names and the envelope wire format before building.
