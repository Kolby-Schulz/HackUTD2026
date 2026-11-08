---
title: Decisions
area: map
sources: []
verified: 87debe9
---
Summary: Dated design decisions and why. Append-only. Pulled from GitHub PRs/issues and docs/TASKS.md "Decisions".

# Decisions

- 2026-11-08: Scoreboard shows cost and cached-token share, not raw token counts (#3).
- 2026-11-08: Two laptops share one Maincloud database (#6). See `docs/two-laptop-rehearsal.md`.
- 2026-11-08: Operator broadcast skips the coordinator and mapper (#32).
- 2026-11-08: Target repo is chosen with `--repo` or `CONTRACT_TARGET` (#34).
- 2026-11-08: Coordinator runs on Nemotron (`COORDINATOR_PROVIDER=nemotron`); workers stay on Claude Code (#43, plan in `docs/nemotron-coordinator-plan.md`).
- docs/TASKS.md "Decisions" items 9, 14, 15, 16 change spec behaviour (15 adds `mark_conflict_resolving`, not in SPEC §7). Treat TASKS as the newer word; see [[overview]].
- 2026-11-08: Identity checks on `set_task_status` (task's agent or coordinator), `log_saving` (`requireAgent`), `cache_summary` / `record_cache_hit` (any registered agent). `create_task`, `start_run`, `end_run`, `mark_attempt_wasted`, `reset_demo_state` stay open for the anonymous admin scripts and the dashboard; `reset_demo_state` refuses while a worker is live instead (#62, partial).
- 2026-11-08: No client-disconnect lifecycle reducer. Hook processes reuse the agent identity on short connections and wifi blips drop sockets of live workers, so presence stays heartbeat-based (see Pitfalls).
- 2026-11-08: Mapper treats a JS file with no exports (browser script, entry module) as all-public and maps its top-level declarations. Fixes plans rejected on demoRepo's `js/checkout.js`.
