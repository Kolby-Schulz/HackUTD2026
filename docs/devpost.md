# Devpost write-up (draft)

Paste-ready sections for the Devpost form, plus the per-track paragraphs the judges for each
sponsor will read. Numbers marked **(1 run)** come from the current README benchmark table;
replace them after `npm run bench -- --runs 3`.

> **Open decision before submitting:** the dashboard and its title card say **InSync**; the repo,
> spec and this write-up say **Contract**. Pick one name and use it everywhere.

## Project name

Contract: live coordination for AI coding agents

## Tagline

Contract isn't another coding agent. It's what lets your team's coding agents work like a team.

## Inspiration

Every developer on a team now runs their own coding agent, and every one of those agents is blind
to the others. Git catches text conflicts; it doesn't catch two agents making incompatible
decisions that merge cleanly and break in the integration test, or two agents writing the same
helper twice. Berkeley's MAST study attributes about 79% of multi-agent failures to specification
and coordination problems. We wanted the fix to be infrastructure, not another agent.

## What it does

Contract is a shared SpacetimeDB server that coding agents connect to while they work. Each agent
publishes a plan (which symbols it will modify, create or depend on), claims the symbols it will
change, and reports changes as it makes them. Three deterministic rules run inside the reducers:

1. **Broken dependency.** You changed a function another agent's plan depends on. That agent is
   paused mid-task and told why.
2. **Duplicate implementation.** You planned to create something that already exists, or that
   another agent is creating. You're told to reuse it.
3. **Claim contention.** Two agents want the same symbol. The second one waits.

When a rule fires, a coordinator agent makes one model call, writes a decision with the owner,
the instructions and the reason, and the paused agent resumes with new instructions. A live
dashboard shows the code map, every agent's state, the conflict feed and a token scoreboard
comparing runs with and without Contract. It works on any git repo and with any agent that can
run an MCP server (our worker, Claude Code, Cursor, Codex).

## How we built it

- **SpacetimeDB module** (`server/`): two dozen tables, close to 40 reducers, the three rules as pure
  functions tested in-process, a scheduled reducer that expires claims from dead agents.
- **Client + MCP server** (`packages/client`, `packages/mcp`): the only way any process joins
  Contract. Nine MCP tools (`declare_plan`, `claim_symbol`, `report_change`, `find_existing`,
  `get_context`, ...).
- **Worker** (`agents/worker`): runs Claude Code headless in a git worktree with the Contract rules
  and MCP config. Hooks on every edit: a claim guard that blocks edits to unclaimed symbols, a
  change hook that re-maps the edited file and reports signature changes, a summary cache.
- **Coordinator** (`agents/coordinator`): subscribes to open conflicts, gathers both agents' plans
  and the diff, calls `decide()` once, validates the JSON, falls back to a claimed-first rule.
  Runs on NVIDIA Nemotron or Claude through one env switch.
- **Code mapper** (`mapper/`): ts-morph for TypeScript, tree-sitter for Python, Go, Java, Rust,
  Ruby, PHP, C# and C. Symbols, signature hashes and call edges, upserted per file.
- **Dashboard** (`dashboard/`): React, every panel a live `useTable` subscription. Code map,
  agent cards, conflict feed, scoreboard, replay of past runs, a chat that plans work and
  drives the agents on every paired laptop through a control daemon.
- **Benchmark** (`scripts/bench.ts`): the same tasks with and without Contract, cost, tokens,
  wasted tokens and broken merges per scenario.

## Challenges we ran into

- A reducer that throws rolls back everything, including the conflict row it just inserted. So
  `claim_symbol` records the contention and returns, and the client checks the claim table and
  throws on its own side.
- Three processes act as one agent (worker, MCP server, hook), so identity had to be by token, not
  by connection.
- Claude Code re-sends about 40k tokens of prompt per turn, mostly cache reads. Raw token totals
  were meaningless, so the scoreboard headline is billed cost with fresh and cached tokens split.
- The planted demo conflict was missed on the first live run: B depended on `computeTotal`, not
  on `calculateFee` directly. Rule 1 now follows callers up to three hops.

## Accomplishments we're proud of

- Conflicts caught while the code is being typed, on two laptops, with the second agent paused
  and resumed automatically.
- Any repo, any language, any agent: paste a GitHub link into the dashboard and it maps it,
  installs it and runs its own checks at merge.
- On the claim-contention scenario Contract cut cost by 66% and turned a broken merge into a
  clean one **(1 run)**.

## What we learned

Detection has to be free. Running the rules inside reducers means a conflict costs zero tokens
to find, and the model is only paid for when there's a real decision to make. That one choice is
most of the token story.

## What's next

- Nemotron workers alongside the Nemotron coordinator, and a per-role model mix shown live.
- Jev triage in front of the coordinator for sub-second rulings on the easy conflicts.
- A hosted, always-on Contract so a team can point their agents at it in a minute.

## Built with

TypeScript, SpacetimeDB (module, subscriptions, scheduled reducers), Claude Code, NVIDIA
Nemotron, Model Context Protocol, ts-morph, tree-sitter, React, Vite, Vercel.

---

## Track: SpacetimeDB

There is no backend server: the SpacetimeDB module is the server. The three conflict rules run
inside reducers (`publish_plan`, `claim_symbol`, `report_change`), so detection is transactional
and takes milliseconds. Every agent, the coordinator and the dashboard are subscribers; when Rule 1
fires, the paused agent's MCP server, the coordinator and both laptops' dashboards all get the
same row at the same time with no polling and no message bus. A scheduled reducer expires claims
every 30 seconds so a killed laptop never holds a symbol. The dashboard writes nothing except new
tasks and operator messages. Replay of a past run is a read of the same tables. The shared demo
database runs on Maincloud, so two laptops need no LAN setup and a hosted dashboard sees the same
rows as a local one.

## Track: NVIDIA Nemotron

The coordinator is where judgment lives, and it runs on Nemotron through the same `decide()`
interface the rest of the system uses (`COORDINATOR_PROVIDER=nemotron`). Nemotron 3.5 Lightning
resolves a conflict in about a second and matched 12/12 on the planted conflict set; Nemotron 3
Ultra took about two seconds with the same accuracy. Thinking mode was 10 to 50 times slower with no
gain, so it's off. Every call's tokens and cost are logged to the same `token_usage` table as the
workers', so the coordinator's own cost is on the scoreboard. Workers on Nemotron are the next
step; the provider switch and the token accounting are already in place.

## Optional framing: 8090 (legacy modernization)

The demo repo is a billing module being modernized by several agents in parallel. Contract is what
makes that safe: the agents' interface assumptions are tracked, not just their diffs, so a change
to a shared function pauses the agents that depend on it instead of breaking them at merge.
