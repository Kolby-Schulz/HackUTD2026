# Join Contract from your own coding agent (issue #22)

Contract coordinates whatever agent each teammate already uses. Our worker script is one way
in; this is the other: your normal Claude Code, Cursor or Codex session joins a run.

Prerequisites: this repo cloned with `npm install`, `.env` pointing at the shared database,
and an open run (`npm run session -- start` on any laptop).

## Claude Code

```bash
npm run join -- --agent dana --name "Dana" --owner Dana --client claude-code --dir ../my-checkout --task "Add a receipt line to checkout"
cd ../my-checkout && claude
```

`join` writes into `--dir` (default: the target repo, see "Your own repo" in the README):
- `.mcp.json`: the `contract` MCP server (declare_plan, claim_symbol, report_change, get_instructions …)
- `.claude/settings.local.json`: approves that server and adds the hooks: the **claim guard**
  (blocks edits to code another agent has claimed, and every edit **while you're paused**),
  plus **change reporting** (diffs to the dashboard, signature changes for Rule 1)
- `CLAUDE.local.md`: the Contract workflow rules

You show up on the dashboard while the session runs. When another agent changes something
your plan depends on, you're paused: the next edit is blocked with "you are paused", Claude
calls `get_instructions`, and it continues once the coordinator decides.

## Cursor

```bash
npm run join -- --agent dana --client cursor --dir ../my-checkout
npm run watch-agent -w @contract/worker -- --agent dana --dir ../my-checkout   # keep running
```

Writes `.cursor/mcp.json` and `.cursor/rules/contract.mdc` (always applied). Cursor has no
edit hooks, so `watch-agent` reports your saved files instead (signature changes and diffs);
the rules also ask the model to call `report_change` itself. Enable the `contract` server in
Cursor's MCP settings if it asks.

## Codex

```bash
npm run join -- --agent dana --client codex --dir ../my-checkout
```

Prints a `[mcp_servers.contract]` block for `~/.codex/config.toml` (Contract doesn't edit your
global config) and writes the rules into `AGENTS.md` between `contract:begin/end` markers.
Run `watch-agent` next to it, as for Cursor.

## Notes
- No secrets in these files: the MCP server and hooks read the agent's identity from
  `.contract/identities.json` (saved by `join`). New files are added to the repo's
  `.git/info/exclude`, so they don't show up in `git status`.
- Running `join` again updates the files in place (our hooks and blocks are replaced, yours are kept).
- One agent id per person. The id keeps its identity on that laptop; another laptop needs its own id.
