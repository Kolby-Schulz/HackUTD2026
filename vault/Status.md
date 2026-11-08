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
- Playground design board (`#/playground`). Plan: [[playground-plan]]; seams: `docs/playground/WIRING.md`.
  - Branches: `playground/features` (WP merges only, worktree `.worktrees/features`), `playground/wiring` (seams only,
    `.worktrees/wiring`), `feat/dashboard-playground` (fast-forwards to wiring after checks + visual pass).
  - Wave 0 done; Wave 1 done (all 39 WPs; features e4da972, 612 tests). Wave 2 started early (WP-52, 55, 56, 58, 61, 63,
    64 merged) before the owner asked to finish phases in order; no more Wave 2 until wiring + visual pass are done.
  - Wiring DONE on playground/wiring (2dfbb64, 631 tests, build green; WIRING.md has 0 todo, 1 dropped with reason).
  - Visual pass pending: needs the browser pane visible (hidden pane = no rAF = cursors, overlays, bench don't run).
  - Next: visual pass of the demo checklist on port 5174 (wp-review serves the wiring worktree), then fast-forward
    feat/dashboard-playground to playground/wiring. Then remaining Wave 2/3 and WP-NET-0.

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
