# Spec additions: seeing the code as agents write it

Proposed additions to sections 6, 7, 9, 10, 13 and 16, written so Tyler can paste each block into place.

**Why:** the spec covers coordination (plans, claims, conflicts) but not the code itself. The dashboard can say `calculateFee` changed, yet nobody can see the change, which is abstract for judges. These additions also close a gap in Rule 1: it only fires if the agent remembers to call `report_change`.

**Context:** workers now run on the local Claude Code CLI instead of a custom Nemotron tool loop (see `CLAUDE.md`, "Model backend"). With no custom `write_file` tool to instrument, Claude Code **hooks** are the natural way to report edits. As a side effect, the stretch goal of real Claude Code sessions joining becomes cheap, because our own workers already use the same hooks.

---

## A. Live diff stream (MVP; about an hour, split across three owners)

### Section 6 addition: `file_edit` table

```ts
// Live code: one row per Edit/Write an agent makes
file_edit    { id: u64 PK autoInc, agent_id, file, diff,   // unified diff vs the agent's base commit
               symbol_ids: string[],                       // symbols whose bodies the edit touched
               created_at }
```

Add an index on `file_edit.file`.

### Section 7 addition: reducer

| Reducer | Arguments | What it does | Rejects when |
| --- | --- | --- | --- |
| `report_edit` | agent\_id, file, diff, symbol\_ids\[\] | Inserts a `file_edit` row. Keeps only the newest 50 rows per agent so the table stays small | caller isn't that agent's identity |

### Section 10 addition: client API

```ts
contract.reportEdit(file, diff, symbolIds)   // usually called by the hook, not the model
```

### New section 9a: Contract hooks (`agents/hooks/`, owner: agents)

Each worker starts Claude Code with `runAgent({ settings: 'agents/hooks/settings.json', env: { CONTRACT_AGENT_ID: 'agent-a' } })`. The settings file registers:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "node --import tsx <repo>/agents/hooks/post-edit.ts" }] }
    ]
  }
}
```

`post-edit.ts` reads the hook's JSON from stdin (`tool_input.file_path`, `cwd`), then:

1. Runs `git diff --no-color -- <file>` in the worktree to get the diff.
2. Calls the mapper's exported `symbolsTouched(file, changedLines)` to find which symbols the changed lines fall inside.
3. Calls `contract.reportEdit(file, diff, symbolIds)` with `CONTRACT_AGENT_ID` from the environment.
4. Exits 0 and never blocks.

Because the hook reports the edit, the model doesn't have to remember to.

### Section 13 addition: dashboard

| Panel | Shows | Subscribes to |
| --- | --- | --- |
| Live diff | Clicking a code-map node opens the newest diffs touching that symbol, with added and removed lines highlighted and new rows appearing live | `file_edit` |
| Activity feed (extended) | "agent-a edited `fees.ts` (`calculateFee`)" entries alongside plans, claims and conflicts | `file_edit` |

**Demo moment:** laptop 2's screen shows Agent A's rounding change appear in the diff panel, right before Agent B's card switches to paused.

---

## B. Detect signature changes automatically (after milestone 3; owner: coordinator + mapper)

Rule 1 depends on the agent calling `report_change`, and models forget. The mapper can catch signature changes on its own.

### Section 6 change: `change` table

Add one column: `source: 'agent' | 'mapper'`. The dashboard shows mapper-detected changes with an "auto-detected" badge.

### Section 7 addition: reducer

| Reducer | Arguments | What it does | Rejects when |
| --- | --- | --- | --- |
| `report_detected_change` | agent\_id, symbol\_id, old\_signature, new\_signature | Same as `report_change` with `kind = 'signature'` and `source = 'mapper'`, including the Rule 1 check. Does nothing if that agent already reported the same new signature for that symbol | caller isn't the mapper (registered under the fixed id `mapper`) |

### Section 9 addition: mapping worktrees

- `npm run mapper -- --repo ../demo-repo --worktree agent-a=../.worktrees/agent-a --worktree agent-b=../.worktrees/agent-b --watch`
- The base repo keeps feeding `upsert_symbols` as before. **Worktree watchers must not call `upsert_symbols`**, or the shared code map would flip between agents' versions. Instead, on each save a watcher re-parses the file, compares each symbol's `signature_hash` against the base `symbol` row, and calls `report_detected_change` with that worktree's agent id when they differ.
- Behavior changes with an unchanged signature (like rounding) still need the agent to call `report_change`.
- Shortcut if time is short: the post-edit hook from A already knows the agent and the file, so it can run the same hash comparison. The mapper-only check on the reducer then has to be relaxed to allow agent callers.

---

## C. Claim guard; real Claude Code sessions join (stretch, after the MVP checklist)

Once A's hooks exist, this is one more hook script.

### Section 9a addition: PreToolUse guard

```json
"PreToolUse": [
  { "matcher": "Edit|Write|MultiEdit",
    "hooks": [{ "type": "command", "command": "node --import tsx <repo>/agents/hooks/pre-edit.ts" }] }
]
```

`pre-edit.ts` finds the symbols the pending edit touches. If another agent holds an unexpired `claim` on one of them, it exits with code 2 and writes to stderr, for example "`calculateFee` is claimed by agent-a (Alice, laptop-1) for 'add late fees'. Call find_existing or wait for the coordinator." Claude Code blocks the edit and shows that message to the model.

### Joining from any Claude Code session

`npx contract join --id dana --name "Dana"` writes the same hooks into the teammate's `.claude/settings.local.json` and registers the agent. For the demo, a teammate runs plain Claude Code on the demo repo and gets stopped live by a worker's claim. That answers "does this only work with your own agents?" on the spot.

---

## Section 16 changes: build plan

- **Between milestones 2 and 3:** A (backend: `file_edit` + `report_edit`; agents: hooks + `reportEdit`; dashboard: diff panel + feed entries).
- **After milestone 3:** B (coordinator + mapper owner).
- **Stretch, after the MVP checklist:** C, which replaces the MCP server stretch item as the first one to build.
- **MVP checklist, new line:** `- [ ] Live diffs: agent edits appear on the dashboard as they happen`
