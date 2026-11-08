<!-- Text extracted from "Contract Build Handoff and Technical Spec.pdf" (Tyler, Nov 7 2026, updated version: Claude Code now, Nemotron later, Jev triage stretch). The PDF is the source of truth for tables and diagrams. -->


Nov 7, 2026

·

​@Tyler

This is the build spec for Contract, our HackUTD 2026 project. Read it yourself, then paste
it into your coding agent as context before you start your part.

1. Overview
Contract is a coordination server that lets a team's AI coding agents see each other's
plans live, so they stop making conflicting changes and stop wasting tokens on work that
gets thrown away.
What it is: developer infrastructure. A shared SpacetimeDB server that coding agents
connect to, a Nemotron coordinator agent that resolves conflicts, and a live web
dashboard. As a first stretch goal, Jev (TypeSafe's fast decision model) triages
conflicts and changes in under a second, so the coordinator model is only called when
real reasoning is needed.
What it is not: another coding agent. Contract writes no feature code. In the demo,
Claude Code sessions on two laptops stand in for "each teammate's coding agent."
Who it's for: teams where several developers each run their own coding agents
(Claude Code, Codex, Cursor and others) on one shared repo. A solo developer with
one orchestrating agent doesn't need it.
The problem: Git only catches conflicts at the text level. Agents make incompatible
decisions that merge cleanly and break later, or write duplicate code. Berkeley's MAST
study found about 79% of multi-agent failures come from specification and
coordination problems.
Two selling points: (1) conflicts caught while code is being written, not at merge time;
(2) measurable token savings.
Target tracks: SpacetimeDB main track, plus the NVIDIA Nemotron track once
Nemotron is swapped in. We build everything with Claude Code agents first, get it
working, then swap Nemotron in through one config switch (section 12). Optional
third: 8090 (legacy modernization), if we frame the demo repo as a codebase being
migrated by parallel agents.
Pitch line: "Contract isn't another coding agent. It's what lets your team's coding
agents work like a team."

Contract: Build Handoff and Technical Spec

2. Core concepts
Everything in Contract is built from seven ideas; use these exact names in code.
Term

Meaning

Example

Symbol

A named piece of code: a function,
class, method or exported constant,
with its signature and file

calculateFee(amount: number):
number in src/billing/fees.ts

Agent

A connected coding agent working
on one task

agent-a working on "add late fees"

Plan

What an agent says it will do: a
summary plus the symbols it will
modify, create or depend on

modify calculateFee , depend on

Claim

Exclusive right to change one
symbol's interface or behavior, held
by one agent and expiring if the
agent goes quiet

agent-a claims calculateFee

Change

A report that a symbol's signature or
behavior actually changed

calculateFee now rounds half-up

Conflict

A detected clash between agents: a
broken dependency, a duplicate
implementation or competing claims

agent-b depends on the old

The coordinator's resolution of a
conflict, with an owner, instructions
and a reason, kept as an audit log

"agent-a owns calculateFee ; agent-b
updates its checkout code"

Decision

formatDate

calculateFee

3. Architecture
Agents never talk to each other directly: they read and write only through the Contract
server, and get live pushes back.

Contract: Build Handoff and Technical Spec

Contract architecture · agents, server, coordinator, code mapper, dashboard

The coordinator and code mapper are separate Node processes because SpacetimeDB
reducers can't make network calls. The dashboard is just another subscriber.
End-to-end example:
1. The code mapper loads the repo's symbols into the server.
2. Agent A (laptop 1) publishes a plan to change how calculateFee rounds, and claims
calculateFee .

3. Agent B (laptop 2) is midway through checkout code that calls calculateFee ; its plan
lists calculateFee as a dependency.
4. Agent A calls report_change . The reducer finds Agent B's dependency and inserts a
conflicts row.

5. Agent B gets the push instantly and pauses. The coordinator gets it too.
6. The coordinator decides: Agent A owns calculateFee ; Agent B updates its code to
the new rounding. It writes a decisions row with the reason.
7. Agent B reads its new instructions, adjusts and continues. Both merge cleanly, and the
dashboard logs one conflict prevented.

Contract: Build Handoff and Technical Spec

4. Tech stack and setup
Everything is TypeScript, so all parts share one SpacetimeDB SDK and one set of types.
Part

Technology

Notes

Contract server

SpacetimeDB TypeScript module
( spacetimedb/server )

Tables via table(...) ,
column types via t.* ,
reducers registered on
the schema. Each
reducer runs in its own
transaction and throws
SenderError for userfacing errors. Reducers
have no filesystem or
network access. Docs

Client library,
agents,
coordinator,
mapper

Node.js + SpacetimeDB TypeScript client
SDK ( spacetimedb/sdk )

Generate typed
bindings from the
module with the
SpacetimeDB CLI

Dashboard

React + spacetimedb/react ( useTable ,
useReducer )

Tables update live with
no polling. Quickstart

LLM

Now: Claude Code in headless mode
(claude -p) for workers and the coordinator.
Later: NVIDIA hosted Nemotron, OpenAIcompatible API at

Use the openai npm
package with that base
URL. API key from
build.nvidia.com

https://integrate.api.nvidia.com/v1

Code mapper

TypeScript compiler API, or the ts-morph
package

Demo repo is
TypeScript

Demo repo tests

Vitest or Jest

Agents run tests as a
tool

Now, Claude Code: install Claude Code on each laptop and sign in. Workers and the
coordinator run it headless ( claude -p ) with JSON output, which reports the session id,
token usage and cost for every run. Read the headless mode docs and the hooks guide
before building the worker script.
Which Nemotron models to swap in later (check exact slugs on build.nvidia.com):

Contract: Build Handoff and Technical Spec

Worker agents: a fast model, e.g. nvidia/nemotron-3.5-lightning-30b-a3b .
Coordinator: a stronger reasoning model, e.g. nvidia/nemotron-3-ultra-550b-a55b .
Fall back to the Lightning model if it's slow or rate-limited.
Both support tool calling in the standard OpenAI tools format.
Jev (stretch, section 12b): TypeSafe's hosted API. Check TypeSafe's docs for the exact
request format (state plus typed questions in, typed answers with probabilities out) and
store the key as JEV_API_KEY in .env . Fallback if we can't get access: a small, fast model
through packages/llm that returns the same JSON.
Setup checklist:
Install the SpacetimeDB CLI and start a local server ( spacetime start )
Create the module project and publish it locally
Generate TypeScript client bindings into packages/client
Each laptop has Claude Code installed and signed in. Later, for the Nemotron swap,
each person gets an NVIDIA API key and sets NVIDIA_API_KEY in .env
Confirm one headless claude -p call with JSON output works on each laptop
(Nemotron test calls come later)
Follow the SpacetimeDB TypeScript quickstart for exact CLI commands; they change
between versions (latest release seen: v2.8.0).

5. Repo layout
One public GitHub monorepo (SpacetimeDB requires public source code to win), with one
folder per part so four people can work in parallel without touching each other's files.

Contract: Build Handoff and Technical Spec

contract/
server/
SpacetimeDB module: tables, reducers, conflict checks
packages/
client/
Contract client library + generated SpacetimeDB
bindings
mcp/
Contract MCP server (wraps the client) so Claude Code
can join
llm/
Model wrapper: claude-code provider now, nemotron
later; token logging
agents/
worker/
Worker agent loop and its tools
coordinator/
Coordinator agent loop and prompts
triage/
Jev triage process (stretch, section 12b)
mapper/
Code mapper: repo -> symbol rows
dashboard/
React web app
demo-repo/
Small TypeScript codebase with planted conflicts +
tests
scripts/
run-demo.ts (with/without Contract), reset.ts, seed.ts
.env.example
LLM_PROVIDER, SPACETIME_HOST, SPACETIME_DB_NAME
(NVIDIA_API_KEY later)
README.md

Ownership: server/ → backend owner; packages/client + agents/worker → agents
owner; mapper/ + agents/coordinator → coordinator owner; dashboard/ + scripts/
→ dashboard owner. packages/llm is shared; agree on its interface first.
packages/mcp belongs to the agents owner. agents/triage/ (stretch) belongs to the

coordinator owner.

6. Data model (SpacetimeDB tables)
All tables are public so the dashboard and agents can subscribe. The block below shows
the shape of each table; translate it into real table(...) and t.* calls from the
SpacetimeDB TypeScript docs (it is not exact syntax).
// Who is connected and what they're doing
agent
{ id: string PK, name, owner_dev, machine, model,
status: 'idle'|'working'|'paused'|'done',
current_task_id: u64?, token_budget: u64, last_heartbeat:
timestamp }

Contract: Build Handoff and Technical Spec

task

{ id: u64 PK autoInc, title, description, agent_id,
status: 'todo'|'in_progress'|'paused'|'done'|'discarded',
attempt: u32, run_id: u64 }

// The code map (written by the mapper)
symbol

{ id: string PK // "src/billing/fees.ts#calculateFee"
name, kind: 'function'|'class'|'method'|'const', file,
signature, signature_hash, behavior_note, version: u32,

updated_at }
symbol_edge
callee"

{ id: u64 PK autoInc, caller_id, callee_id }

// "caller calls

summary_cache{ key: string PK // file_path + ":" + content_hash
summary, summary_tokens: u32, hits: u32 }
// Coordination
plan
{ id: u64 PK autoInc, agent_id, task_id, summary, active: bool,
created_at }
plan_item

{ id: u64 PK autoInc, plan_id, agent_id, symbol_id,
intent: 'modify'|'create'|'depend' }

claim
change

{ symbol_id: string PK, agent_id, claimed_at, expires_at }
{ id: u64 PK autoInc, agent_id, symbol_id,
kind: 'signature'|'behavior'|'created'|'removed',
old_signature?, new_signature?, description, created_at }

conflict

{ id: u64 PK autoInc,
kind: 'broken_dependency'|'duplicate'|'claim_contention',
symbol_id, agent_a, agent_b, details,
status: 'open'|'resolving'|'resolved'|'dismissed',

decision

created_at, resolved_at? }
{ id: u64 PK autoInc, conflict_id, owner_agent,

instruction

instructions_a, instructions_b, reason, created_at }
{ id: u64 PK autoInc, agent_id, conflict_id?, text,
acknowledged: bool, created_at }

// the "push" an agent

reacts to
// Token accounting
run

{ id: u64 PK autoInc, mode: 'with_contract'|'without_contract',
seed: u32, started_at, ended_at? }

token_usage

{ id: u64 PK autoInc, run_id, agent_id, task_id, attempt: u32,
purpose:

'plan'|'code'|'context'|'test_fix'|'merge_fix'|'coordination',
prompt_tokens: u32, completion_tokens: u32,

Contract: Build Handoff and Technical Spec

wasted: bool, created_at }
token_saving { id: u64 PK autoInc, run_id, agent_id,
kind: 'early_stop'|'reuse'|'context_slice'|'cache_hit',
tokens_avoided_est: u32, note, created_at }

Add indexes on plan_item.symbol_id , symbol_edge.callee_id , conflict.status and
token_usage.run_id , since reducers and the dashboard filter on them.

Jev additions (stretch): conflict.status gains 'escalated' and conflict.kind gains
'plan_clash' . Add conflict.triage_confidence: f32? , conflict.severity: u8?

and conflict.resolved_by: 'jev'|'nemotron'|'fallback_rule'? . Add
change.source: 'agent'|'triage' . token_usage.purpose gains 'triage' and
token_saving.kind gains 'auto_resolve' .

7. Reducers
Reducers are the only way anything changes; each runs as one transaction, so two agents
can never both win a claim. The important ones run the conflict checks from section 8
inline.
Reducer

Arguments

What it does

Rejects when

register_agent

id, name, owner_dev,
machine, model,
token_budget

Inserts or updates
the agent row and
links it to the caller's
identity

id already linked to
another identity

heartbeat

agent_id

Updates

unknown agent

last_heartbeat
start_run / end_run

mode, seed / run_id

Opens or closes a
run for token
accounting

a run is already open

upsert_symbols

file, symbols[], edges[]

Replaces that file's
symbol and
symbol_edge rows;
bumps version
when a signature
hash changes

—

create_task /

task fields / task_id,
status

Manages tasks

invalid status change

set_task_status

Contract: Build Handoff and Technical Spec

Reducer

Arguments

What it does

Rejects when

publish_plan

agent_id, task_id,
summary, items[]

Deactivates the
agent's old plan,
inserts the new
plan and
plan_item rows,
then runs the
duplicate and
contention checks

items reference
unknown symbols
(except create )

claim_symbol

agent_id, symbol_id,
ttl_secs

Inserts a claim

another agent holds an
unexpired claim; also
inserts a
claim_contention

conflict
release_claim

agent_id, symbol_id

Deletes the claim

caller doesn't hold it

report_change

agent_id, symbol_id,
kind, new_signature?,
description

Inserts a change ,
updates the symbol,
runs the brokendependency check;
for each affected
agent sets status
paused and inserts
an instruction

modify on a symbol

resolve_conflict

conflict_id,
owner_agent,
instructions_a,
instructions_b, reason

Inserts a decision ,
inserts one
instruction per
agent, marks the
conflict resolved ,
unpauses agents

caller isn't the
coordinator; conflict
not open

dismiss_conflict

conflict_id, reason

Marks a false alarm
dismissed and
unpauses agents

caller isn't the
coordinator

acknowledge_instruction

instruction_id

Marks it read

caller isn't its agent

log_tokens

run_id, agent_id,
task_id, attempt,
purpose,
prompt_tokens,
completion_tokens

Inserts a

—

the agent hasn't
claimed

token_usage row

Contract: Build Handoff and Technical Spec

Reducer

Arguments

What it does

Rejects when

mark_attempt_wasted

task_id, attempt

Sets wasted = true
on that attempt's
token rows and
bumps the task's
attempt

—

log_saving

run_id, agent_id, kind,
tokens_avoided_est,
note

Inserts a

—

key, summary,
summary_tokens / key

Writes or counts a
shared file summary

—

record_cache_hit
expire_claims (scheduled,

—

Deletes expired
claims and marks
agents with no
heartbeat for 60 s as

—

cache_summary /

every 30 s)

token_saving row

idle

Identity: SpacetimeDB gives every reducer the caller's identity. Store it on
register_agent and check it in reducers that act for an agent. Register the coordinator
under the fixed id coordinator .
Jev additions (stretch): record_triage(conflict_id, real_p, action, action_p,
severity) stores Jev's verdict, then either resolves the conflict with a templated

decision (same logic as resolve_conflict ) or sets it to escalated .
flag_conflict(kind, symbol_id, agent_a, agent_b, details, confidence) lets

triage open duplicate and plan_clash conflicts. report_change accepts source =
'triage' when triage reports a change on an agent's behalf. Register triage as agent id
triage and allow these calls only from it.

8. Conflict detection rules
All detection is deterministic and runs inside reducers in milliseconds; the coordinator
LLM is only called after a rule fires. This keeps detection instant, free and predictable, and
is a big part of the token story.
Rule 1: Broken dependency (runs in report_change )
1. Agent X reports a signature or behavior change to symbol S.
2. Find every other agent Y with an active plan_item where intent = 'depend' on S.

Contract: Build Handoff and Technical Spec

3. Also find agents whose active plan modifies or creates any symbol that calls S, using
symbol_edge.callee_id = S .

4. For each Y found: insert conflict(kind='broken_dependency', agent_a=X,
agent_b=Y) , set Y to paused , insert an instruction for Y: " S was changed by X.
Pause and wait for the coordinator."
Rule 2: Duplicate implementation (runs in publish_plan )
1. Agent X plans to create a new symbol N.
2. Compare N against existing symbols and other agents' planned creates: same
normalized name (lowercase, strip _ , - , verbs like get / make ), or same parameter
and return types plus a shared name token (e.g. formatDate vs dateToString ).
3. On a match with symbol E (or another agent's planned create): insert
conflict(kind='duplicate') . If E already exists, also insert an instruction for X: " E

already does this; reuse it."
Rule 3: Claim contention (runs in claim_symbol and publish_plan )
1. Agent X tries to claim S, or plans to modify S, while agent Y holds an unexpired claim
on S.
2. Reject the claim and insert conflict(kind='claim_contention') .
Dedupe: never open a second open conflict for the same (kind, symbol, agent pair).
Stretch: use embeddings for fuzzy duplicate matching. Embeddings need a network call,
so compute them outside the module and store them on symbol .
With Jev on: the rules still run first and stay free. Jev then judges each conflict a rule
opens (section 12b, question 1), catches behavior changes agents forgot to report
(question 2), and finds duplicates and plan clashes that name-based rules miss
(questions 3 and 4). Question 3 replaces the embeddings idea above.

9. Code mapper
The mapper turns the demo repo into symbol and symbol_edge rows; it runs once at
startup and again on every file an agent saves.
Input: a repo path. Output: calls to upsert_symbols(file, symbols, edges) , one
per file.

Contract: Build Handoff and Technical Spec

Parse with ts-morph (or the TypeScript compiler API). For each exported function,
class, method and top-level const, record: id "<file>#<name>" (methods: "
<file>#Class.method" ), kind, file, the signature text as written, and
signature_hash (a hash of the normalized signature).

Edges: for each call expression inside a symbol's body, resolve the callee to its
declaration; if it's in the repo, emit caller_id → callee_id .
behavior_note: leave empty from the mapper; agents fill it through report_change
when behavior changes without the signature changing (like rounding).
Watch mode: watch demo-repo/ with chokidar (or the agents' save hook) and remap only changed files.
Command: npm run mapper -- --repo ../demo-repo [--watch]
Done when: the dashboard's code map shows every demo-repo function with correct
caller arrows.

10. Contract client API
The client is the only thing an agent needs to join Contract; later we wrap these same
functions as an MCP server so Claude Code or Codex can join too.
const contract = await ContractClient.connect({ host, dbName, agent: {
id: 'agent-a', name: 'Agent A', ownerDev: 'Alice', machine: 'laptop-1',
model: 'claude-code', tokenBudget: 200_000 } });
// Coordination
contract.publishPlan(taskId, summary, items: { symbolId, intent }[])
contract.claim(symbolId, ttlSecs = 300)
// throws if someone else
holds it
contract.release(symbolId)
contract.reportChange(symbolId, kind, { newSignature?, description })
// Live pushes
contract.onInstruction(cb: (instr) => void)
"pause", "resume"
contract.onStatusChange(cb: (status) => void)
conflict

// conflicts, decisions,
// e.g. paused by a

contract.ack(instructionId)
// Token savers
contract.getContext(symbolIds, depth = 1)

// signatures + summaries

Contract: Build Handoff and Technical Spec

of the symbols and their neighbors, not whole files
contract.findExisting({ name, params?, returns? }) // reuse lookup before
creating a helper
contract.getSummary(file) / contract.putSummary(file, summary, tokens)
shared cache keyed by content hash

//

// Accounting
contract.logTokens(taskId, attempt, purpose, usage) // usage = the API
response's usage object
contract.markAttemptWasted(taskId, attempt)
contract.logSaving(kind, tokensAvoidedEst, note)

connect calls register_agent , starts a heartbeat every 15 s and subscribes to this

agent's rows in instruction , agent , conflict and decision .
For Claude Code workers: packages/mcp exposes the coordination and token-saver
functions as MCP tools ( declare_plan , claim_symbol , release_claim ,
report_change , get_context , find_existing , get_instructions ). The worker script,

not the model, handles connect , heartbeats, pushes and token logging.

11. Worker agents (Claude Code now, Nemotron later)
Each worker is a real Claude Code session running headless on its own laptop and joined
to Contract through the Contract MCP server; Nemotron workers plug into the same
interface later.
Why Claude Code first: we get the logic working before worrying about Nemotron. It also
matches the real product: each teammate's own coding agent joining Contract.
Run: npm run worker -- --id agent-a --task 1 --mode
with_contract|without_contract . The worker script:
1. Registers the agent through the client and creates a git worktree and branch for it.
2. Launches Claude Code headless with the task, the Contract rules and the Contract
MCP server:
claude -p "<task text>" \
--append-system-prompt "<Contract rules, below>" \
--mcp-config .contract/mcp.json \
--permission-mode acceptEdits \
--output-format stream-json --verbose

Contract: Build Handoff and Technical Spec

3. Reads the stream, and at the end records the run's session_id , token usage and cost
through logTokens .
4. In without_contract mode it skips the MCP config, the Contract rules and the edit
hook, so the same script produces the baseline.
Contract MCP tools ( packages/mcp , wrapping the client): declare_plan ,
claim_symbol , release_claim , report_change , get_context , find_existing ,
get_instructions .

Contract rules (appended to the system prompt): before editing, call declare_plan
with the functions you'll modify, create or depend on. Claim before modifying. Call
find_existing before writing any new helper. Prefer get_context over reading whole
files. After changing a function's signature or behavior, call report_change . Check
get_instructions after each step and follow the coordinator's instructions.

Automatic change reporting (hook): each worktree gets a .claude/settings.json with
a PostToolUse hook on Edit|Write that runs contract-hook . It reads the edited file's
path from the hook's JSON input, re-maps that file and calls report_change for any
function whose signature changed. Signature changes are caught even if the agent
forgets; behavior changes rely on the agent for now (or Jev, section 12b).
Early stop and resume: the worker script subscribes to its agent row. When the status
turns paused , it stops the Claude Code process and logs an early_stop saving. When an
instruction arrives, it resumes the same session with claude -p --resume <session_id>
"Coordinator decision: <instruction>. Continue your task." (same flags) and acks

the instruction.
Token logging: with JSON output, Claude Code's result includes the session id, token
usage and total_cost_usd . Log every run and every resume. If a branch is thrown away
or rewritten, call markAttemptWasted .
Determinism: fixed task text and a fixed model ( --model ). Output still varies, so average
3 runs per mode.
Later, the Nemotron swap: add --engine nemotron to the worker script, a Node toolcalling loop on Nemotron that uses the same MCP tools plus file and test tools. The server,
MCP server and dashboard don't change.

Contract: Build Handoff and Technical Spec

12. Coordinator agent (Claude now, Nemotron later)
The coordinator wakes only when a conflict needs reasoning, asks the model for a
decision in a fixed JSON shape, and writes it back; it never edits code.
Run: npm run coordinator . It registers as agent id coordinator and subscribes to
conflict WHERE status = 'open' , or 'escalated' when Jev triage is on (section 12b).

For each conflict:
1. Mark it resolving so it isn't handled twice.
2. Gather context: both agents' active plans and task text, the function's old and new
signature, the change description, and getContext on the function. No whole files.
3. Call decide(prompt, schema) from packages/llm . Today's provider runs Claude
Code headless with structured output: claude -p "<prompt>" --output-format
json --json-schema '<decision schema>' . Calling the Claude API directly also

works; keep whichever we pick behind decide() .
4. Validate the JSON (owner is one of the two agents, instructions are non-empty).
Retry once, then fall back to a rule: the agent that claimed first owns the function.
5. Call resolve_conflict (or dismiss_conflict for a false alarm) and log tokens with
purpose coordination .
packages/llm interface: decide(prompt, jsonSchema) returns { output, usage } ,

and runWorker(task, options) returns { sessionId, usage } . The provider is set by
LLM_PROVIDER in .env : claude-code now, nemotron later (OpenAI-compatible API at
https://integrate.api.nvidia.com/v1 ). Swapping models is a config change.

Prompt outline:
You coordinate AI coding agents on one repo. Two agents have a conflict.
Conflict: {kind} on {symbol_id}
Agent A ({agent_a}) plan: {plan_a}
Agent B ({agent_b}) plan: {plan_b}
Change: {old_signature} -> {new_signature}; {description}
Decide who owns {symbol_id} and give each agent one short, concrete
instruction
that lets both tasks finish without duplicate or conflicting code.
Prefer: reuse over new code, the smallest change, and keeping the change
already made.
Reply with JSON only.

Output format:

Contract: Build Handoff and Technical Spec

{
"action": "resolve",

// or "dismiss"

"owner_agent": "agent-a",
"instructions_a": "Keep the half-up rounding in calculateFee.",
"instructions_b": "Update checkout to expect half-up rounding from
calculateFee; do not round again.",
"reason": "agent-a's task is to change rounding; agent-b only consumes it."
}

12b. Triage with Jev (stretch, build after the MVP)
Jev is the triage nurse and the coordinator is the doctor (Claude now, Nemotron later):
Jev answers quick typed questions in under a second, and the coordinator only steps in
when Jev isn't confident or real reasoning is needed.
Jev is a "System One" model from TypeSafe. Instead of writing text, it takes a block of
state plus typed questions and returns typed answers with calibrated probabilities (a
choice from a list, a numeric score, or a yes/no probability). It's fast and cheap but gives no
explanation, so it decides and the coordinator explains.
The triage process: a new Node process, agents/triage/ , started with npm run
triage . Reducers can't make network calls, so it subscribes to the change , plan and
conflict tables, calls Jev and writes results back through reducers. It is switched off by

default ( TRIAGE=off ); everything must work without it.
The four questions Jev answers:
#

When it runs

Question to Jev

Answer
type

What happens

1

A rule opens
a conflict

Is this a real conflict?
Which fix applies: a_owns ,
b_owns ,
reuse_existing ,
dismiss ? How severe, 0–
100?

yes/no +
choice +
score

Both probabilities ≥ 0.90
→ resolve instantly with
a templated decision.
Otherwise mark it
escalated for the
coordinator

Contract: Build Handoff and Technical Spec

#

When it runs

Question to Jev

Answer
type

What happens

2

An agent
saves a file

For each changed
function: no_change ,
behavior_change or
signature_change ?

choice

behavior_change ≥

3

A plan
creates a new
function

Does this planned
function do the same job
as existing function E?
(asked for the top 10
candidates by name and
type)

yes/no

≥ 0.85 → open a
duplicate conflict.
Replaces the
embeddings stretch goal

4

A plan is
published or
changed

Do these two active plans
make incompatible
assumptions? (asked for
each other agent's plan
that touches nearby
symbols)

yes/no

≥ 0.85 → open a
plan_clash conflict
before any code is
written

0.80 and the agent didn't
report it → triage calls
report_change for the
agent, so Rule 1 still fires

Build order: questions 1 and 2 first; 3 and 4 only if time allows.
Templated decisions: Jev gives a number, not a reason, so auto-resolved conflicts get a
generated reason and instructions, e.g. "Auto-resolved by triage: duplicate of formatDate
(0.94). agent-b: reuse formatDate from agent-a."
Thresholds: start with the values above, keep them in .env , and tune them on rehearsal
runs. Show every Jev answer and its probability in the activity feed so judges see honest
confidence.
Fallback: if we can't get Jev access, point the triage process at a small, fast model through
packages/llm (a fast Claude model now, nvidia/nemotron-3.5-bolt-e4b after the
swap) that returns the same JSON. It works, but its confidence numbers aren't calibrated,
so raise the thresholds.
Pitch line: "Jev triages in milliseconds; the coordinator only thinks when it matters."

Contract: Build Handoff and Technical Spec

13. Dashboard
The dashboard is a single React page that reads everything through live subscriptions; it
never polls and only writes to start or reset a demo run.
Panel

Shows

Subscribes to

Code map

Symbols as nodes, call edges as
arrows. Node color: claimed (agent's
color), changed (pulse), in conflict
(red)

symbol , symbol_edge , claim ,

Agents

One card per agent: owner, laptop,
status (working, paused, done),
current plan summary

agent , plan , plan_item

Activity feed

Newest first: plans, claims, changes,
conflicts, decisions, instructions

change , conflict , decision ,

Token meter

Live tokens per agent and total, split
into useful vs wasted, and a budget
bar

token_usage , agent

Savings
ticker

Tokens avoided by kind: early stop,
reuse, context slice, cache hit

token_saving

Scoreboard

Side by side, without vs with
Contract: total tokens, wasted
tokens, conflicts at merge, duplicate
helpers, tests passing

run , token_usage , conflict

conflict

instruction

Layout: code map large in the center, agents on the left, feed on the right, token meter
and scoreboard along the bottom.
Graph library: React Flow or Cytoscape.js for the code map.
Done when: opening the dashboard on a second laptop shows identical, simultaneous
updates.

14. Demo repo and planted conflicts
The demo repo is a small TypeScript billing app with two tasks that are designed to collide
in two ways: a changed behavior and a duplicate helper.

Contract: Build Handoff and Technical Spec

demo-repo/
src/billing/fees.ts
rounds DOWN today
src/billing/invoice.ts

calculateFee(amountCents: number): number

//

buildInvoice(order): Invoice

//

computeTotal(cart): number

//

uses calculateFee
src/checkout/checkout.ts
uses calculateFee
src/models.ts

Order, Cart, Invoice types

tests/

unit tests per file

tests/integration.test.ts end-to-end: invoice total == checkout total,
half-up rounding
scripts/check-dupes.ts

fails if more than one date-formatting function

exists

Agent A's task (laptop 1): "Add late fees to invoices. Fees must round half-up to the cent.
Show the due date on the invoice formatted like Nov 7, 2026 ."
Agent B's task (laptop 2): "Add a receipt to checkout showing the total with fees and the
order date formatted like Nov 7, 2026 ."
Planted
conflict

Why it happens

Without Contract

With Contract

Changed
behavior

A changes

Both merge cleanly;

calculateFee to

integration.test.ts fails

round half-up; B,
unaware, adds its
own rounding in
checkout

on a one-cent mismatch

Rule 1 fires on A's
report_change ; B
pauses; coordinator
tells B not to round
again

Both need a date
formatter and
neither exists

Two helpers (e.g.
formatDate and
toDisplayDate ); checkdupes fails

Duplicate
helper

Rule 2 fires when B's
plan creates a
formatter that
matches A's planned
one; B is told to reuse
A's

Optional 8090 framing: call it a legacy billing module being modernized by parallel agents.
Reset: npm run reset restores demo-repo to its starting commit and clears run data, so
every demo starts identically.

Contract: Build Handoff and Technical Spec

15. Token savings: features and proof
Token savings is a headline feature, so Contract actively cuts tokens in five ways and
proves the total with a measured with/without run.
Feature

How it saves tokens

Where it lives

How we count it

Early stop

When a conflict
pauses an agent, its
Claude Code process
is stopped, so it stops
generating doomed
code

Worker script stops
the Claude Code
process, then resumes
the session with the
decision

early_stop saving;

Before writing a
helper, the agent asks
findExisting ;
reusing beats
generating a duplicate
plus a later cleanup

Client findExisting
+ Rule 2

Agents get signatures
and summaries of just
the symbols they
touch, not whole files

Client getContext

Shared
summary
cache

A file summarized
once is reused by
every agent until the
file changes

summary_cache table

Cheap-first
coordination

Conflicts are found by
reducer rules for free;
the coordinator LLM
runs only when a rule
fires

Section 8 rules

Reuse lookup

Context slices

estimate = average
completion tokens of a
full coding step in the
baseline run

reuse saving;

estimate = tokens the
duplicate cost in the
baseline run

context_slice

saving = tokens of the
full files minus tokens
of the slice, counted
with a tokenizer
cache_hit saving =

the cached summary's
original generation
tokens
Coordinator tokens
shown separately as
Contract's own cost

With Claude Code workers: token counts come from Claude Code's JSON result for each
run and each resume, so the meter updates when each step finishes rather than token by
token. Jev triage (section 12b) adds a sixth saver: conflicts it resolves confidently never
call the coordinator model ( auto_resolve saving).

Contract: Build Handoff and Technical Spec

Waste tracking: every model call is tagged with task, attempt and purpose. If an attempt
is thrown away or a merge needs fixing, its tokens are marked wasted. The meter shows
useful vs wasted live.
The proof, the with/without experiment:
1. npm run demo -- --mode without_contract --seed 7 : both workers run their tasks
with coordination switched off; the script merges both branches, runs tests and
check-dupes , then has each agent fix failures (purpose merge_fix ).
2. npm run reset , then the same command with --mode with_contract .
3. The scoreboard compares the two runs: total tokens, wasted tokens, merge-fix
tokens, coordinator tokens, conflicts at merge, duplicate helpers, and tests passing.
Honesty rules: headline numbers come only from the measured totals of the two runs.
Per-feature savings are labeled "estimated." Run each mode at least 3 times before
judging and report the average, since model output varies.

16. Build plan
Four parallel tracks meet at one integration point: a scripted end-to-end run of the two
planted conflicts. Fill in names and adjust milestone times to the official submission
deadline.
Role

Owns (sections)

First thing to build

Backend (name: ___)

server/ (6, 7, 8)

Tables + register_agent ,
publish_plan ,
claim_symbol , published
locally

Agents (name: ___)

packages/client ,

The client and Contract MCP
server, then the worker script
that runs Claude Code
headless with token logging

packages/llm , agents/worker

(10, 11)
Coordinator +
mapper (name: ___)

mapper/ , agents/coordinator ,

Dashboard + demo
(name: ___)

dashboard/ , scripts/ , pitch (13,

demo-repo/ (9, 12, 14)

15, 17)

Demo repo + tests, then the
mapper
Live agents + feed panels on
real tables

Contract: Build Handoff and Technical Spec

Milestones (in order):
1. Contracts agreed (first 30 min): table schema, reducer names and the
packages/llm interface frozen; generated bindings committed.
2. Skeletons talk: an agent registers, publishes a plan and claims a symbol; the
dashboard shows it live.
3. Rule 1 end to end: A's report_change pauses B, the coordinator resolves it, B
resumes.
4. Rule 2 end to end: duplicate formatter caught and reused.
5. Without/with runs: both modes run start to finish; token meter and scoreboard filled.
6. Demo-ready: two laptops, fixed seed, three clean rehearsals, backup video recorded,
README written, repo public.
After demo-ready, the Nemotron swap: add the nemotron provider to packages/llm
and the --engine nemotron worker option, then re-run the with/without experiment. It's
needed for the NVIDIA track; skip it if time runs out, since the SpacetimeDB demo works
without it.
MVP checklist (must work for judging):
Demo repo with tests and both planted conflicts
Mapper loads symbols and edges
Plans, claims and changes through reducers
Rules 1 and 2 detect the planted conflicts
Coordinator resolves both; workers pause, take instructions and resume
Token logging on every model call; early stop working
Dashboard: code map, agents, feed, token meter, scoreboard
Without/with runs averaged over 3 runs each
Public GitHub repo with README
Backup demo video
Stretch (only after MVP): the Nemotron swap; Jev triage (section 12b); context slices and
summary cache savings shown live; a developer's own interactive Claude Code session
joining live; a judge-typed third agent task; the 8090 decision-log view.

17. Demo script and pitch lines
Three minutes, two laptops, one before/after story that ends on the token scoreboard.

Contract: Build Handoff and Technical Spec

1. 0:00, hook: "Your team's coding agents are fast, but they're blind to each other. Git
catches text conflicts, not broken assumptions."
2. 0:20, without Contract (pre-recorded or sped up): two agents on two laptops finish
their tasks, merge cleanly, then the integration test fails by one cent and there are
two date helpers. The token meter shows the waste.
3. 1:00, with Contract, live: the code map lights up as Agent A changes calculateFee ;
Agent B's card turns to paused mid-task; the coordinator's decision appears in the
feed; B resumes. The duplicate formatter gets caught the same way.
4. 2:00, scoreboard: side by side, tokens used, tokens wasted, conflicts at merge, tests
passing.
5. 2:30, tech callout: "Every panel is a live SpacetimeDB subscription on two laptops.
Detection runs inside reducers in milliseconds; the coordinator model is only called
when a conflict is real, and with Jev on most conflicts are triaged in under a second."
6. 2:50, close: "Contract isn't another coding agent. It's what lets your team's coding
agents work like a team."
Answers to likely questions:
Isn't this Claude Code for teams? No. Claude Code writes code; Contract writes none.
It's air traffic control for any team's agents.
Can't one agent coordinate its own helpers? Yes, for a solo developer. Contract is for
agents belonging to different people, machines or vendors.
Isn't this Shepherd? Shepherd locks files. Contract tracks interfaces and
assumptions, catching conflicts that merge cleanly.
Does the coordinator cost more than it saves? It runs only when a rule fires; its tokens
are on the scoreboard as Contract's own cost.

18. Rules for coding agents building Contract
Paste this section into your coding agent's instructions (for example CLAUDE.md or
AGENTS.md ) along with your own part's sections.

Contract: Build Handoff and Technical Spec

- You are building one part of Contract. Stay inside your folder; never edit
another
part's folder. Shared types come only from packages/client's generated
bindings.
- Table names, column names, reducer names and arguments are fixed by the
spec
(sections 6, 7, 10). Do not rename them. If one must change, stop and ask
the human.
- Use the official SpacetimeDB TypeScript docs for exact syntax. Do not
invent APIs;
if unsure, check the docs or ask.
- Reducers have no network or filesystem access. Anything calling Nemotron or
reading
files runs in a Node process (agents, coordinator, mapper).
- Every model call (Claude Code now, Nemotron later) goes through
packages/llm, so
tokens are always logged and the provider can be swapped with LLM_PROVIDER.
- Jev triage is optional (TRIAGE=off by default). Everything must work
without it.
- Build the MVP first (section 16). No stretch features until the MVP
checklist passes.
- Prefer simple, readable code over abstractions. This is a 24-hour
hackathon.
- Keep secrets in .env; never commit API keys. The repo will be public.
- After each change, run the part's tests and the end-to-end script if it
exists.

19. Open questions and sources
Check these early tonight; each one could change a plan above.
Does the 3-track limit count SpacetimeDB's main track and ScrabbleBot separately?
(Ask a SpacetimeDB organizer.)
For the Nemotron swap: exact model slugs and rate limits on build.nvidia.com; is the
NVIDIA table handing out extra credits?
Is scheduled reducer syntax in the current SpacetimeDB TypeScript module library
the schedule-table style or the newer onSchedule option?
Official submission deadline and demo format (table judging or stage), which sets the
milestone times.

Contract: Build Handoff and Technical Spec

Do we add 8090 as the third track? If yes, rename the demo repo story to a legacy
migration.
Can we get a Jev (TypeSafe) API key, and what is its exact request format?
Exact field names for token usage in Claude Code's JSON and stream-json output
(check the headless docs).
Sources:
SpacetimeDB TypeScript module library docs
SpacetimeDB TypeScript quickstart
SpacetimeDB v2.8.0 release notes
NVIDIA build: Nemotron 3.5 Lightning 30B A3B
NVIDIA build: Nemotron 3.5 Bolt E4B (tool calling notes)
Why Do Multi-Agent LLM Systems Fail? (MAST)
Tian Pan: why multi-agent LLM systems fail
SoftwareSeni: multi-agent token costs
Augment Code: multi-agent coding failure modes
Product Hunt: Shepherd
Pitch doc: Contract: Live Coordination for AI Coding Agents
Claude Code headless mode
Claude Code hooks guide
DataCamp: Jev, TypeSafe's System One model
Envisioning: System One Model


