# InSync: live coordination for AI coding agents

> InSync isn't another coding agent. It's what lets your team's coding agents work like a team.

Built at HackUTD 2026. **[Live dashboard](https://hack-utd-2026.vercel.app)** · [Full spec](docs/SPEC.md) · [Guide](docs/guide.md)

![InSync dashboard after a run: the code map, each agent's status, the coordinator's rulings and the savings panel](docs/images/dashboard.png)

## Inspiration

Everyone on a team now runs their own coding agent, and every one of those agents is blind to the
others. Git only catches conflicts in the text. It misses two agents making incompatible decisions
that merge cleanly and break later, or both writing the same helper. We wanted the fix to be
infrastructure, not yet another agent.

## What it does

InSync is a shared server that coding agents connect to while they work. Each agent publishes a plan
and claims the code it will change. When two plans collide, InSync catches it **while the code is
being written, not at merge time**:

1. **Broken dependency.** You changed a function another agent relies on, so that agent is paused and told why.
2. **Duplicate code.** You're about to write something that already exists, so you're told to reuse it.
3. **Claim contention.** Two agents want the same function, so the second one waits.

A coordinator agent then makes one decision (who owns the change, what the other agent should do)
and the paused agent carries on. The dashboard shows all of it live, plus the tokens saved.

## Try it

You need Node 22+, the [SpacetimeDB CLI](https://spacetimedb.com/install) and a logged-in
[Claude Code](https://claude.com/claude-code). From the repo root:

```bash
cp .env.example .env   # then set SPACETIME_HOST and SPACETIME_DB_NAME, see docs/guide.md
npm install
npm run control
```

`npm run control` opens the dashboard. In its **Chat** tab, say what you want built
("Add late fees to invoices, and have another agent format receipt dates") and InSync splits the
work across agents, catches their conflicts and merges the result. Two laptops, your own repo and
every command are in the [guide](docs/guide.md).

## How we built it

- **SpacetimeDB** is the whole backend. The three rules run inside its reducers, so spotting a
  conflict is instant and costs no tokens; every agent and dashboard just subscribes to the tables.
- **Worker agents** are Claude Code sessions in their own git worktrees, joined to InSync through an
  MCP server and edit hooks. Any MCP-capable agent (Cursor, Codex) can join too.
- **The coordinator** makes one model call per conflict, on NVIDIA Nemotron or Claude.
- **The code mapper** turns a repo into functions and call edges (TypeScript and JavaScript, plus
  Python, Go, Java, Rust, Ruby, PHP, C# and C/C++ with tree-sitter).
- **The dashboard** is React and Vite, hosted on Vercel, with a small local daemon that starts agents.

TypeScript · SpacetimeDB · Claude Code · NVIDIA Nemotron · MCP · React · Vite · ts-morph · tree-sitter · Vercel

```text
server/        SpacetimeDB module: tables, reducers, the three rules
agents/        worker, coordinator and optional triage agents
packages/      client library, MCP server, shared model wrapper
mapper/        repo -> functions and call edges
dashboard/     React web app
demo-repo/     small codebase with planted conflicts
```

## Challenges we ran into

- A SpacetimeDB reducer that throws rolls back everything it wrote, including the conflict it had
  just recorded. We record the conflict and return, and check the result on the client instead.
- Claude Code re-sends about 40k tokens of prompt every turn, so raw token counts told us nothing.
  The scoreboard leads with billed cost instead.
- Our first live run missed the planted conflict, because the second agent depended on a caller
  of the changed function, not the function itself. The dependency rule now follows callers up to three hops.

## Accomplishments we're proud of

- Conflicts caught while agents are typing, on two laptops, with the second agent paused and
  resumed on its own.
- It works on any git repo, in any language the mapper reads: paste a GitHub link into the dashboard.
- On the claim-contention scenario, InSync cut cost by 66% and turned a broken merge into a clean one.
  That is a single run per mode, so treat it as a first result:

<!-- bench:begin -->
Across 2 scenario(s) and 4 runs, InSync saved **26%** of the cost (0% of tokens) and left 0/2 merges broken vs 1/2 without it.

| Scenario | Runs (without / with) | Cost without | Cost with | Saved | Tokens without | Tokens with | Wasted without | Broken merges without | Broken merges with |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claim contention (both modify calculateFee) | 1 / 1 | $0.89 | $0.30 | 66% | 1274.1k | 931.6k | 978.6k | 1/1 | 0/1 |
| Control: unrelated changes | 1 / 1 | $0.29 | $0.33 | -15% | 906.5k | 1147.4k | 0 | 0/1 | 0/1 |

_Generated 2026-11-08T07:33:30.039Z by `npm run bench`. Averages per run; tokens include cache reads (cost is what was billed)._
<!-- bench:end -->

## What's next

- Nemotron workers next to the Nemotron coordinator.
- Jev triage in front of the coordinator, for sub-second rulings on the easy conflicts.
- A hosted, always-on InSync, so a team can point their agents at it in a minute.

## A note on the name

InSync is the product name. We called it Contract while building, so the code still does: packages
are `@contract/*`, the config file is `contract.json` and the database is `contract-hackutd26`.

## License

MIT, see [LICENSE](LICENSE).
