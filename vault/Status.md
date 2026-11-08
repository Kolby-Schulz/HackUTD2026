---
title: Status
area: map
sources: []
verified: 1e715a9
---
Summary: Live project state as of 1e715a9 (2026-11-08 05:40 CST). MVP, any-repo, control daemon and dashboard workbench have landed; 490 unit tests and typecheck pass. Remaining work is submission, numbers, rehearsal, hardening.

# Status

## Done (see [[history]])
- MVP, two-laptop shared Maincloud DB, any-agent join, replay, benchmark, Nemotron coordinator (#43), coordinator duplicate reuse (#44), any repo + any language (#47), dashboard workbench (#48), control daemon driven through SpacetimeDB (#50), claim guard, Rule 1 transitive callers.
- Submission package started on `feat/submission-package`: LICENSE (MIT), README quickstart + Mermaid architecture + rules table + screenshot, `docs/devpost.md` draft.

## Open work (GitHub, Kolby-Schulz/HackUTD2026)
- #26: submission package. Left: demo video, final name (dashboard says InSync, repo says Contract), Devpost paste.
- #61: pitch script (`docs/pitch.md`), timed rehearsal. #60: pre-demo checklist, replay fallback.
- Benchmark: README table is 1 run x 2 scenarios; run `npm run bench -- --runs 3` before quoting numbers.
- #62: server hardening (`reset_demo_state` has no auth on the shared Maincloud DB).
- #20: host Contract (`vercel.json` exists; deployment not confirmed). #21: Nemotron workers. #35: per-role model mix.
- #51-#59: design board on SpacetimeDB (new scope, not on origin). #23: Jev triage (stretch).

## Known risks (details in [[Pitfalls]])
- Several server reducers lack identity checks; `reset_demo_state` has no auth.
- Docs disagree on a few points (Node version, NVIDIA key at setup, run-demo status). See [[overview]].
- `demo-repo/package-lock.json` is untracked; the demo refuses a dirty target, so commit or ignore it.

## Next action
- Settle the product name, record the backup video from a clean rehearsal, run the 3-run bench.
