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
- Playground design board (`#/playground`, branch `feat/dashboard-playground`): board + agents committed (6ecef41), chat + comment tool uncommitted. Full plan in [[playground-plan]]: 411 features, 84 work packages. Wave 0 progress on `feat/dashboard-playground` (merge only in `.worktrees/integration`): WP-01 to WP-11 merged and reviewed (222 tests); engine.ts gone, page runs on the new core. Running: WP-12 shell carve-out. Store fix bcc1458 folds per-frame gesture sets. Queued after WP-12: Wave 1 packages, WP-NET-0. Note: another session works in the main checkout on `feat/variants` (it contains the WP-11 commits by accident; harmless).

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
