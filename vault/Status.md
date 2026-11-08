---
title: Status
area: map
sources: []
verified: 87debe9
---
Summary: Live project state as of 87debe9 (2026-11-08). MVP has landed; remaining work is submission, hosting, polish and stretch.

# Status

## Done (see [[history]])
- MVP, two-laptop shared Maincloud DB, any-agent join, replay, benchmark, Nemotron coordinator (#43), coordinator duplicate reuse (#44). 25 PRs merged.

## In flight (local, not on GitHub)
- Playground design board (`#/playground`, branch `feat/dashboard-playground`): board + agents committed (6ecef41), chat + comment tool uncommitted. Full plan in [[playground-plan]]: 411 features, 84 work packages. Wave 0 progress on `feat/dashboard-playground`: WP-01, 02, 03, 05, 06, 07, 09 merged and reviewed (129 tests pass); store fix bcc1458 folds per-frame sets in open gestures (was 270 ms per human edit during an agent build). Running: WP-04 undo, WP-08 commands, WP-10 agents port (early). Then WP-11 board carve-out, WP-12 shell. Queued after WP-12: WP-NET-0 (high risk, orchestrator-reviewed): unique human actor ids per identity+tab, buffer ops for unknown ids and bump lamport on remote ops, stamp `board` meta ops; see [[design-board]]. Server `board_*` tables need the owner's OK on names first. Worktrees in `.worktrees/wp-NN`, merged with --no-ff.

## Open work (GitHub, Kolby-Schulz/HackUTD2026)
- #26: submission package (README, diagram, demo video, Devpost)
- #17: dashboard polish for judges
- #20: host Contract (public dashboard, always-on services)
- #21: Nemotron for workers + NVIDIA comparison (coordinator half done)
- #35: per-role provider and model choice
- #23: Jev triage (stretch, TRIAGE=off by default)

## Known risks (details in [[Pitfalls]])
- Several server reducers lack identity checks; `reset_demo_state` has no auth.
- Docs disagree on a few points (Node version, NVIDIA key at setup, run-demo status). See [[overview]].
- No tests were run while building this vault (no `node_modules` in this checkout).

## Next action
- Owners: skim your Area note, correct anything wrong, bump `verified:`.
