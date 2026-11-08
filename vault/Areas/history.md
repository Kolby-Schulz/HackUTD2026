---
title: GitHub history
area: history
sources: [GitHub issues, GitHub PRs, git log]
verified: 87debe9
---
Summary: 25 PRs (24 merged, #44 open) and 19 issues (13 closed, 6 open), all merged 2026-11-08 between 01:15 and 08:12 UTC. The MVP, two-laptop, any-agent, replay, benchmark and Nemotron coordinator work has landed. Open work is the submission package, hosting, Jev triage, per-role model choice, and a coordinator duplicate fix (#44).

## Timeline

### Server (SpacetimeDB module)
- #1 Backend: SpacetimeDB module, conflict rules, bindings, tests — 15 tables, Rules 1-3, accounting reducers
- #3 Scoreboard cost — cost_usd and cache_read_tokens on token_usage; scoreboard shows cost and cached share
- #4 MCP server, worker end-of-run — mark_conflict_resolving reducer (coordinator only)
- #6 Shared cloud database — contract-hackutd26 on maincloud, publish:cloud script
- #30 upsert_symbols keeps agent-reported signature and behavior_note — fixes mapper overwrite race (#25)
- #32 Operator messages — send_instruction, agent_id '*' broadcast to working/paused workers
- #33 Live code view — file_edit table, report_edit, claim guard (spec additions A and C)
- #36 Service lock and reconnect — claim_service, holdService runs unlocked with a warning on old servers

### Agents and packages (client, MCP, worker, join)
- #2 Client connect() and every ContractClient method, with live tests
- #8 Summary cache reachable from workers — get_summary / put_summary MCP tools; worker permission fixes
- #10 MCP live stdio tests; fixes two flaky server live tests
- #31 Two-laptop demo — worker --prompt, session start and merge, dashboard New task form
- #34 Bring your own repo — --repo or CONTRACT_TARGET; unset means demo-repo/
- #37 Any coding agent joins — npm run join for Claude Code, Cursor, Codex via the MCP server
- #38 Live judge task — judge agent loop with guard rails (also listed under dashboard)
- #41 MCP live test expects Rule 2 reuse hint for pre-existing code

### Coordinator and mapper
- #7 Mapper — ts-morph code mapper, server sync, watch mode, mapFile for the hook
- #12 MVP coordination — coordinator live loop, contract-hook, plan signatures, run reset
- #43 Nemotron as coordinator — NemotronLLM provider, COORDINATOR_PROVIDER switch, workers stay on Claude Code
- #44 (open) Coordinator reuses first ruling for mirror and repeat duplicates

### Demo repo
- #5 demo-repo — billing app with both planted conflicts (spec section 14)

### Dashboard and scripts
- #8 Dashboard pages — Live, Activity, Tokens, Scoreboard tabs on live tables
- #9 Scripts — seed, reset (clears agent/* and demo/* worktrees), run-demo for the with/without experiment
- #39 Run replay — replayAt() scrubs the run timeline on the dashboard
- #40 Benchmark suite — 5 scenarios x modes x runs behind the savings claim
- #42 Dashboard bundle split (same PR as the Rule 1 test fix)

### Docs
- No docs-only PRs. Spec and task-list edits rode in with #1, #3 and #33, and direct commits on main (407a957, 51d378a, 80ff3f6) carried the initial scaffold and live-code spec additions.

## Closed issues
- #11 Message running agents from the dashboard — resolved by PR #32
- #13 Rehearse with_contract clean run — closed 04:36Z, no closing PR recorded
- #14 without_contract baseline for scoreboard — closed 04:36Z, no closing PR recorded
- #15 Shared helper not visible across worktrees — closed 04:36Z, no closing PR recorded
- #16 Dashboard layout overlap at 900-1180px — closed 04:36Z, no closing PR recorded (polish left in #17)
- #18 Bring your own repo — resolved by PR #34
- #19 Agents on separate laptops — resolved by PR #36
- #22 Any coding agent can join — resolved by PR #37
- #24 Live code view and claim guard — resolved by PR #33
- #25 upsert_symbols keeps agent fields — resolved by PR #30
- #27 Run replay — resolved by PR #39
- #28 Benchmark suite — resolved by PR #40
- #29 Live judge task — resolved by PR #38

Note: #13-#16 were closed together at 04:36Z, right after MVP #12 merged at 04:30Z. Treat them as closed by the MVP push; confirm on the issues if it matters for the record.

## OPEN: live work list
- PR #44 (open, Et43vy, branch fix/coordinator-mirror-duplicates) — coordinator reuses the first ruling for mirror and repeat duplicates. Found in two-laptop maincloud run 1, where Nemotron's coordinator opened a duplicate conflict each way.
- #35 (enhancement) — model selection per role, pick provider and model per role and show the mix live. Pitch: one run mixes vendors.
- #26 (no label, no owner) — submission package: README, architecture diagram, 60-second quickstart, demo video, Devpost. Judges read the README first.
- #23 (stretch, spec 12b) — Jev triage: sub-second triage before the coordinator. TRIAGE=off by default.
- #21 (enhancement, NVIDIA track) — coordinator half shipped in #43. Still open: Nemotron workers and the with/without comparison on Nemotron.
- #20 (no label) — Host Contract: static public dashboard pointed at maincloud, always-on services, database ownership doc.
- #17 (no label) — dashboard UI polish for judges: check 1280, 1440 and projector widths after the #16 breakpoint fix.

## Decisions (UTC, 2026-11-08)
- 01:15 Backend is a SpacetimeDB module with Rules 1-3 as reducers, not a separate service (#1).
- 02:25 Scoreboard uses provider-reported cost and cached share, not raw tokens, because ~40k prompt tokens per turn are mostly cache reads (#3).
- 03:30 Shared Maincloud database contract-hackutd26 replaces LAN setup, so two laptops share one run (#6).
- 03:52 Summary cache is exposed as MCP tools so real worker runs hit it (#8).
- 04:30 Coordinator runs as a live loop; plan-time duplicates get a reuse hint when the match is pre-existing code, not a conflict (#12, later checked in #41).
- 05:47 Each person runs their own worker with --prompt against the shared DB (#31).
- 06:36 Operator '*' broadcast reaches only working or paused workers, never the coordinator or mapper (#32, closes #11).
- 06:44 Claim guard blocks an agent from editing a symbol another agent has claimed (#33, closes #24).
- 06:52 Target repo is --repo or CONTRACT_TARGET; unset keeps demo-repo/ (#34, closes #18).
- 07:09 Two-laptop join warns that localhost is one-laptop only, and service lock with reconnect (#36, closes #19).
- 07:19 Any MCP-capable client joins through npm run join, not just our worker script (#37, closes #22).
- 07:25 Judge task box is capped at 300 characters and goes through create_task for agent-judge (#38, closes #29).
- 08:12 Coordinator runs on Nemotron via COORDINATOR_PROVIDER=nemotron, workers stay on Claude Code (#43, partial #21).
- Open: #35 proposes per-role provider choice; #44 proposes reuse of the first ruling for mirror duplicates.

## Recurring problems and pitfalls
- Flaky live tests: cross-client cache lag in server live tests (#10, commit 6327963). The Rule 1 test matched the empty reply "No new instructions. Continue your task." because it contains "instructions" (#42). Match exact text, not keywords.
- Test drift after behavior change: once Rule 2 started sending hints, the live test still expected a duplicate conflict (#41).
- Stale state between runs: after reset, the scoreboard showed 0 without_contract runs (#14), and a rehearsal needed the latest reset fixes (#13). Always reset before a comparison run.
- Mapper push races agent reports: a mapper upsert within milliseconds of report_change restored old signature text (#25, fixed in #30).
- Shared helpers not in the worktree: the coordinator told agent-a to import agent-b's helper, which only exists after merge (#15). Closed without a recorded fix; watch for it in the demo.
- Mirrored rulings open two conflicts: the same duplicate was opened from each side during two-laptop run 1 (#44, open).
- Layout breakpoints: the Live tab broke between 900 and 1180px (#16). Polish remains in #17.
- Env loading: all packages were changed to load the root .env (8623116), and the dashboard reads SPACETIME_HOST from it (4a4cc0e).
- Dashboard bundle size: split into separate chunks in #42 after the bundle grew.
