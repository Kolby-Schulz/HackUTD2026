# Two-laptop rehearsal checklist (issue #19)

Run this top to bottom before the demo, then twice more. Everything should take under 5 minutes.

## Once per laptop
- [ ] `git pull && npm install`
- [ ] `.env` has `SPACETIME_HOST=wss://maincloud.spacetimedb.com` and `SPACETIME_DB_NAME=contract-hackutd26`
- [ ] `npm run join -- --agent agent-a --name "Agent A" --owner <you>` (laptop 2: `agent-b`). Fix anything it flags (Node 22+, `.env`, `claude` login, git origin).
- [ ] The agent shows up on the dashboard on **both** laptops.

## Before each run (one laptop: the "operator" laptop)
- [ ] `npm run reset` on **both** laptops (removes old worktrees and agent branches).
- [ ] `npm run session -- start` (ends old runs, maps the repo, opens a run).
- [ ] `npm run coordinator` on the operator laptop **only**. A second one refuses to start ("coordinator is already running on …"); that's the lock working.
- [ ] Optional: `npm run mapper -- --watch` on the operator laptop only (same lock).
- [ ] Dashboard open on both laptops (`npm run dashboard`, or the hosted URL).

## The run
- [ ] Each laptop: `npm run worker -- --id agent-a --wait` (and `agent-b`), then assign tasks from the dashboard's **New task** form. Or `--prompt "..."`.
- [ ] Watch the conflict appear, the agent card turn amber, the coordinator resolve it, the card turn green.
- [ ] Try a message from the dashboard to the **other** laptop's agent (message box on its card). It shows **Read** once delivered.
- [ ] When both are done: `npm run session -- merge` on either laptop (it fetches both `agent/<id>` branches from origin).

## Judge task (optional, issue #29)
- [ ] On one laptop: `npm run judge` (agent `agent-judge`; defaults: 6 min, 20k output tokens, edits only in `src/` and `tests/`).
- [ ] A **"Your turn: give a third agent a task"** box appears on the dashboard. A judge types a task; Contract coordinates it with the running agents. A task over a limit is discarded and its changes dropped.

## If the network drops
- Workers reconnect on their own (same identity, resubscribed). The dashboard shows **Laptop offline** on an agent card after 45 s without a heartbeat; it clears once the laptop is back.
- Venue Wi-Fi down: phone hotspot on both laptops; Maincloud is the same database, nothing to change.
- No internet at all: one laptop runs `spacetime start` and `npm run publish -w @contract/server`, both laptops set `SPACETIME_HOST=ws://<that laptop's LAN IP>:3000` and `SPACETIME_DB_NAME=contract` (hotspot LAN works). Claude Code still needs internet for the agents, so keep the backup video ready.

## Known limits
- Exactly one coordinator and one watching mapper per database (service lock). After a crash, another laptop can take over 30 s after the last heartbeat; the same laptop can restart straight away.
- `CONTRACT_MACHINE=<name>` overrides the machine name shown on the dashboard and used by the lock.
