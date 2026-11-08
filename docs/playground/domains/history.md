# History, document model, clipboard and persistence

Scope: everything about what the board IS and how it changes over time: the document/scene-graph model (ids, tree, z-order, shape kinds, transforms, styles, text), the command/transaction layer that every edit goes through, undo/redo scoped per actor, copy/cut/paste/duplicate, autosave, JSON export/import, format migrations, named versions, the append-only op log that agents and a future SpacetimeDB backend replay, idempotent op ids, conflict policy and the dirty/sync indicator. Feature IDs are `HISTORY-n`. Gesture mechanics (how a drag computes a delta, snapping, marquee, handles) belong to SELECT; presence, cursors and the agent chat belong to MULTI; this domain only defines what a finished gesture commits to the document and how it is undone. Layer-panel UI belongs to LAYERS if that domain exists; this domain owns the reorder/reparent commands it calls.

## Today

- **Document = one flat React array.** `const [shapes, setShapes] = useState<Shape[]>([])` (`Playground.tsx:43`), mirrored into `shapesRef` for non-React readers (`Playground.tsx:62`). Render order is array order (`shapes.map(...)`, `Playground.tsx:459`), so z-index is implicit array position.
- **Shape type** (`engine.ts:8-24`): `id, kind ('frame'|'rect'|'ellipse'|'text'), name, x, y, w, h, fill`, optional `color, text, fontSize, weight, radius`, plus `owner` (cursor currently editing, a multiplayer outline) and `author` (cursor that made it, used to route chat requests). No rotation, stroke, opacity, visibility, lock, parent, or z key. `owner` is ephemeral presence state living inside the persistent record.
- **Frame membership is geometric and recomputed on the fly**: `inside()` / `frameOf()` (`Playground.tsx:37-39`) pick the smallest frame fully containing a shape. Moving a frame drags "children" found by `inside` at pointer-down (`Playground.tsx:317-318`); deleting a frame deletes them the same way (`Playground.tsx:174-179`). A child that is half outside its frame silently stops being a child. Two overlapping frames make membership ambiguous. Agents place children by absolute coordinates `ox + el.x` (`engine.ts:302`) with no link to the frame (`engine.ts:297`).
- **Every mutation is an ad hoc `setShapes` call**, about 12 sites: create-drag (`Playground.tsx:291`), text create (`303`), per-frame pointermove for create/move/resize (`340,343,349`), pointer-up default size (`358`), delete (`177`), text commit (`466`), chat re-author (`225`), and in the engine `addShape` / `patch` (`engine.ts:191-192`), agent delete (`406`), `clearBoard` (`441-447`) and `reset` (`449-456`). `window.board.addShape/updateShape` (`Playground.tsx:135-147`) is the same path. There is no command object, no before/after capture, no actor on a write.
- **No history at all.** The keyboard handler (`Playground.tsx:171-191`) has Delete/Backspace, Escape, Shift+1, Cmd+0 and tool keys; there is no Cmd+Z/Y, no Cmd+C/X/V/D (it returns early on any meta/ctrl chord at `187`). Escape does not cancel an in-flight drag (`dragRef` is untouched).
- **Per-frame writes**: pointermove calls `setShapes` on every event (`340-350`); the scripted agent `drag` patches every animation frame (`engine.ts:285`) and types a character per `patch` (`311`). Those would each become an undo entry if wired naively.
- **Ids are session-local counters**: `uid()` = prefix + incrementing base36 counter (`engine.ts:48-49`). After a reload the counter restarts at 0, so any persisted `s1` collides with a freshly made `s1`. Two browsers (future multiplayer) collide immediately. Shape names are counted `Rect ${n}` from the current array length (`Playground.tsx:289`), which repeats after deletes.
- **Clipboard**: only `navigator.clipboard.writeText(location.href)` for Share (`Playground.tsx:264`). No paste handler.
- **Persistence**: none. `grep localStorage` finds nothing; refresh loses the board, chat, pins and cursors. No export/import, no version field, no dirty indicator.
- **Chat references layers by id** (`Req.shapeId`, `Msg.shapeId`, pins), so deleting a shape then undoing it must bring back the same id or comment pins break (`engine.ts:27-29`, `389-391`).
- **Spec context** (`docs/SPEC.md` sections 6-7): SpacetimeDB tables are public, flat, keyed by string id or `u64 autoInc`, with `snake_case` columns, and "reducers are the only way anything changes; each runs as one transaction" (`SPEC.md:286-300`, `392-394`). That maps well to one `pg_op` row per op and one `pg_shape` row per shape (see architecture).

## Features

### HISTORY-1: Document store (single source of truth outside React state)
- Priority: P0
- Size: L
- Interaction: No visible UI. Replace `useState<Shape[]>` with a framework-free `DocStore` (new file `dashboard/src/playground/doc.ts`, plain TS like `engine.ts`). React subscribes with `useSyncExternalStore`. The engine, human input, `window.board`, chat actions and remote ops all call `store.dispatch(...)`. Details in the architecture section.
- Acceptance: (1) no `setShapes` calls remain outside a thin compatibility adapter; (2) editing one shape re-renders only that shape's `ShapeView`, not all 200; (3) `window.board.shapes()` still returns a plain array; (4) the board looks and behaves identically to today after the migration.
- Edge cases: engine runs outside React (rAF loop, timers) so reads must be synchronous and never stale (today `shapesRef` can lag a render); React StrictMode double-mount must not double-subscribe; 5,000-shape boards.
- Depends on: HISTORY-5
- Multi-agent note: all actors write through the same store, tagged with an actor id; that tag is what makes per-actor undo possible.

### HISTORY-2: Collision-free stable ids
- Priority: P0
- Size: S
- Interaction: Replace the counter with `${actor}-${random8}` style ids (e.g. `human-k3f9x2ab`, `agent-2-9dd01q7w`), using `crypto.getRandomValues`. Shape ids never get reused; deleted ids stay reserved as tombstones.
- Acceptance: (1) reload, add shapes, no id equals a pre-reload id; (2) two browser tabs creating shapes never collide; (3) ids are valid DOM/CSS tokens and URL-safe; (4) an id restored by undo is the same string.
- Edge cases: `window.board.addShape({id})` with caller-supplied id must be accepted if unused and rejected (or remapped, returning the new id) if taken; ids from imported/pasted JSON are always remapped (HISTORY-19).
- Depends on: none
- Multi-agent note: agent ids already look like `agent-0`; since `spawned` resets on reload (`engine.ts:425`) actor ids must also be made unique per session or per persisted agent identity (flag to MULTI).

### HISTORY-3: Explicit parent/child tree
- Priority: P0
- Size: L
- Interaction: Each shape stores `parent: string | null` (a frame/group id or null for the page root). Children are laid out with coordinates relative to the parent's top-left. Moving a frame is one `set` on the frame, not N writes. Dropping a shape onto a frame at pointer-up reparents it (HISTORY-13); dragging out of every frame reparents to root. The geometric `inside/frameOf` helpers become only a drop-target picker, not a source of truth.
- Acceptance: (1) moving a frame moves its children without writing their x/y (check the op log: one `set`); (2) a child hanging half outside its frame stays a child; (3) deleting a frame removes the subtree as one undoable step; (4) overlapping frames no longer cause ambiguous membership; (5) agents building a template pass `parent: frameId` and relative coordinates.
- Edge cases: cycles (never allow reparenting a node under its own descendant, reject at apply time); frames nested in frames; reparenting a rotated parent's child must preserve its visual position (convert via the parent's transform); `clip` flag for frames (children visually clipped, P1 in SELECT/LAYERS).
- Depends on: HISTORY-1, HISTORY-4
- Multi-agent note: two actors can concurrently reparent the same shape; last-writer-wins per shape for the `(parent,index)` pair (HISTORY-35). Cycles that appear only after merging two concurrent reparents are broken at apply time by re-rooting the later op's target.

### HISTORY-4: Fractional z-order within a parent
- Priority: P0
- Size: M
- Interaction: Siblings are ordered by a string `index` (lexicographic, base62) instead of array position. Insert between neighbors `a` and `b` with `between(a, b)`. New shapes get `after(lastSibling)`. Bring to front / send to back / forward / backward (Cmd+], Cmd+[ owned by LAYERS keys, command defined here) are `move` ops that change only `index`.
- Acceptance: (1) reordering one layer writes one shape, not the whole array; (2) two actors inserting between the same neighbors both survive (ties broken by id); (3) after 1,000 insertions at the same spot index strings stay under ~60 chars or are rebalanced; (4) render order equals sorted `index` per parent.
- Edge cases: empty parent; identical indexes (use id as stable tiebreak and re-spread lazily); rebalance must be a normal op batch so it is replayable.
- Depends on: HISTORY-3
- Multi-agent note: this is the main reason for fractional keys: 12 agents inserting layers into the same frame never need to renumber a shared array.

### HISTORY-5: Command and transaction API
- Priority: P0
- Size: M
- Interaction: One entry point: `store.dispatch(actor, label, ops)` for atomic edits and `store.begin(actor, label, opts)` returning a `TxHandle` (`apply(ops)`, `commit()`, `abort()`) for gestures. A transaction is the unit of undo, the unit of the op log's `tx` field, and the unit a reducer applies atomically. Helpers build ops: `cmd.move(ids, dx, dy)`, `cmd.resize`, `cmd.setProps`, `cmd.create`, `cmd.remove`, `cmd.reparent`, `cmd.reorder`, `cmd.group`, `cmd.paste`.
- Acceptance: (1) every document mutation in the codebase goes through dispatch/begin; (2) a transaction applies all-or-nothing (if one op is invalid, none apply); (3) every committed transaction exposes `{id, actor, label, ops, inverse}`; (4) labels read well in a toast ("Move 3 layers").
- Edge cases: transactions nested by accident (begin inside begin: throw in dev); empty transactions are discarded, not pushed to history; a commit with no net change (dragged and returned to start) is dropped.
- Depends on: HISTORY-1
- Multi-agent note: scripted agents call the same API; the agent's whole `build()` run is many transactions, optionally grouped under one `session` label (HISTORY-18).

### HISTORY-6: Undo and redo shortcuts
- Priority: P0
- Size: M
- Interaction: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z and Ctrl+Y redo (Cmd+Y is not bound on Mac). The key handler's early return for meta/ctrl chords (`Playground.tsx:187`) must run these first. Inside a focused `textarea` or `input` the browser's native undo handles text; the board shortcut is ignored there (the existing guard at `172`), and the text edit commits as one transaction on blur/Enter (HISTORY-8). A new transaction by the same actor clears that actor's redo stack.
- Acceptance: (1) draw a rect, Cmd+Z removes it, Cmd+Shift+Z brings it back with the same id; (2) Ctrl+Y redoes; (3) nothing happens (no error) with an empty stack; (4) a toast "Undid: Draw rectangle" appears; (5) shortcuts work after clicking the canvas and after tool changes.
- Edge cases: key repeat (holding Cmd+Z should step repeatedly but throttled to ~30/s); undo while a drag is in flight aborts that drag first (HISTORY-9); undo during text editing of a layer defers to the textarea.
- Depends on: HISTORY-5, HISTORY-10
- Multi-agent note: your Cmd+Z only touches your own transactions (HISTORY-10).

### HISTORY-7: Coalesce continuous gestures into one entry
- Priority: P0
- Size: M
- Interaction: Pointer-down opens a transaction; pointermove calls `tx.apply` with absolute target values (not deltas), written to the live store so everyone sees motion but not pushed to history; pointer-up calls `commit()`, which records one entry whose inverse is the pre-gesture snapshot of the touched fields. Same for create-drag (`Playground.tsx:288-295` → `358`), move, resize, and the scripted agent's `drag` (`engine.ts:281-288`).
- Acceptance: (1) a drag across 300 pointer events produces exactly one undo step; (2) one undo restores the exact original x/y; (3) creating a rect and sizing it is one step ("Draw rectangle"), and undoing it removes the shape; (4) the op log contains one `create` with final geometry plus no per-frame ops (transient frames are not logged, see HISTORY-34).
- Edge cases: pointer capture lost / window blur mid-drag (commit what exists or abort; recommend abort); a zero-delta click on a shape records nothing; a click-without-drag of the creation tool applies the default size (`Playground.tsx:358`) inside the same transaction.
- Depends on: HISTORY-5
- Multi-agent note: other clients see the transient frames through a lightweight "live" channel and only the commit is durable.

### HISTORY-8: Coalesce typing bursts and nudge runs
- Priority: P1
- Size: S
- Interaction: `begin(..., {coalesceKey})`: a transaction with the same actor + key as the previous one within an idle window merges into it (keeps the first inverse, replaces forward ops with the latest). Text typing: key `text:<id>`, 1000 ms idle; a text-edit session ends on blur/Enter/Escape as one entry regardless. Arrow-key nudges: key `nudge:<ids>`, 500 ms. Property scrubbing (a color picker drag, a slider) uses key `prop:<id>:<field>`.
- Acceptance: (1) typing a sentence then one Cmd+Z removes the burst, not a character; (2) holding ArrowRight for 2 s then one Cmd+Z returns to the start; (3) a pause longer than the window starts a new entry; (4) switching selection ends the run.
- Edge cases: the idle timer must not fire mid-undo; coalescing must never merge across a different actor's intervening transaction on the same shape.
- Depends on: HISTORY-5, HISTORY-7
- Multi-agent note: the scripted agent types character-by-character (`engine.ts:309-312`); wrapping the whole typing loop in one transaction gives one log entry per text layer.

### HISTORY-9: Escape cancels an in-flight gesture
- Priority: P0
- Size: S
- Interaction: Escape during create/move/resize calls `tx.abort()`: the store restores the pre-gesture snapshot of the touched shapes (created shapes vanish), `dragRef` clears, nothing enters history. Escape with no gesture keeps today's behavior (deselect, close popover, `Playground.tsx:180`). Also aborts on `blur`/`pointercancel`.
- Acceptance: (1) start dragging a rect, press Escape, it snaps back and Cmd+Z has nothing new to undo; (2) start drawing a frame, Escape removes it; (3) the pointer-up after Escape does not commit anything.
- Edge cases: Escape pressed during a drag that moved a frame with children (all restored); Escape while another actor is editing the same shape (the abort restores only your touched fields, see HISTORY-11).
- Depends on: HISTORY-7
- Multi-agent note: aborting is local; remote clients simply see the transient shape snap back via the live channel.

### HISTORY-10: Per-actor undo stacks
- Priority: P0
- Size: M
- Interaction: `Map<ActorId, {undo: Tx[], redo: Tx[]}>`. Cmd+Z pops the top of the human's own undo stack, applies its inverse as a NEW transaction attributed to the human (so it enters the op log and syncs; a log is never rewritten). Agents have stacks too (so `board.undo('agent-3')` works for scripts and for HISTORY-18). Cap 200 entries per actor.
- Acceptance: (1) agent builds a card, human draws a rect, Cmd+Z removes the human's rect and leaves the agent's card; (2) a second Cmd+Z with the human stack empty does nothing even though agents have history; (3) redo restores only the human's change; (4) refresh clears stacks (history is session-local, the log persists, see HISTORY-30).
- Edge cases: stack growth in long sessions (cap and drop oldest); actor removed from the board (stack discarded); an undone transaction whose shapes were deleted by someone else (HISTORY-11).
- Depends on: HISTORY-5
- Multi-agent note: this is Figma's model: undo is per client, never rewinds another person's work.

### HISTORY-11: Undo never clobbers other actors (skip superseded fields)
- Priority: P0
- Size: M
- Interaction: Every field carries a stamp `[lamport, actor]` of its last writer. When actor A undoes tx T, each inverse field write is applied only if the field's current stamp equals the stamp T itself produced (nobody wrote it since). Otherwise that field is skipped. If shape no longer exists (deleted by someone else), the inverse op is dropped. If everything is skipped, the toast says "Nothing to undo: changed by Juno" and the entry is removed. Same rule for redo.
- Acceptance: (1) human recolors a rect red; agent then recolors it blue; human Cmd+Z leaves it blue; (2) human moves a card; agent resizes it; human undo restores position and keeps the new size; (3) an agent deleting a shape the human had edited makes the human's undo a harmless no-op; (4) the toast explains skips.
- Edge cases: self-supersession (A's later tx on the same field is fine since A's own later entries are undone first); partial application of a multi-field move; undo of `create` when someone else has since put children inside the new frame (do not delete their work: reparent the foreign children to the frame's parent, then remove).
- Depends on: HISTORY-10, HISTORY-35
- Multi-agent note: with 12 agents editing, "skip if superseded" prevents the classic bug of one Cmd+Z silently reverting an agent's work.

### HISTORY-12: Undo/redo of create and delete using tombstones
- Priority: P0
- Size: M
- Interaction: `remove` never deletes the record; it sets `deleted: true` (a tombstone, subtree implied). Undo of delete emits `restore`. Undo of create emits `remove`; redo emits `restore` again. Delete key on a frame removes the frame and its subtree as one transaction. Tombstones are compacted away by garbage collection (HISTORY-29) once older than the history cap and the sync window.
- Acceptance: (1) delete a frame with 9 children, Cmd+Z restores all with original ids, order and positions; (2) a comment pin referencing a restored shape works again; (3) a chat request sent before delete and handled after undo finds its shape; (4) the layer row reappears at the same z position.
- Edge cases: restore when the parent was also deleted (re-root to the nearest living ancestor else page root); agent `handle()` checking "That layer is gone" must read tombstones as gone (`engine.ts:391`); duplicate-id attempt on a tombstoned id.
- Depends on: HISTORY-3, HISTORY-5
- Multi-agent note: delete beats concurrent edits (HISTORY-35), so a tombstone is also how an agent's late patch to a human-deleted shape is safely discarded.

### HISTORY-13: Undo of reorder and reparent
- Priority: P1
- Size: S
- Interaction: A `move` op `{id, parent, index}` captures both; its inverse is the previous pair. Dropping a shape into a frame while moving it is one transaction: `set x,y` plus `move parent,index`, with x,y recomputed so the absolute position is unchanged by the reparent.
- Acceptance: (1) drag a rect into a frame, Cmd+Z returns it to the root at the same visual spot and z; (2) "Bring to front" then undo restores the old order; (3) sibling order after undo is exactly as before.
- Edge cases: undo when the old neighbor indexes have been rebalanced (we store the old `index` string, so use it directly; ties are tiebreaked by id); old parent now deleted.
- Depends on: HISTORY-3, HISTORY-4, HISTORY-12
- Multi-agent note: if an agent moved the same shape since, field-level rule HISTORY-11 applies to the `(parent,index)` pair as a unit.

### HISTORY-14: Undo of group and ungroup
- Priority: P1
- Size: S
- Interaction: Cmd+G creates a `group` shape (new kind, no fill, bounds computed from children) at the lowest selected child's index and reparents the selected shapes into it in one transaction; Cmd+Shift+G is the inverse (children reparented to the group's parent at the group's index, group removed). Both are single undo steps.
- Acceptance: (1) group three rects, move the group, undo twice returns to the pre-group state; (2) ungroup then undo restores the group with the same id; (3) the children keep their visual positions across group/ungroup.
- Edge cases: grouping shapes from different parents (use the common ancestor, Figma behavior); grouping a rotated shape (rotation stays on the child); empty groups auto-delete when their last child leaves (as a separate op in the same tx).
- Depends on: HISTORY-3, HISTORY-27
- Multi-agent note: a group whose child is concurrently deleted by an agent stays valid; if it ends empty, the empty-group cleanup runs on apply.

### HISTORY-15: Undo of property changes and selection restore
- Priority: P1
- Size: S
- Interaction: Property edits (fill, radius, font size, name, text) are `set` ops with an inverse of previous values. `Tx.sel = {before, after}` records the selection; undo reselects `before`, redo reselects `after` (filtered to shapes that still exist). Selection itself is not an undo entry.
- Acceptance: (1) change fill, select something else, Cmd+Z: the changed shape becomes selected and reverts; (2) undo of create deselects the vanished shape; (3) rapid property scrubbing is one entry (HISTORY-8).
- Edge cases: restored selection includes a shape now owned by another actor (selection is allowed; ownership is MULTI's concern); hidden/locked shapes.
- Depends on: HISTORY-5, HISTORY-8
- Multi-agent note: selection is per-actor local state (MULTI), never written to the shared doc.

### HISTORY-16: Undo/redo UI affordances
- Priority: P1
- Size: S
- Interaction: Two icon buttons in the toolbar (disabled when `canUndo(human)`/`canRedo(human)` is false) and a toast "Undid: Move 3 layers" / "Redid: ..." for ~1.5 s. Tooltips show the next label ("Undo Move 3 layers  Cmd+Z"). Edit menu entries mirror them.
- Acceptance: (1) buttons enable/disable as stacks change; (2) tooltip names the action; (3) clicking works the same as the shortcut; (4) toast does not stack more than one.
- Edge cases: narrow window (buttons collapse into the overflow menu); screen readers announce the toast (aria-live).
- Depends on: HISTORY-6
- Multi-agent note: none.

### HISTORY-17: History panel
- Priority: P2
- Size: M
- Interaction: A "History" tab beside Chat/Layers listing committed transactions newest-first with actor color dot, label, relative time, grouped by actor session. Clicking a human entry undoes back to it (stack-wise); entries by agents are read-only except "Revert this" (HISTORY-18). Hover highlights the touched shapes on the canvas.
- Acceptance: (1) every committed transaction appears within a frame; (2) 500 entries scroll smoothly (virtualized); (3) hover highlights affected layers; (4) filter by actor.
- Edge cases: coalesced entries update in place; compacted history shows "N earlier changes".
- Depends on: HISTORY-5, HISTORY-34
- Multi-agent note: the primary way a human audits what 12 agents did.

### HISTORY-18: Revert an agent's action or session
- Priority: P1
- Size: M
- Interaction: In the history panel (or via a "Revert" link in the chat message "Done: made it bigger") the human applies the inverse of ANY actor's transaction, or of an agent's whole build session (all txs sharing `session`). It is recorded as a new human transaction (so it is undoable and syncs) and follows the skip-superseded rule.
- Acceptance: (1) revert an agent's "made it blue" restores the old fill; (2) revert a whole card build removes the frame and all children as one step; (3) reverting twice is a no-op with a message; (4) the revert itself can be undone.
- Edge cases: the agent is still mid-build (revert pauses it, or marks the session closed so later ops are ignored); later edits by others to the reverted shapes are kept.
- Depends on: HISTORY-11, HISTORY-17
- Multi-agent note: lets a human reject agent work without stopping the agent.

### HISTORY-19: Copy, cut and paste within the board
- Priority: P0
- Size: M
- Interaction: Cmd+C serializes the selected shapes plus their subtrees to an in-memory `ClipboardPayload` (relative to the selection bounding box) and puts it on the system clipboard (HISTORY-20). Cmd+X is copy + delete in one transaction. Cmd+V creates new shapes with fresh ids (all ids remapped, parent references rewritten inside the payload), fresh unique names ("Card copy" style only on collision), appended at the top of the target parent's z-order, then selects them. Pasting twice stacks copies (offset +16,+16 per consecutive paste at the same anchor, resetting on other input).
- Acceptance: (1) copy a rect, paste: a new rect appears at the pointer center, selected; (2) copy a frame with children, paste: whole subtree with new ids; (3) cut then paste moves content; (4) one Cmd+Z removes the whole paste; (5) pasting never reuses an id.
- Edge cases: copying a child without its frame (paste into current frame or root); copying while a text layer is being edited (native copy of the text wins); empty selection (no-op, keeps old clipboard); pasting 500 layers (single transaction, progress not needed).
- Depends on: HISTORY-2, HISTORY-3, HISTORY-5
- Multi-agent note: pasted shapes are authored by the pasting actor; `author` (chat routing) is set to the actor.

### HISTORY-20: System clipboard as JSON plus text fallback
- Priority: P1
- Size: M
- Interaction: On copy, write via `navigator.clipboard.write` (or a `copy` event's `clipboardData`) three flavors: `text/html` containing `<meta data-contract-board="<base64 payload>">` (survives rich paste targets), `text/plain` containing the JSON `{"contract-board":1,...}` (pasteable into any text editor, and parseable by any other tab), and, for text layers only, the layer text as plain text. On paste (the `paste` event, not a key handler, so permissions are free) prefer the html marker, then JSON in plain text, then fall back to HISTORY-24. Falls back to the in-memory payload if the async clipboard API is denied.
- Acceptance: (1) copy in tab A, paste in tab B of the same board app: works; (2) paste the clipboard into a plain text editor: valid JSON; (3) denied clipboard permission: copy/paste still works inside one tab; (4) payloads > 5 MB are rejected with a toast.
- Edge cases: Safari/Firefox async clipboard differences; payload from a newer format version (HISTORY-28 migration or refuse); malicious JSON (validate with a schema, clamp numbers, strip unknown fields, never `dangerouslySetInnerHTML` a pasted text).
- Depends on: HISTORY-19, HISTORY-28
- Multi-agent note: an agent copying/pasting uses only the in-memory payload and never touches the OS clipboard (it would clobber the human's).

### HISTORY-21: Paste at pointer vs paste in place
- Priority: P0
- Size: S
- Interaction: Cmd+V places the payload's bounding box centered on the last pointer position in the viewport (if the pointer is over the canvas; else viewport center). Cmd+Shift+V pastes at the original coordinates (in place), regardless of pointer. If the original spot is occupied by the exact same source shapes, in-place paste is still allowed (copies overlap, like Figma).
- Acceptance: (1) move the mouse to an empty area, Cmd+V: copy lands under the pointer; (2) Cmd+Shift+V: lands exactly on the source; (3) zoomed out to 0.2 the copy still lands under the pointer in world coordinates.
- Edge cases: pointer outside the canvas (use view center); source was cut (in place means the old position); huge payload larger than the viewport (anchor top-left to pointer instead of center).
- Depends on: HISTORY-19
- Multi-agent note: agents choose the anchor explicitly through `cmd.paste(payload, {at})`.

### HISTORY-22: Paste into a frame keeping relative position
- Priority: P1
- Size: M
- Interaction: If a frame is selected when pasting, the payload's top-level shapes become its children, keeping their position relative to the source parent (Figma: paste into selected frame at same relative coordinates; Shift+Cmd+V semantics preserved). Otherwise the target parent is the frame under the paste anchor, else the root. Copying a child out of Frame A and pasting into Frame B places it at the same offset from B's top-left, clamped to stay inside B if it would fall completely outside.
- Acceptance: (1) copy a button at (24,336) inside Card A, select Card B, Cmd+V: button sits at (24,336) inside Card B; (2) its `parent` is B; (3) moving B moves the pasted button; (4) undo removes it.
- Edge cases: target frame smaller than the payload; pasting a frame into itself (allowed, becomes nested child; refuse to paste a node into its own descendant when the payload contains an ancestor of the target); rotated target.
- Depends on: HISTORY-3, HISTORY-19, HISTORY-21
- Multi-agent note: the same command is how an agent copies a component into several screens.

### HISTORY-23: Duplicate (Cmd+D)
- Priority: P0
- Size: S
- Interaction: Cmd+D clones the selection (and subtrees) directly above the originals in the same parent with new ids, offset by (+20,+20) the first time. Repeating Cmd+D repeats the last offset (Figma "repeat transform", P2 refinement). Must `preventDefault` (the browser bookmark shortcut). Does not touch the clipboard. Alt-drag duplicate is a SELECT gesture that calls the same `cmd.duplicate`.
- Acceptance: (1) select a card, Cmd+D: a copy appears offset, selected; (2) one Cmd+Z removes the copy; (3) the clipboard content is unchanged; (4) duplicating a frame duplicates its children with new ids.
- Edge cases: duplicating shapes from multiple parents (each copy goes into its own parent); duplicate at the board edge; names ("Rect 3" → "Rect 4" vs "Rect 3 copy"; choose "name copy", then "name copy 2").
- Depends on: HISTORY-19
- Multi-agent note: none beyond actor attribution.

### HISTORY-24: Paste plain text creates a text layer
- Priority: P1
- Size: S
- Interaction: If the clipboard has `text/plain` that is not a board payload, create a `text` shape at the paste anchor (`fontSize 18`, same defaults as the Text tool `Playground.tsx:303`), width = min(measured, 480) with wrapping, name = first 24 chars. If a text layer is selected and not editing, replace its text instead (one `set`). Multi-line text keeps line breaks.
- Acceptance: (1) paste "Hello" with nothing selected: a text layer appears under the pointer; (2) selected text layer: its text is replaced; (3) 10,000 characters are truncated with a toast; (4) undo removes it.
- Edge cases: whitespace-only paste does nothing; URLs paste as plain text (no auto-link in v1); RTL text; pasted HTML is reduced to plain text.
- Depends on: HISTORY-19, HISTORY-27
- Multi-agent note: none.

### HISTORY-25: Paste an image
- Priority: P2
- Size: M
- Interaction: Pasting `image/*` creates an `image` shape sized to the natural dimensions (max 800 on the long side), stored as a data URL in `ShapeRecord.src` for v1 (flagged: bloats localStorage; move to an asset table/blob store later). Dropping an image file onto the board does the same at the drop point (DnD itself is SELECT's).
- Acceptance: (1) paste a screenshot: an image layer appears; (2) it survives reload if under the size cap; (3) over 2 MB shows "Image too large for local save" and stays in memory only.
- Edge cases: HEIC or SVG with scripts (SVG rendered through `<img>` only, never inline); animated GIF; storage quota.
- Depends on: HISTORY-19, HISTORY-31
- Multi-agent note: the SpacetimeDB version stores a content hash in the row and the bytes elsewhere (open question).

### HISTORY-26: Shape names stay unique and meaningful
- Priority: P1
- Size: S
- Interaction: Replace the "count of same kind + 1" naming (`Playground.tsx:289`) with `nextName(kind)` that scans live siblings for `Rect N` and takes max+1, so names do not repeat after deletes or pastes. Copies get "<name> copy".
- Acceptance: (1) create Rect 1, 2, 3, delete 2, create: "Rect 4"; (2) paste a "Card" gets "Card copy"; (3) names are not required to be unique for correctness (ids are), only for readability.
- Edge cases: concurrent creates by two actors may yield the same name (acceptable).
- Depends on: HISTORY-19
- Multi-agent note: agent templates already name their children; the name is data, not identity.

### HISTORY-27: Shape kinds and shared fields schema
- Priority: P0
- Size: M
- Interaction: Define `ShapeRecord` as a base of shared fields plus a discriminated union per kind (see architecture): `frame | group | rect | ellipse | line | text | image`, shared `name, x, y, w, h, rotation, opacity, visible, locked, parent, index` and style fields. Fields are optional with defaults so old records upgrade cheaply. The union is a TypeScript type plus a `normalize(rec)` that fills defaults and drops unknown fields.
- Acceptance: (1) all existing shapes render unchanged; (2) `normalize` is idempotent; (3) `group` and `line` can be created via the store even before UI exists; (4) every ephemeral field (e.g. `owner`) is absent from records.
- Edge cases: negative w/h from drag (store normalized positive, flipping is a P2 `flipX/flipY`); NaN/Infinity from bad API input (rejected in `dispatch`); extremely large coordinates (clamp ±1e7).
- Depends on: none
- Multi-agent note: agents use only fields in the schema, so `window.board.addShape` unknown keys are dropped with a console warning.

### HISTORY-28: Saved format version and migrations
- Priority: P0
- Size: S
- Interaction: Every persisted/exported/clipboard document begins `{ format: 'contract-board', v: 1, ... }`. `migrate(doc)` runs `MIGRATIONS[v]` functions in sequence up to `CURRENT`. A document with a higher `v` than the app understands is refused for load (not silently downgraded) with a toast and the original left in storage untouched.
- Acceptance: (1) a v1 fixture loads in a v2 build through a migration test; (2) loading an unknown future version keeps the stored data and shows a message; (3) migration functions are pure and unit-tested with fixtures in the repo.
- Edge cases: corrupt JSON (back up the raw string to `…:corrupt:<timestamp>` and start empty); partially valid shapes (drop only the bad ones and report the count).
- Depends on: HISTORY-27
- Multi-agent note: the same migration runs on a backend snapshot.

### HISTORY-29: Compaction and tombstone garbage collection
- Priority: P2
- Size: S
- Interaction: Periodically (on save, if more than 500 tombstones) remove tombstones older than the history window and the last synced op. The op log is compacted into a new snapshot plus a tail (HISTORY-30). Active undo stacks keep the tombstones they reference.
- Acceptance: (1) after deleting 1,000 shapes and compacting, the saved size drops; (2) undo still works for the last 200 entries; (3) an old op replayed against a compacted snapshot is ignored harmlessly.
- Edge cases: another client offline longer than the GC horizon (must full-resync, not merge).
- Depends on: HISTORY-12, HISTORY-30
- Multi-agent note: the horizon is "all connected clients acknowledged" in the backend version.

### HISTORY-30: Autosave to localStorage
- Priority: P0
- Size: M
- Interaction: Subscribe to the store; debounce 400 ms (and flush on `pagehide`/`visibilitychange`); write `contract.playground.board.<boardId>` containing the snapshot (shapes, tombstones, lamport, board meta, camera) plus the last N ops. On mount, load, migrate (HISTORY-28), and hydrate before the first render. A transient (in-gesture) state is never saved, only committed state. Agents' in-progress templates resume? No: scripts restart empty-handed, but their finished work persists.
- Acceptance: (1) draw, reload: board is identical, camera restored; (2) kill the tab mid-drag: the last committed state loads; (3) quota exceeded shows a non-blocking "Could not save: storage full" and keeps working; (4) two tabs on the same board key do not clobber (use the `storage` event to reload or warn "open in another tab").
- Edge cases: private mode where localStorage throws; 5 MB quota (reconsider IndexedDB when snapshots exceed ~2 MB); saving at 60 fps during agent builds (debounce, not throttle); `clearBoard`/`reset` write an empty doc.
- Depends on: HISTORY-1, HISTORY-27, HISTORY-28
- Multi-agent note: agents mid-build at reload lose their script state; their drafted shapes remain (marked `author`), so the board has half-finished frames. Surface as MULTI's concern.

### HISTORY-31: Storage budget and quota handling
- Priority: P1
- Size: S
- Interaction: Measure serialized size on save; warn at 3 MB, refuse growth at 4.5 MB for non-essential payloads (images, named versions) and offer to export JSON. Keep a `history.stats()` for a debug overlay.
- Acceptance: (1) a synthetic 10,000-shape board saves in under 100 ms off the main interaction path (chunked/idle); (2) at quota the toast offers "Export JSON"; (3) images beyond cap are memory-only.
- Edge cases: Safari ITP eviction after 7 days of no use; multiple boards.
- Depends on: HISTORY-30
- Multi-agent note: none.

### HISTORY-32: JSON export and import of the whole board
- Priority: P1
- Size: S
- Interaction: Menu: "Export board (.json)" downloads `<board-name>-<date>.contract.json` with the same document as the save format (shapes, tombstones omitted, versions optionally included). "Import" (file picker and drag-onto-menu) offers Replace (undoable? no: replace creates a pre-import named version automatically) or Merge (all ids remapped, appended at the root offset to empty space). Cmd+Shift+E reserved.
- Acceptance: (1) export then import in a clean profile: identical board; (2) Merge never overwrites existing shapes; (3) importing garbage shows an error and changes nothing; (4) importing a file from a newer version is refused.
- Edge cases: 50 MB files (reject over 20 MB); duplicate import clicks.
- Depends on: HISTORY-28, HISTORY-30
- Multi-agent note: Replace while agents are running first pauses all scripts, applies, then resumes (or confirms with the human).

### HISTORY-33: Named versions and snapshots
- Priority: P1
- Size: M
- Interaction: "Save version" (menu, Cmd+Alt+S) with a name; "Versions" list shows auto-snapshots (before import, before clear board, every 10 minutes while changed, cap 20) and named ones. Restoring a version creates a pre-restore auto version and applies the old state as one transaction attributed to the human (undoable). Versions are stored as `{id, name, ts, actor, lamport, snapshot}` in the save blob (or IndexedDB when large).
- Acceptance: (1) save "v1", delete everything, restore "v1": board is back; (2) restore is itself undoable; (3) versions survive reload; (4) deleting a version asks for confirmation.
- Edge cases: restore while agents are mid-build (their next ops target tombstoned or missing shapes and are discarded); version size accounting against the quota.
- Depends on: HISTORY-30, HISTORY-35
- Multi-agent note: agents can be asked to "checkpoint" before a risky edit via `board.saveVersion(name)`.

### HISTORY-34: Append-only op log and replay
- Priority: P1
- Size: M
- Interaction: Every committed transaction appends `OpEnvelope`s to an in-memory log (`store.log`) with `opId, actor, lamport, ts, tx`. `store.replay(from?)` rebuilds state from a snapshot + log suffix deterministically (same result regardless of arrival order, given the conflict rules). Transient gesture frames are NOT logged; they go to a separate `store.onTransient` channel for presence/live preview. The log is the contract between the browser, `window.board`, agents and the future SpacetimeDB `pg_op` table.
- Acceptance: (1) `replay(log)` over an empty doc yields a deep-equal state to the live store (a unit test on a seeded random op sequence); (2) shuffling concurrent ops from different actors yields the same final state; (3) the log exposes `window.board.log()` for debugging; (4) saving the log tail and reloading continues lamport clocks correctly.
- Edge cases: unbounded growth (cap in memory, compact into snapshot); ops referencing unknown shapes (queue until the create arrives, or drop after timeout); clock skew (lamport, not wall time, orders ops).
- Depends on: HISTORY-5, HISTORY-35, HISTORY-36
- Multi-agent note: an external agent process can append ops over the bridge; the browser applies them with the same `applyRemote`.

### HISTORY-35: Conflict policy (field-level last-writer-wins, delete wins)
- Priority: P0
- Size: M
- Interaction: No visible UI. Policy: (a) per-field LWW using `(lamport, actor)` compared lexicographically, so two actors editing different fields of one shape both win; (b) `(parent,index)` is one atomic pair with its own stamp (per-shape LWW); (c) `remove` beats any concurrent `set`/`move` regardless of stamp, `restore` beats `remove` only if its stamp is newer (so undo-of-delete works but a late edit cannot resurrect); (d) `text` is whole-string LWW in v1; (e) `create` of an existing id is idempotent (a no-op); (f) cycles resolved at apply time (HISTORY-3).
- Acceptance: (1) human recolors while the agent resizes: both changes survive; (2) both set fill: the higher stamp wins deterministically on both clients; (3) agent patch to a deleted shape is dropped; (4) property-based test: applying the same op set in any order converges.
- Edge cases: simultaneous typing in one text layer loses one side's characters (documented; CRDT text is P2 and tied to `runs`); equal lamport (actor id breaks ties).
- Depends on: HISTORY-36
- Multi-agent note: mirrors the project's own conflict rule that reducers serialize writes (`SPEC.md:392-394`); in SpacetimeDB the reducer is the single arbiter and lamport is the server sequence.

### HISTORY-36: Idempotent op ids and remote apply
- Priority: P0
- Size: M
- Interaction: `opId = ${actor}:${seq}` where `seq` is a per-actor monotonically increasing integer persisted with the doc (so it continues after reload). `store.applyRemote(envelopes)` skips any `opId` already in the seen-set (compact form: per-actor high-water mark plus a small set for out-of-order). Undo-generated ops get fresh ids; replays of the same envelope are no-ops.
- Acceptance: (1) applying the same envelope twice leaves state unchanged and does not push history; (2) reload keeps `seq` increasing; (3) out-of-order arrival converges; (4) `window.board` calls that retry (network flake) with the same `opId` are safe.
- Edge cases: seen-set memory (GC by high-water mark); two tabs of the same human actor (give each tab a session suffix: `human.<tab>`).
- Depends on: HISTORY-2, HISTORY-5
- Multi-agent note: agents can retry freely after crashes without double-creating layers.

### HISTORY-37: Dirty and sync indicator
- Priority: P1
- Size: S
- Interaction: A small status pill in the top bar: "Saved" (check, after the last debounce write), "Saving..." (spinner within 400 ms of an edit), "Offline, N changes pending" (when a backend is attached and disconnected), "Synced" with the backend. Click opens a popover with last-saved time and "Export JSON". Warning color on save errors.
- Acceptance: (1) editing flips to Saving then Saved within a second; (2) disabling localStorage shows the error state; (3) the pill does not cause layout shift; (4) accessible `role=status`.
- Edge cases: tab hidden (flush on visibilitychange); two-tab conflict warning (HISTORY-30).
- Depends on: HISTORY-30
- Multi-agent note: with the backend, shows pending outbound op count and per-actor lag in the popover.

### HISTORY-38: Migrate engine, agents and window.board onto the command API
- Priority: P0
- Size: M
- Interaction: Change `createEngine`'s handle from `setShapes/getShapes` (`engine.ts:171-177`) to a `DocStore`. `addShape/patch` become `dispatch(actorId, ...)`; agent `drag` becomes a gesture transaction; agent text typing is one transaction per text layer; `clearBoard` is one `clear` transaction by the human; `window.board.addShape/updateShape` accept an optional `actor`. Keep `window.board.shapes()` returning a flat array in render order. Convert template coordinates to parent-relative (`parent: frameId`, `x: el.x`) instead of `ox + el.x`.
- Acceptance: (1) all existing agent behaviors still work visually; (2) every agent write has `actor = agent-n` in the log; (3) `board.undo('agent-0')` removes its last step; (4) no `setShapes` import remains in `engine.ts`.
- Edge cases: `reset()` and `clearBoard()` race with agents mid-write (stamp-check drops stragglers); engine tests in this repo (if any) updated.
- Depends on: HISTORY-1, HISTORY-3, HISTORY-5
- Multi-agent note: this is the change that makes every other feature in this file true for agents.

### HISTORY-39: Keep ephemeral state out of the document
- Priority: P0
- Size: S
- Interaction: Remove `owner` from `Shape` (`engine.ts:22`); it becomes presence state (`editingBy: Map<shapeId, actorId>`) owned by MULTI, subscribed separately so outlines never enter undo, the log, saves or the clipboard. `author` stays but is derived from the `create` op's actor (`createdBy`) plus an overridable `routeTo` for chat re-routing (`Playground.tsx:225`).
- Acceptance: (1) a persisted/exported board contains no `owner`; (2) Cmd+Z never "un-outlines" a shape; (3) the multiplayer outline still renders while an agent works.
- Edge cases: orphaned owner after an agent is removed (cleared by presence, not by history).
- Depends on: HISTORY-1
- Multi-agent note: shared with MULTI, which owns the presence store.

### HISTORY-40: Transforms (rotation) in the model
- Priority: P1
- Size: M
- Interaction: `rotation` in degrees about the shape's center, `x,y,w,h` describe the unrotated box in parent space. Rotating is a `set rotation` (and a position compensation if the pivot is moved, SELECT's concern). Children inherit via DOM nesting: render a frame as `<div style="transform: translate(x,y) rotate(r)">` containing child divs, which also makes frame moves free.
- Acceptance: (1) a rotated rect's saved x,y,w,h do not change when only rotation changes; (2) a rotated frame's children rotate with it; (3) copy/paste preserves rotation; (4) undo of a rotate restores the exact angle.
- Edge cases: rotation normalized to (-180,180]; hit-testing and bounds (SELECT) need `worldBounds(shape)`; reparenting a rotated child (HISTORY-3).
- Depends on: HISTORY-3, HISTORY-27
- Multi-agent note: agents can set rotation through the same `set` op.

### HISTORY-41: Styles model (fills, strokes, effects)
- Priority: P1
- Size: M
- Interaction: Keep `fill: string` as the v1 shorthand and add `stroke?: {color, width, align}`, `opacity?`, `shadow?`, `blendMode?`. Reserve `fills?: Paint[]` for gradients/images in v2; `normalize` maps `fill` ↔ `fills[0]` so both readers work. Named color styles are P2.
- Acceptance: (1) existing boards render the same; (2) a stroke can be set via the store and rendered; (3) paste keeps all style fields; (4) unknown paint types are preserved on round-trip but rendered as gray.
- Edge cases: agent color tokens ('A' / 'a' resolve at build time already, `engine.ts:293`, stay resolved to hex in the doc).
- Depends on: HISTORY-27
- Multi-agent note: none.

### HISTORY-42: Text content and runs
- Priority: P2
- Size: M
- Interaction: v1: `text` string plus uniform `fontSize, weight, color, align, lineHeight`. v2: `runs: {text, bold?, italic?, color?, size?, link?}[]` replacing `text`; `normalize` converts between them. Text auto-grows height (`autoSize: 'height'|'fixed'`).
- Acceptance: (1) a v1 board loads with `runs` derived; (2) selection-based bold in a text layer writes `runs`; (3) copying a text layer keeps formatting; (4) plain-text export of a layer joins runs.
- Edge cases: concurrent run edits (LWW whole `runs` field; a CRDT is a later feature); emoji/surrogate pairs.
- Depends on: HISTORY-27, HISTORY-35
- Multi-agent note: agents write the `text` shorthand; the store converts.

### HISTORY-43: Time-travel scrubber
- Priority: P2
- Size: M
- Interaction: Over the op log, a timeline slider replays state at time T read-only (a "viewing history" banner, Escape to exit); "Restore this state" saves a version and applies it. Great demo moment: scrubbing back through 12 agents building.
- Acceptance: (1) scrubbing is smooth at 5,000 ops (snapshot checkpoints every 200 ops); (2) editing is disabled while scrubbing; (3) exiting returns to the live state with no loss; (4) agent cursors are hidden in the replay (cursor history not logged).
- Edge cases: compacted prefix (scrub only within retained log).
- Depends on: HISTORY-33, HISTORY-34
- Multi-agent note: shows who did what by tinting entries per actor.

## Data model and architecture implications

### Decisions (recommended)

1. **Flat map with explicit parent pointers and a derived tree** (the Figma/Penpot shape). Store `Map<id, ShapeRecord>`; each record has `parent: id | null` and `index: string`. A `children: Map<parentId|null, id[]>` cache is derived (sorted by `index`, then `id`) and is the only place order is read. Why not a nested tree object: concurrent edits and ops address nodes by id, reparenting becomes one `set`, and rows map 1:1 onto a SpacetimeDB table. Why not today's flat array with geometric membership: membership flips when a layer straddles a frame edge, undoing reparent is impossible (there is nothing to restore), an agent cannot say "put this in that frame" (`engine.ts:297-317` positions by absolute coordinates), and moving a frame touches N rows.
2. **Fractional string index per parent** (not array position). Array order forces whole-list rewrites and conflicts when 12 agents insert at once. Fractional keys give one-row reorders and deterministic merges. Implement a ~40 line base62 `between(a?, b?)` ourselves to avoid a dependency; the `fractional-indexing` npm package is an alternative (open question).
3. **Parent-relative coordinates.** A child's x,y are relative to its parent's top-left, so moving or rotating a frame is one write. Needs `absRect(id)` (walk parents) for hit-testing, snapping, pins and cursors; cache per revision.
4. **Field-level last-writer-wins with tombstones** (HISTORY-35); stamp = `[lamport, actor]` per field.
5. **Per-actor undo that emits new ops** and skips fields superseded by others (HISTORY-10/11). History is a client-side view over the immutable log, never a rewrite.
6. **Ops are the contract**: `OpEnvelope` is what the browser stores, what `window.board` accepts, what agents send and what a SpacetimeDB reducer receives.
7. **Transient vs committed**: gesture frames update the live store and a transient channel; only `commit()` creates log entries, undo entries and saves.

### Types

```ts
// dashboard/src/playground/doc.ts  (new, framework-free)
export type ActorId = string;                 // 'human', 'agent-2', 'api-1' (+ '.tabN' suffix if two tabs)
export type ShapeId = string;
export type Stamp = readonly [lamport: number, actor: ActorId];

export type Kind = 'frame' | 'group' | 'rect' | 'ellipse' | 'line' | 'text' | 'image';

export type Paint = string;                   // '#rrggbb[aa]' | 'transparent' ; Gradient later
export type Stroke = { color: Paint; width: number; align?: 'inside' | 'center' | 'outside' };

export type ShapeProps = {                    // everything LWW'd per field
  name: string;
  x: number; y: number; w: number; h: number; // parent space, unrotated box
  rotation?: number;                          // degrees about center
  opacity?: number; visible?: boolean; locked?: boolean;
  fill: Paint; stroke?: Stroke; radius?: number;
  clip?: boolean;                             // frames
  color?: string; text?: string;              // text layers
  fontSize?: number; weight?: number; align?: 'left' | 'center' | 'right';
  runs?: Run[];                               // P2
  src?: string;                               // image (data URL v1)
  routeTo?: string;                           // chat routing override (was `author`)
};

export type ShapeRecord = ShapeProps & {
  id: ShapeId;
  kind: Kind;                                 // immutable after create
  parent: ShapeId | null;
  index: string;                              // fractional order key among siblings
  createdBy: ActorId;
  deleted?: true;                             // tombstone
  stamps: Partial<Record<keyof ShapeProps | 'place' | 'deleted', Stamp>>; // 'place' = (parent,index)
};

// ---- operations (the atomic, replayable unit) ----
export type Op =
  | { t: 'create'; shape: Omit<ShapeRecord, 'stamps' | 'deleted'> }   // idempotent on id
  | { t: 'set'; id: ShapeId; patch: Partial<ShapeProps> }              // LWW per field
  | { t: 'move'; id: ShapeId; parent: ShapeId | null; index: string }  // reparent/reorder, LWW as a pair
  | { t: 'remove'; id: ShapeId }                                       // tombstone, subtree implied
  | { t: 'restore'; id: ShapeId }                                      // undo of remove
  | { t: 'board'; patch: Partial<BoardMeta> };                         // name, background, etc.

export type OpEnvelope = {
  opId: string;            // `${actor}:${seq}` idempotency key
  actor: ActorId;
  lamport: number;         // logical clock; server sequence once a backend exists
  ts: number;              // wall clock, display only
  tx: string;              // transaction id (groups ops for undo/atomic apply)
  session?: string;        // optional: agent build session, for HISTORY-18
  body: Op;
};

// ---- transactions (the unit of undo) ----
export type Tx = {
  id: string; actor: ActorId; label: string;      // 'Move 3 layers'
  ops: Op[]; inverse: Op[];                       // inverse captured at commit from prior values
  produced: Array<{ id: ShapeId; field: string; stamp: Stamp }>; // what this tx wrote (for skip-if-superseded)
  coalesceKey?: string; ts: number;
  sel?: { before: ShapeId[]; after: ShapeId[] };
  session?: string;
};

// ---- store ----
export type DocState = {
  rev: number;                                    // bumps on any change (used by useSyncExternalStore)
  shapes: ReadonlyMap<ShapeId, ShapeRecord>;      // immutable records, structurally shared
  children: ReadonlyMap<ShapeId | null, readonly ShapeId[]>; // derived, sorted by (index,id)
  lamport: number;
};

export interface DocStore {
  getState(): DocState;
  subscribe(l: () => void): () => void;                       // whole doc
  subscribeShape(id: ShapeId, l: () => void): () => void;     // per-shape (fine-grained re-render)
  dispatch(actor: ActorId, label: string, ops: Op[], o?: { coalesceKey?: string; sel?: Tx['sel']; session?: string }): Tx | null;
  begin(actor: ActorId, label: string, o?: { coalesceKey?: string; session?: string }): TxHandle;
  undo(actor: ActorId): boolean; redo(actor: ActorId): boolean;
  canUndo(actor: ActorId): boolean; canRedo(actor: ActorId): boolean;
  applyRemote(env: OpEnvelope[]): void;                       // idempotent, order-insensitive
  log(): readonly OpEnvelope[];
  snapshot(): SavedBoard; load(b: SavedBoard): void;
  onTransient(l: (e: TransientFrame) => void): () => void;    // live gesture frames for MULTI
}
export interface TxHandle {
  apply(ops: Op[]): void;      // writes live; base values for the inverse are captured on first touch
  commit(): Tx | null;         // null if net change is zero
  abort(): void;               // restore base values, record nothing
}
```

Op semantics are pure: `applyOp(state, env) -> state'` using stamps. `dispatch` = assign `opId/lamport`, `applyOp`, append to log, push `Tx` on the actor's undo stack (clearing its redo). `undo(actor)` = pop Tx, build forward ops from `inverse` filtered by stamp rule, `dispatch` them as a new Tx whose own inverse goes to the redo stack.

### Render and React subscription

- `useDoc<T>(selector, eq?)` wraps `useSyncExternalStore(store.subscribe, () => selector(store.getState()))`. `useShape(id)` uses `subscribeShape` so a drag re-renders one `ShapeView` (already `memo`, `Playground.tsx:602`). `useChildren(parentId)` returns the derived array; frames render their own children recursively (`<ShapeView>` renders `children.map(...)` inside its transformed div) so DOM nesting equals the tree, giving free group moves/rotation/clipping.
- Records are immutable: `set` creates a new record object only for the touched shape and a new `Map` (copy-on-write via a persistent helper or `new Map(old)` for under ~5k shapes). `rev` increments once per transaction apply and once per gesture frame, batched with `queueMicrotask` so a 100-op paste renders once.
- The legacy flat view for `window.board.shapes()` and chat context labels (`ctxLabel`, `Playground.tsx:40`) is a memoized `flatten(state)` in z-order, built once per `rev`.
- `shapesRef` and `setShapes` disappear; `getShapes` in the engine becomes `store.getState()`.

### Per-actor undo scoping

```
undoStacks: Map<ActorId, { undo: Tx[]; redo: Tx[] }>
undo(A):
  T = pop(undo[A])
  fwd = []
  for op in T.inverse:
    set:     keep only fields f where stamp(shape,f) == T.produced[(id,f)].stamp   // no one wrote it since
    move:    keep if stamp(shape,'place') == T.produced stamp
    restore/remove/create: keep if target exists (restore: re-root if parent gone)
  if fwd empty: toast "Nothing to undo: changed by <actor>" ; return
  U = dispatch(A, 'Undo ' + T.label, fwd)         // new ops, new stamps, normal log entry
  push(redo[A], T-with-U's-produced-stamps)
```
Agents get stacks for free (same code path). The human's Cmd+Z uses actor `human`. "Revert agent action" (HISTORY-18) is `undoTx(humanActor, otherActorsTx)`: same filter, different owner.

### Gesture lifecycle (what SELECT calls)

`pointerdown` → `h = store.begin('human', 'Move 3 layers')`; `pointermove` → `h.apply(ops(absolute targets))` (first touch records base values); `pointerup` → `h.commit()`; `Escape`/`pointercancel`/`blur` → `h.abort()`. Typing: `begin(..., {coalesceKey:'text:'+id})` per edit session. `onTransient` publishes `{actor, tx, patches}` frames at most once per animation frame for MULTI to broadcast.

### Persistence and format

```ts
export type SavedBoard = {
  format: 'contract-board'; v: number;          // CURRENT = 1
  boardId: string; name: string; savedAt: number;
  lamport: number; seq: Record<ActorId, number>;  // so ids/opIds continue after reload
  shapes: ShapeRecord[];                         // includes recent tombstones
  logTail?: OpEnvelope[];                        // last ~500 ops
  versions?: NamedVersion[];                     // HISTORY-33
  view?: { x: number; y: number; z: number };    // camera
};
const MIGRATIONS: Record<number, (d: any) => any> = { /* 1: v1 -> v2 ... */ };
```
Keys: `contract.playground.board.<boardId>`, plus `contract.playground.index` (list of boards) later. Chat messages, pins and cursors are MULTI's to persist through a `extras` slot in `SavedBoard` (`extras?: Record<string, unknown>`); this domain provides the container only.

Clipboard payload: `{ 'contract-board': 1, kind: 'selection', origin: {parent, bbox}, shapes: ShapeRecord[] (ids local to payload, stamps stripped) }`.

### Mapping onto SpacetimeDB (so we do not rework later)

New tables (prefix `pg_` so they cannot clash with the spec's names; the spec says table names are fixed, so these are additions, not renames; confirm with the human):

```
pg_board  { id: string PK, name, v: u32, lamport: u64 }
pg_shape  { id: string PK, board_id, kind, parent: string?, index: string, deleted: bool,
            created_by, props_json: string /* ShapeProps */, stamps_json: string }
pg_op     { op_id: string PK, board_id, actor, lamport: u64 autoInc-by-reducer, ts, tx, session?, body_json }
```
One reducer `pg_apply(board_id, envelopes_json)` runs the same pure `applyOp` (shared from a package, since reducers have no I/O but can run pure TS) inside the transaction, inserts `pg_op` rows (the PK makes duplicates reject idempotently) and updates `pg_shape`. Clients subscribe to `pg_shape` and `pg_op` and feed them to `store.applyRemote`. `props_json` keeps one row per shape; field stamps live in `stamps_json` (hot fields x/y/w/h could become real columns later if subscription diffs get noisy). Because `applyOp` is pure and order-insensitive, the local-only version and the backed version share all logic.

### Cross-domain contracts

- SELECT: calls `begin/apply/commit/abort`; never `setShapes`. Provides drop-target (`frameAt(point)`) for reparent.
- MULTI: owns presence (`owner` replacement), the transient channel consumer, actor id allocation, and persisted chat; consumes `OpEnvelope.actor` to color history entries and outlines.
- LAYERS (if present): calls `cmd.reorder`, `cmd.reparent`, `cmd.group`, `cmd.setProps({visible,locked,name})`.
- Agents/engine: receive `DocStore` and an `actorId`; template children created with `parent: frameId`.

## Open questions

1. **Parent-relative vs absolute child coordinates.** Recommend relative (HISTORY-3). It changes every hit-test, pin and cursor coordinate computation (need `absRect`) and the agent templates. Confirm before SELECT builds hit-testing.
2. **Own fractional-index helper vs the `fractional-indexing` npm package.** Recommend writing ~40 lines in `doc.ts` (no new dependency). Package is fine if the team prefers tested code.
3. **Should undo force-apply or skip superseded fields?** Recommend skip (HISTORY-11) so a human undo never reverts an agent. Figma-style force would be simpler to explain.
4. **Should the human be able to Cmd+Z agents' work?** Recommend no (Cmd+Z is human-only); use "Revert" in the history panel (HISTORY-18).
5. **Persist agents' half-built work and chat?** Recommend persist finished and half-built shapes but restart agent scripts empty; persist chat/pins through MULTI's `extras`. Alternative: clear everything on reload for the demo.
6. **localStorage vs IndexedDB.** Recommend localStorage for v1 (simple, synchronous at `pagehide`), IndexedDB (via small wrapper, no library) once images or versions pass ~2 MB.
7. **Images: data URLs in the doc or a blob/asset store.** Recommend data URLs capped at 2 MB for the hackathon, hash + external store for the backend.
8. **SpacetimeDB table names.** `docs/SPEC.md` freezes table names; confirm `pg_board/pg_shape/pg_op` as additions and whether the playground backend lives in the main module.
9. **Lamport source with a backend.** Recommend the reducer assigns the sequence (server order is the truth), clients use provisional local lamports and rebase on ack.
10. **Collaborative text editing.** Recommend whole-string LWW in v1 and a text CRDT (or per-run LWW) only if two actors typing into one layer becomes a demo scenario.
11. **History limits.** Recommend 200 transactions per actor, 500 ops in the persisted log tail, 20 versions; adjust if memory or quota bites.
12. **Same human in two tabs**: separate actors (`human.a`, `human.b`) with separate undo, or one shared? Recommend separate, with a warning banner on the second tab.
