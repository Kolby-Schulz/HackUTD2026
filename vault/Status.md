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
  - Wiring done; visual pass done 2026-11-08 (every MVP button clicked in the browser; findings fixed and rechecked):
    activity-based locks + one focus outline per agent, humans-win independent of lock timing, Restart for stopped
    agents, toasts above toolbar, copy-link fallback, playground class names scoped from dashboard CSS.
  - feat/dashboard-playground fast-forwarded to 17f0ad3 (= playground/wiring), 638 tests, build green. Not pushed.
  - Known: 60 fps unproven in the app's throttled pane; "Restart all" only when all agents are stopped.
  - Owner chose: finish Waves 2-3 (roadmap's networking work deferred). Features branch re-baselined at 3fecb40.
  - Running: Wave 2 remainder WP-53, 54, 57, 59, 60, 62 (worktrees .worktrees/wp-NN). Then Wave 3 (20 WPs; 65/81 wait
    on 54, 67 on 66, 76 on 60), then wiring ledger, browser pass, fast-forward.
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
