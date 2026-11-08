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
  - Waves 0-3 done (all 84 WPs), wired and browser-checked 2026-11-08. feat/dashboard-playground = playground/wiring
    f6b6adc, 784 tests, tsc and build green. Not pushed.
  - Owner request done: cursor tags show only the action (dots after it); hover pins the name pill at your pointer.
  - Waves 2-3 browser-pass fixes: tag short mode, minimap key, help-sheet snapshot loop, present-mode timing.
  - Not browser-checked yet: rotate cursor, handle double-click, layer row flash, spacing labels, file import/export,
    LLM bridge with a real bridge, demo panic key, real fullscreen. List in WIRING.md "Waves 2-3 browser pass".
  - Known: 60 fps unproven in the app's throttled pane; "Restart all" only when all agents are stopped.
  - Next: WP-NET-0 networking prep (vault/Scopes/design-board.md), owner's call.

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
