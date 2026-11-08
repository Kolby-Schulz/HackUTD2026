# Design board: shipping handoff (PR #93)

## What ships
- **Website (Vercel):** a lazy `#/playground` route (the design board) and a "Design board" link in the dashboard's
  left activity bar. The main dashboard path in `dashboard/src/main.tsx` is otherwise identical to `main`.
- **Agents (not on Vercel):** `npm run board-agent -w @contract/dashboard`, a Node process on the host laptop:
  Nemo (Nemotron) plans, Claude 1-10 (Claude Code CLI) design and draw in parallel. Everything goes through
  SpacetimeDB (`board_*`, `board_message`, `agent`, `token_usage`).
- **No server change.** The board tables came in PR #91, which is already on `main`.

## Before merging (in order)
1. **Maincloud has the board tables.** The database owner runs this on their own laptop:
   `git checkout main && git pull && npm run publish:cloud -w @contract/server`
   Check it worked: `spacetime sql --server maincloud contract-hackutd26 "SELECT COUNT(*) AS n FROM board"`
   prints a number. Never add `--delete-data`.
2. **Vercel preview of PR #93:** sign in, open `<preview>/#/playground` in two browsers, and draw a rectangle in one.
   It shows in the other within a second. Also open `<preview>/#/` and check the dashboard looks and works as before.
3. **Agents against Maincloud:** on the host laptop (root `.env` = Maincloud + `NVIDIA_*`, `claude` logged in), run
   `npm run board-agent -w @contract/dashboard`. Wait for `Nemo + 10 Claude designers are on board 'playground'`, then
   send "design 2 screens for a coffee app" in the board chat. Both browsers see the designers draw.
4. Squash-merge PR #93.

## Checks already run on the merged branch (b1afc63)
- `npm run typecheck`: clean (board and agent).
- Root vitest: 583 passed. Dashboard vitest: 824 passed, 0 skipped. `vite build`: OK.
- Two browser tabs plus the agent process against local SpacetimeDB: edits, cursors, chat and 10 parallel designers.

## Not verified
- Anything against Maincloud (step 3 above is the first time).
- No automated tests for the agent process itself (manual end-to-end runs only).

## If something breaks: revert plan
Pick the smallest step that fixes it.

| Symptom | Do this | Effect |
|---|---|---|
| Agents misbehave (bad output, cost, spam) | Ctrl+C the `board-agent` process | The board keeps working with no agents. Nothing else changes. |
| `#/playground` broken, dashboard fine | Leave it, or revert the PR (below) | The dashboard never loads board code unless you open `#/playground`. |
| Dashboard broken after the merge | Revert the PR: GitHub, PR #93, **Revert**, merge the revert PR | Vercel redeploys `main` without the board in about 2 minutes. |
| Need prod back right now | Vercel dashboard, Deployments, the deployment before the merge, **Promote to Production** (or "Instant Rollback") | Takes seconds. Then do the revert PR so `main` matches. |
| Bad data on the shared board | Operator calls `reset_board` for board `playground` | Clears that board only. Other tables are untouched. |

Revert from the command line instead of GitHub:
```bash
git checkout main && git pull
git revert <squash-commit-of-PR-93>
git push origin main
```
The board tables on Maincloud can stay after a revert: nothing reads them without the board page, so they need no
cleanup and no `--delete-data`.
