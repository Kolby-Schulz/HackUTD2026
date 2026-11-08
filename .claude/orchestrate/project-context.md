# Project context — Contract (HackUTD 2026)

Repo rules live in `CLAUDE.md` and `docs/SPEC.md`; they outrank this file.

## Vault
- Path: `vault/` (repo root). Start at `vault/Home.md`.
- Layout follows the orchestrate vault schema. `Areas/` notes map 1:1 to the ownership table in `CLAUDE.md`,
  plus `Areas/overview.md` (project, stack, MVP checklist) and `Areas/history.md` (GitHub issues/PRs).

## Source control
- Base branch: `main`. PRs from contributor forks/branches (e.g. Kolby-Schulz/*). No deploy on merge.
- `sync.py` arguments: `--base origin/main --branches 'origin/*'`

## The right way to ask
- Open work -> `gh issue list --state open` / `gh pr list --state open`
- Where is X defined -> `git grep -n X`
- Spec for a part -> grep the section number in `docs/SPEC.md` (see ownership table in CLAUDE.md)

## Rules to copy into every writing agent's brief
- Stay in your part's folder (CLAUDE.md ownership table). Never rename spec'd tables/columns/reducers.
- All model calls through `packages/llm`. Secrets only in `.env`; repo is public.
- TypeScript ESM, run with `tsx`. Run the part's tests after each change.

## Only the orchestrator, and only when the owner says so
- Commits, pushes, PRs, SpacetimeDB publish to a shared instance.

## Risk
- High: `server/src` (schema/reducers), `packages/llm` (frozen interface), `packages/client` generated bindings.
