---
title: Playground plan
area: dashboard
sources: [docs/playground/, dashboard/src/playground/]
verified: 6ecef41
---
Summary: The `#/playground` design board (Figma / Claude Design style, many agent cursors, one chat per agent, comment tool that routes to the author) has a full plan: 7 domain specs (411 features), a decisions doc (D1-D10), a catalog and 84 work packages in 4 waves with paste-ready agent briefs.

# Playground plan

## Where things are
- Code today: `dashboard/src/playground/{engine.ts,Playground.tsx,ChatPanel.tsx,playground.css}` on branch `feat/dashboard-playground` (commit 6ecef41 has the board; the chat + comment tool are uncommitted on top).
- Decisions and module layout: `docs/playground/REQUIREMENTS.md` (read first; sections 5-7 are the contract).
- Catalog: `docs/playground/FEATURES.md` (411 features: 183 P0, 166 P1, 62 P2; 52 cross-domain duplicates marked "same as").
- Build plan: `docs/playground/TASKS.md` (WP-01..WP-84, ~195 agent-hours; each WP has owned files, acceptance checks, risk tier and a brief to paste into an agent).
- Raw research: `docs/playground/domains/*.md`.

## How to run it (orchestrator)
- Wave 0 spine: WP-01 → 02 → 03 → 08 → 10 → 11 → 12 (~15 h wall clock, max 6 agents in stage B). Nothing from Wave 1 starts before WP-12 merges.
- Waves 1-3: file-disjoint packages, 8-10 in parallel, review-bound. Risk `high` on WP-01..04, 08, 10, 11: read the diff yourself and trace callers.
- Frozen files (`core/types.ts`, `ui/Playground.tsx`, `actions/index.ts`, `core/gate.ts`, `core/snap.ts`) change only through the orchestrator.
- Every WP agent: Sonnet, own worktree, `cd dashboard && npx tsc --noEmit && npx vitest run`, report ≤150 words. Run `sync.py` before each parallel batch.

## Decisions already taken (D1-D10, details in REQUIREMENTS §5)
Flat map + `parent` + local coords + fractional `index`; store outside React with actor-tagged idempotent ops, per-actor undo that skips fields others changed; one command API shared by human, scripted and future LLM agents; presence on a separate bus; DOM rendering + culling + one spatial grid + camera store + one rAF loop; one hit-test, one snap module; one action registry and key dispatcher; humans win every lock, claims echo Contract's claim/conflict; vitest only; light theme, localStorage.

## Still open (defaults apply unless the owner objects)
See REQUIREMENTS §9 "Still open": LLM agents run in a Node bridge after the MVP; no SpacetimeDB tables yet; reload restores board+chat+pins; agents confirm before deleting a frame or >5 layers; system fonts; `?demo=1` seeds and allows a panic reset.
