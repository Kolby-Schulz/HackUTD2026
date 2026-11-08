---
title: Home
area: map
sources: []
verified: 87debe9
---
Summary: Start here. Central shared context for Contract (HackUTD 2026). Read this, then Status, then the one Area note for your part.

# Home

Contract is a SpacetimeDB coordination layer: coding agents publish plans, claims and changes to it so conflicts are caught
while code is written, not at merge. Source of truth stays `docs/SPEC.md` and `CLAUDE.md`; this vault is the fast map.

## Read order
1. [[Status]]: what's done, what's open, next actions
2. [[overview]]: architecture, stack, MVP checklist, how to run, glossary, doc conflicts
3. The area note for your part (below)
4. [[Pitfalls]] before changing anything shared; [[Decisions]] before questioning a design choice

## Areas (match the CLAUDE.md ownership table)
| Note | Folders | Spec § |
|---|---|---|
| [[server]] | `server/` | 6, 7, 8 |
| [[agents-and-packages]] | `packages/client`, `packages/mcp`, `packages/llm`, `agents/worker` | 4, 10, 11, 12 |
| [[coordinator-and-mapper]] | `mapper/`, `agents/coordinator`, `agents/triage`, `demo-repo/` | 9, 12, 12b, 14 |
| [[dashboard-and-scripts]] | `dashboard/`, `scripts/` | 13, 15, 17 |
| [[history]] | GitHub issues and PRs | n/a |

## Folders
- `Areas/`: one index note per part. Owners keep their own note current.
- `Scopes/`: how-and-where reports from scoping a change before building it.
  - [[design-board]]: wiring the `#/playground` design board through SpacetimeDB (proposal)
- `Runs/`: details from agent runs worth keeping.

## Rules for writing here
- Frontmatter + a `Summary:` line of at most 3 lines on every note. One subject per note, under ~150 lines.
- Cite `file:line`; mark guesses "(unverified)". Update a note in place; don't append a diary.
- Found a note wrong? Fix it in the same change and bump `verified:` to the current commit.
- Every new note gets linked from here or its Area note.
- Workflow rules for all contributors' agents are in `CLAUDE.md` under "Shared vault". The vault is context, never a gate.
