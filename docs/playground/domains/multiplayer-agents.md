# Multiplayer presence, agents, comments and chat

Scope: everything about WHO is on the board and HOW they talk to each other. MULTI covers presence (cursors, colours, selection and lock outlines, follow, minimap viewports, scale). AGENT covers the structured command/event protocol that replaces the ad-hoc `window.board`, the agent state machine, inbox, claims, coordination, observability and the scripted-vs-LLM seam. COMMENT covers pins, threads, mentions, the per-agent chat and the message types. Canvas mechanics (hit-testing, transforms, snapping, layer tree) belong to CANVAS/SELECT. Undo/redo stacks belong to HISTORY; this doc only states what per-actor undo needs from us (see AGENT-24). The board is meant to become the visual front end of Contract (`docs/SPEC.md` sections 1-5, 10): playground agents map to Contract `agent`, board regions/frames map to `claim`, two agents wanting one frame map to `conflict` (kind `claim_contention`), and the coordinator ruling shows up as a chat card.

## Today

Cursors and agents (`dashboard/src/playground/engine.ts`):
- `CursorMeta = { id, name, color, kind: 'human'|'agent'|'api', status: string, paused }` (engine.ts:31-32). Status is a free string such as `"drawing button"` (engine.ts:301). There is no status enum, so nothing can be filtered, sorted or iconised.
- Colours and names come from fixed 12-entry arrays (engine.ts:51-52), assigned by spawn index (engine.ts:358-360). They wrap after 12; wrapped names get a numeric suffix. There is no collision handling for humans.
- Cursor motion is a local tween: `moveTo` eases between points with a random bend (engine.ts:222-231), `tick` advances all tweens per frame (engine.ts:234-250). Remote positions are not interpolated because there are no remote positions yet; the human cursor is painted from `engine.human` (Playground.tsx:96-98).
- Cursors are painted straight to DOM transforms inside a rAF loop, no React render (Playground.tsx:89-110). This is a good base for 50+ cursors. The cursor label shows `name · status` (Playground.tsx:536).
- Lock/edit state: `Shape.owner` is "cursor id currently editing it" (engine.ts:22). Agents set it while drawing or editing (engine.ts:297, 307, 317, 404) and clear it after. It is an outline hint only; nothing prevents the human dragging an owned shape. `Shape.author` records who made it and drives routing (engine.ts:23).
- Agent control is a pair of tokens (`alive`, `paused`) per agent (engine.ts:42, 183). `setPaused` (engine.ts:433), `removeCursor`/`stopScript` (engine.ts:204-219), global `speed` (engine.ts:187, 464). There is no per-agent speed, no stop-one-and-keep-cursor, no priority.
- Inbox: `inbox: Map<agentId, Req[]>`, `Req = { text, shapeId?, ctx?, pin? }` (engine.ts:29, 179). `request` pushes (engine.ts:361-370), `serve` drains FIFO between steps (engine.ts:372-384), `handle` parses a note with regex `parseEdit` and performs it (engine.ts:386-412). No priority, cancel, op ids, acknowledgement, or "I am busy, queued behind 2" feedback. Requests to API cursors or removed agents silently resolve the pin (engine.ts:362-365).
- `window.board` (Playground.tsx:132-148) exposes `spawnAgent, addCursor, moveCursor, press, removeCursor, addShape, updateShape, shapes, cursors`. There is no actor id on mutations, no delete, no select, no comment, no say, no events, no batching, no idempotency. `addShape` always applies and returns an id.
- Claims/conflicts: none. Agents choose grid slots (`claimSlot`, engine.ts:273-279) which is the only region reservation, and it is purely internal.
- Agent "thinking": a fixed 350 ms wait with status `"reading your note"` (engine.ts:387-388). No LLM yet, no token or cost accounting, no latency.

Comments and chat (`Playground.tsx`, `ChatPanel.tsx`):
- `Pin = { id, n, shapeId, dx, dy, thread, done }` (Playground.tsx:11). Pins are anchored only to a shape with an offset, so they follow the shape when it moves (Playground.tsx:484-497, positioned from `shapeById`). If the shape is deleted the pin renders `null` (Playground.tsx:487) and silently disappears; the chat message stays with a dead "Show on board" link. No canvas-point pins, no replies, no reopen (a pin is `done` once the agent finishes, engine.ts:390, never by a human), no mentions, no filter list. Pin numbering uses a counter (`pinCount`) that resets only on remount.
- Routing: `routeFor` picks the shape's `author`, else its frame's `author`, else the nearest live agent, else `general` (Playground.tsx:195-208). `send` claims unowned layers for the nearest agent (Playground.tsx:221-225), and in `general` picks a RANDOM live agent and posts a fake "Claude" line "Routing that to X" (Playground.tsx:226-233). The router is a hard-coded heuristic, not an inspectable decision.
- Chat: `Msg = { id, thread, from, name, color, text, ctx?, pin?, shapeId?, t }` (engine.ts:27). Message type is implicit (only text). Threads are the agent ids plus `general` (ChatPanel.tsx:6, 66-78). Unread is computed as "count of non-you messages minus last seen count" (ChatPanel.tsx:29-36, 68), which breaks when messages are deleted or paged. No typing indicator, no thinking placeholder, no action card, no undo button, no approval, no search/export. The composer sends on Enter (ChatPanel.tsx:128); there is no `aria-live` region, no focus hand-off with the board (Esc goes to canvas shortcuts, Playground.tsx:154-155 returns early only for input/textarea/select targets).
- Presence UI: avatar stack caps at 8 with `+N` (Playground.tsx:403-404, a native `title` tooltip only), right panel lists cursors with status text (Playground.tsx:555-575). No follow, no viewports, no minimap, no join/leave toasts (the `toast` state exists, Playground.tsx:61, used for other purposes).
- Persistence: all of it is `useState`, lost on reload; `engine.reset()` on unmount wipes everything (Playground.tsx:79-81).

## Features

### MULTI-1: Live cursors with name and tool-state glyph
- Priority: P0
- Size: M
- Interaction: every actor's cursor shows an arrow in their colour plus a tag `Name` and a 14px glyph for the current tool (select arrow, rect, ellipse, text caret, comment bubble, hand, pen). For agents the glyph is replaced by the status icon from AGENT-8 and the tag shows the short status word. Tags render at constant screen size regardless of zoom (cursor arrow at 100%, not scaled). Tag expands to show the full status (`drawing button`) on hover or when the actor is followed; otherwise it shows name only after 2 s of motion to reduce clutter.
- Acceptance: human cursor shows the comment bubble while the comment tool is active (as today, Playground.tsx:531); agent tag shows an icon plus status; cursor size is the same at zoom 0.1 and 4; tag text never overflows its pill (ellipsis at 18 chars).
- Edge cases: cursor at the viewport edge (tag flips to stay on screen); two cursors at the same point (tags stack, see MULTI-22); zoomed far out with 50 cursors (arrows only, tags only for the hovered/followed/selected-agent cursor).
- Depends on: MULTI-3, AGENT-8, CANVAS tool model.
- Multi-agent note: agent cursors are never hidden by "pointer is outside the canvas", because agents have no real pointer; they are always visible while their status is not `offline`.

### MULTI-2: Remote cursor smoothing and interpolation
- Priority: P0
- Size: M
- Interaction: remote positions arrive at 20-60 Hz as `{x, y, t}` samples in world units. The renderer keeps the last 3 samples per actor and renders at `now - 100 ms` (a fixed interpolation delay) with linear interpolation, falling back to critically damped smoothing (time constant ~60 ms) when samples are late, and to short extrapolation (max 150 ms) never beyond. Local scripted agents (today's tween, engine.ts:222) keep their own easing and publish through the same path so remote viewers see the same motion. Positions are in world coordinates, converted to screen per frame (as Playground.tsx:96-98).
- Acceptance: with a simulated 20 Hz feed and 80 ms jitter the cursor never visibly steps or jumps backward; a teleport (jump > 2000 world units, e.g. after "jump to agent") snaps with a 150 ms fade instead of a sweep; CPU stays below 8% with 50 cursors on a 2021 laptop.
- Edge cases: tab backgrounded (rAF stops; on return snap to latest, no replay); clock skew between clients (use sample sequence numbers and arrival time, never wall-clock difference); same actor on two tabs (second tab is a distinct session id, see MULTI-24).
- Depends on: MULTI-18, MULTI-16.
- Multi-agent note: an LLM agent may send a position only when it acts (a few Hz). The renderer must treat sparse samples as intent and glide between them using the same easing as scripted agents, so LLM and scripted cursors look alike.

### MULTI-3: Per-user colour assignment
- Priority: P0
- Size: S
- Interaction: colours come from a 12-colour palette with enough contrast on white and on the dotted background (today COLORS, engine.ts:52). Assignment picks the least-used palette entry among current actors, never reusing a colour while an unused one exists; humans get first pick over agents. Beyond 12 actors, colours are generated by rotating hue in golden-angle steps with fixed saturation/lightness and a second differentiator (a letter badge on the tag). A user's colour is sticky for the session (rejoin gets the same colour if still free). Human can change own colour from the avatar menu (P2).
- Acceptance: the first 12 actors have 12 distinct colours; actor 13 and 14 are visually distinct from all others (hue delta >= 20 degrees); every colour has contrast >= 3:1 against `#ffffff` for the tag text (white on colour) or the tag switches to dark text.
- Edge cases: colour-blind palettes (tag always has name, selection outlines always have a corner label, so colour is never the only channel); a human whose colour equals the board accent; reload (sticky via actor id).
- Depends on: MULTI-5.
- Multi-agent note: agents' colours also colour their chat bubbles, pins and claim regions, so the colour is the one visual key that ties all three together.

### MULTI-4: Avatar stack with overflow
- Priority: P1
- Size: S
- Interaction: top bar shows up to 5 overlapping circular avatars (initial, colour, a status ring for agents: green idle, blue working, amber waiting, red blocked). A `+N` chip opens the presence list (MULTI-5). Hover shows a custom tooltip with name, role, status line. Click on an avatar follows that actor (MULTI-9); click on `+N` opens the list. Humans sort before agents, then by recent activity. Today: 8 avatars and a native title (Playground.tsx:403-404).
- Acceptance: with 30 actors the stack shows 5 + `+25`; hovering an avatar shows a tooltip within 150 ms; the status ring colour matches the cursor tag state.
- Edge cases: 1 actor (no stack, just "you"); long names; actor list changing under the pointer while hovered (tooltip must not flicker).
- Depends on: MULTI-5, AGENT-8.

### MULTI-5: Presence list with status
- Priority: P0
- Size: M
- Interaction: right panel section "On the board" (replaces today's Cursors list, Playground.tsx:555-575) with groups: You, People, Agents. Each row: avatar, name, status word and one-line detail (`drawing "Button" in Profile card`), a mini token/cost chip for agents (AGENT-28), and a row menu (follow, jump to cursor, pause/resume, stop, open chat, mute). Rows animate in/out. Filter box and "show only working" toggle. Click row = jump to actor (AGENT-20); double click = follow.
- Acceptance: statuses update within 250 ms of change; stopping an agent removes it from "working" and shows it as `stopped` (greyed) until dismissed; list is virtualised and stays 60 fps with 200 rows.
- Edge cases: 200 agents (virtualised, grouped by state); name collisions (suffix `2`, as engine.ts:359); an actor that left mid-hover.
- Depends on: AGENT-8, MULTI-3, MULTI-16.

### MULTI-6: Selection outlines in each user's colour
- Priority: P0
- Size: M
- Interaction: when an actor selects shapes, every other client draws a 1.5px outline in that actor's colour on the selected shapes plus a small corner pill with the actor's name (tag below the bottom-left corner). The local selection keeps the brand-blue handles; remote selections never show resize handles. Multi-selection draws a single dashed bounding box in addition to per-shape outlines (outlines capped at 50 shapes, beyond which only the bounding box shows). Outline is hidden if the actor's selection becomes empty or the actor goes idle > 60 s (MULTI-12).
- Acceptance: agent selects a layer via the `select` command and the human sees the coloured outline within 250 ms; two actors selecting the same shape show two stacked outlines (offset 3px, second one dashed); outline follows the shape while it moves.
- Edge cases: shape inside a collapsed frame (outline on the frame); selection of 5000 shapes (bounding box only); shape deleted by another actor while selected (outline fades, the actor's selection drops the id and emits `selection.changed`).
- Depends on: AGENT-1 (select command), SELECT domain.
- Multi-agent note: when an agent "selects" it is a declarative presence signal, not an input focus. It must also make the shape's hover card show "Iris is looking at this".

### MULTI-7: "Editing" lock outlines
- Priority: P0
- Size: S
- Interaction: while an actor is mid-mutation on a shape (dragging, resizing, text-editing, or an agent command with `holdMs`), the shape gets a thicker outline in their colour plus a pencil badge and name pill. Today this is `Shape.owner` (engine.ts:22) set by agents only. It becomes a first-class `lock` record (see data model) with a TTL (default 4 s, refreshed while active, auto-released on disconnect). Locks are display state; enforcement is in MULTI-8.
- Acceptance: when the agent builds a button the button shows Iris's outline for the duration of the draw and clears afterwards; if the agent is stopped mid-draw the outline disappears within 1 s (as `stopScript` clears owner, engine.ts:211); a human text edit shows the same badge to everyone else.
- Edge cases: lock holder crashes (TTL cleans up); lock on a frame covers its children visually but not their individual locks; nested locks (agent editing a child while human drags the parent, see MULTI-8).
- Depends on: AGENT-1, MULTI-8.

### MULTI-8: Soft lock: two actors cannot drag the same shape
- Priority: P0
- Size: M
- Interaction: the first actor to start a drag/resize/edit on a shape holds the soft lock (`LockRecord`, with `since` timestamp). A second actor who tries to start on the same shape gets: (a) for human: the shape shows a "Iris is editing" chip, the cursor shows a not-allowed variant, the drag does not start; click still selects. (b) for an agent command: the command returns `{ ok: false, error: 'locked', holder, retryAfterMs }` and the agent's status becomes `waiting` (AGENT-8) until it retries. Tie on the same frame: the lower `seq` (server-ordered) wins, never wall-clock. A human can "take over" with Alt+drag, which revokes the agent's lock after a 600 ms confirmation toast with Undo; humans always win against agents, agents never win against humans.
- Acceptance: two scripted agents asked to move the same shape do not both move it; the loser logs a blocked line in its chat and retries after the holder releases; human Alt+drag on an agent-held shape takes over and the agent receives a `lock.revoked` event.
- Edge cases: lock held through a disconnect (TTL 4 s, then released); drag of a parent frame while the agent holds a child (parent drag moves the child; child lock is a conflict only for child-direct edits); two humans (same rule, loser sees a toast).
- Depends on: MULTI-7, AGENT-2, AGENT-12.
- Multi-agent note: this is the board-level twin of Contract's `claim_contention` (SPEC section 8, rule 3). A repeated lock denial between two agents on the same frame escalates to a `conflict` (AGENT-13).

### MULTI-9: Follow a user
- Priority: P1
- Size: M
- Interaction: click an avatar (or `Follow` in the row menu) to lock your viewport to theirs. Your viewport lerps to match theirs each frame (zoom and pan) with a 120 ms ease. A banner at the top reads `Following Iris` with a close button, in their colour, with a coloured border around the whole canvas. Any manual pan/zoom/scroll by you exits follow (except dragging a shape). Esc also exits. Following an agent follows its cursor with a configurable lead: default "center cursor, keep zoom", optional "match agent viewport" (agents publish a nominal viewport of ~1200x800 world units around their work).
- Acceptance: following a human reproduces their pan/zoom within one frame of latency; wheel input exits follow; following an agent keeps its cursor within the central 40% of the screen.
- Edge cases: followed actor leaves (banner changes to "Iris left", exits after 2 s); mutual follow (A follows B follows A: stop both with a toast); follow while a popover is open (popover closes).
- Depends on: MULTI-24 (viewport broadcast), MULTI-2.

### MULTI-10: Spotlight (present to everyone)
- Priority: P2
- Size: M
- Interaction: a human can start "Spotlight me"; every other client sees `Bryan is presenting, Follow?` and by default auto-follows until they interact. Ends on stop or after the presenter is idle 5 min.
- Acceptance: starting spotlight prompts all clients; a client that dismisses it is not forced again for that session.
- Edge cases: two simultaneous presenters (latest wins, previous gets a toast); observers (MULTI-15) auto-follow by default.
- Depends on: MULTI-9.

### MULTI-11: Viewport rectangles on the minimap
- Priority: P1
- Size: M
- Interaction: the minimap (CANVAS domain) draws each actor's viewport as a 1px rectangle in their colour with a small initial dot; the local viewport is the filled brand-blue rect. Clicking a rectangle in the minimap follows/jumps to that actor. Agents' nominal viewports are drawn dashed. With > 12 actors only the hovered/followed/working ones draw as rectangles; the rest are dots.
- Acceptance: panning a second client moves its rectangle on the first client's minimap within 250 ms; 50 actors still render at 60 fps; clicking a rectangle jumps there.
- Edge cases: viewport larger than the minimap bounds; actor off the board extents (clamped arrow).
- Depends on: MULTI-24, CANVAS minimap.

### MULTI-12: Idle and away fading
- Priority: P1
- Size: S
- Interaction: after 30 s without input a human's cursor fades to 40% opacity and the tag appends `idle`; after 5 min it becomes `away` (cursor hidden, avatar greyed, presence list shows "away 5m"). Returns instantly on input. Agents have no "away"; their equivalent is `idle` (AGENT-8) and they keep a visible resting cursor at their last position at 60% opacity.
- Acceptance: leaving a client untouched fades its cursor on another client after 30 s; moving the mouse restores it within one frame.
- Edge cases: tab hidden (counts as inactive but not away if audio/screen-share, ignore); system sleep (clock jump handled by server time on heartbeat).
- Depends on: MULTI-18.

### MULTI-13: Cursor chat (type while holding /)
- Priority: P1
- Size: M
- Interaction: press `/` with the pointer on the canvas to open a small text bubble at your cursor; typing sends live characters to others (throttled to 10 Hz); Enter or 3 s idle fades it out; Esc cancels. Bubble is in your colour, max 80 characters, wraps at 24ch. Messages are ephemeral (never in chat history). `/` while a text field is focused types a slash as normal. Agents can use the `say` command with `ephemeral: true` to pop a cursor bubble (used for short hints like "checking contrast").
- Acceptance: a second client sees characters appear live; bubble disappears 3 s after the last keystroke; no bubble content appears in the chat panel or transcript export.
- Edge cases: text IME composition (send on composition end); bubble at the viewport edge (flips side); 20 simultaneous bubbles (cap 6 visible, oldest first fades).
- Depends on: MULTI-18, MULTI-1.

### MULTI-14: Join and leave toasts
- Priority: P1
- Size: S
- Interaction: a small toast bottom-left: `Iris joined` / `Bryan left` with the actor colour; collapses bursts (`4 agents joined`). Agent spawn is silent by default when initiated by the viewer, and toasts when initiated by someone else or by the coordinator. A toast has a "Follow" action for the first 6 s.
- Acceptance: five agents spawned in one second yield one grouped toast; toasts never cover the toolbar; leaving after a stop shows `stopped` rather than `left`.
- Edge cases: reconnect flapping (suppress join/leave pairs within 3 s); stage mode (all toasts off, see AGENT-17).
- Depends on: MULTI-18.

### MULTI-15: Observer mode
- Priority: P1
- Size: S
- Interaction: URL flag `?observe=1` (or the "Observe" avatar menu item) joins as a read-only viewer: no cursor sent, no tools, no composer; chat is visible read-only; comment pins can be viewed but not created. Observers are counted in an `N watching` pill, not in the stack. Intended for the projector in the demo and for judges.
- Acceptance: observer cannot create/modify any shape or message (commands rejected with `forbidden`); observers do not appear as cursors; the stage view opens with chrome hidden (toolbar auto-hides, `Shift+\` toggles it).
- Edge cases: observer who later clicks "Join as editor" gets a new actor id and colour; 100 observers on one board (counted, not rendered).
- Depends on: MULTI-18, AGENT-3.

### MULTI-16: Scale to 50+ cursors (and 200 agents)
- Priority: P0
- Size: L
- Interaction: no per-frame React state for cursors (keep the DOM-transform approach, Playground.tsx:89-110). Tags are lazily rendered (visible set only, culled by viewport). Beyond 40 visible cursors switch to "dense mode": arrow + initial only; tag only on hover/follow. Position updates are batched into one presence frame per tick on the wire. Engine tick cost is O(active tweens), not O(actors). Measure with a built-in `?perf=1` overlay (fps, cursor count, msgs/s).
- Acceptance: 100 agent cursors animating hold >= 55 fps on a 2021 laptop; 200 agents do not freeze input; frame cost with all cursors off-screen is near zero.
- Edge cases: all cursors in the same pixel (clustered, labels declutter via MULTI-22); zooming rapidly during animation; Safari.
- Depends on: MULTI-2, MULTI-22.

### MULTI-17: Offscreen cursor indicators
- Priority: P1
- Size: M
- Interaction: cursors outside the viewport appear as small coloured edge chips (arrow pointing toward them, initial inside) clamped to the viewport edge; clicking jumps there (AGENT-20). Chips collapse into `+N` groups on the same edge when crowded. Only agents that are working or tagged (mentioned or having an unread message to you) show chips by default; a toggle "show all".
- Acceptance: an agent that drifts off-screen produces a chip within 300 ms, pointing the right way; clicking it centres the board on the agent; chips do not overlap the toolbar or panels.
- Edge cases: chip behind the right panel (inset by panel width); many agents on one edge; minimap overlap.
- Depends on: AGENT-20, MULTI-1.

### MULTI-18: Ephemeral presence channel
- Priority: P0
- Size: M
- Interaction: presence (position, tool, selection ids, viewport, typing state, status) is NOT part of the document. It is an ephemeral channel keyed by `actorId + sessionId` with its own rate limit (<= 60 Hz position, <= 5 Hz everything else) and last-writer-wins semantics. Documents (shapes, comments, messages) go through the command log (AGENT-1). Presence rows expire after 10 s without heartbeat. Today everything is in-process (`engine.pos`, engine.ts:182); this feature defines the interface `PresenceBus` so the in-memory version and a SpacetimeDB-backed one are swappable.
- Acceptance: killing a second tab removes its cursor within 10 s (or instantly on `beforeunload`); presence traffic stays within a documented budget (<= 60 msgs/s/actor); the board works with the in-memory bus offline.
- Edge cases: out-of-order frames (drop by `seq`); packet burst after reconnect (apply only the latest); presence for a deleted shape (ignored).
- Depends on: none.

### MULTI-19: Actor identity, naming and rename
- Priority: P1
- Size: S
- Interaction: the human sets a display name (default `You`, today HUMAN, Playground.tsx:20) and an optional avatar colour in a small menu. Agents have `name`, `role` (e.g. "Layout", "Copy", "Components"), `model` label and `kind`. Names are unique per board; duplicates get suffixes. `@name` mentions resolve against this list (COMMENT-8).
- Acceptance: renaming updates the tag, chat headers, presence list and pins within one render; rename collisions suffix `2`.
- Edge cases: renaming mid-thread (old messages show the name at the time as a tooltip); emoji names; a name that collides with a reserved word (`you`, `all`, `general`).
- Depends on: MULTI-5.

### MULTI-20: Cursor reactions and quick emotes
- Priority: P2
- Size: S
- Interaction: hold `E` and click a number key (1-6) to emit an emoji floating from your cursor for 2 s. Agents can emit reactions via `say` with `emote`.
- Acceptance: emoji rises from the correct cursor and disappears in 2 s; max 10 simultaneous.
- Edge cases: spam (rate-limit 3/s per actor); reduced-motion setting (show a static badge for 1 s).
- Depends on: MULTI-13.

### MULTI-21: Pointer privacy and hide-my-cursor
- Priority: P2
- Size: S
- Interaction: a "Hide my cursor" toggle (and automatic hiding while a modal/menu is open) stops publishing position. Others see the avatar with a `hidden` state instead of the cursor.
- Acceptance: with the toggle on, no position frames are sent and the cursor disappears for others.
- Edge cases: the toggle during follow (follow still works through viewport).
- Depends on: MULTI-18.

### MULTI-22: Cursor tag declutter
- Priority: P1
- Size: M
- Interaction: when tags overlap on screen, the lowest-priority tags (idle, then agents, then humans) collapse to a dot; priority is boosted for hovered/followed/mentioned actors. Collision check runs per frame on at most the visible 40 tags using a grid hash.
- Acceptance: with 10 cursors at the same spot only one tag is expanded and the others are dots; hovering a dot expands it and collapses the neighbour.
- Edge cases: pinch zoom changes layout each frame (use previous frame positions to avoid flicker).
- Depends on: MULTI-16.

### MULTI-23: Multi-human collaboration over SpacetimeDB
- Priority: P2
- Size: L
- Interaction: two browsers on the same board id see each other's shapes, cursors and chats through the SpacetimeDB tables sketched in the architecture section. Human actors are real clients with `sessionId`; reconnect resumes from the last command `seq`. Not needed for the MVP stage demo (agents are the multiplayer), but the `PresenceBus` and `CommandLog` interfaces are shaped now so this is a transport swap.
- Acceptance: two tabs converge to identical shapes after 200 random ops; a refresh restores everything; offline edits queue and flush.
- Edge cases: simultaneous edits to the same property (LWW per property by `seq`); schema drift between client versions.
- Depends on: AGENT-1, MULTI-18.

### MULTI-24: Viewport broadcast
- Priority: P1
- Size: S
- Interaction: each client publishes its viewport `{x, y, w, h, z}` (world units) at <= 5 Hz and on change end (not mid-wheel). Agents publish a nominal viewport centred on their cursor and the shape they are working on. Used by follow, minimap and "who sees this" counters.
- Acceptance: viewports reach other clients within 250 ms of a pan settling; hidden tabs stop publishing.
- Edge cases: window resize; devicePixelRatio differences (always world units).
- Depends on: MULTI-18.

### AGENT-1: Command protocol (replaces ad-hoc window.board)
- Priority: P0
- Size: L
- Interaction: every mutation to the document or presence goes through `board.exec(batch)` where a batch is `{ actor, opId, commands: Command[], atomic? }`. Commands: `shape.create | shape.update | shape.delete | shape.move | shape.reorder | selection.set | cursor.move | cursor.press | comment.create | comment.reply | comment.resolve | chat.say | claim.acquire | claim.release | status.set | task.update`. The result is `{ ok, results: Result[], seq }` with per-command errors. `window.board` becomes a thin dev wrapper around `exec` (kept for the console), and the human UI also builds commands (so the log is the single source of truth, which gives replay AGENT-26, per-actor undo AGENT-24, and SpacetimeDB sync MULTI-23). Types are in the architecture section.
- Acceptance: an agent can create a frame with 10 children in one batch and the board shows them in one render; invalid command in an atomic batch rolls the whole batch back; the human dragging a rect produces an equivalent `shape.move` in the log; `window.board.exec` works from the console.
- Edge cases: batch referencing an id created earlier in the same batch (`$1` back-references, see types); command on a deleted shape (`error: 'not_found'`); very large batches (cap 500 commands); frozen board (observer, AGENT-18).
- Depends on: none (everything else builds on it).
- Multi-agent note: the batch is the unit of locks, claims, undo and replay, so it is also the unit of the action card shown in chat (COMMENT-12).

### AGENT-2: Idempotent op ids and ordering
- Priority: P0
- Size: M
- Interaction: every batch has a client-generated `opId` (`${actorId}:${counter}` or ULID). The board keeps the last 1000 op ids; re-submission returns the cached result without re-applying, so retries after a timeout are safe. Each applied batch gets a monotonic `seq`. Conflicts are resolved by `seq`, never wall-clock.
- Acceptance: submitting the same batch twice creates the shapes once; both calls return the same result; `seq` is strictly increasing across actors.
- Edge cases: opId reuse with different content (rejected `op_mismatch`); opId cache eviction vs a very late retry (treated as new, documented).
- Depends on: AGENT-1.

### AGENT-3: Actor ids and capabilities
- Priority: P0
- Size: S
- Interaction: every actor has an id with a type prefix: `human:<n>`, `agent:<n>` (today `agent-N`, engine.ts:357), `api:<n>` (today `api-...`), `system:coordinator`. Each actor has a `caps` set: `read`, `write`, `comment`, `claim`, `spawn`, `admin`. Observer = `read` only. Commands carry the actor and are validated against caps.
- Acceptance: a `read`-only actor's `shape.create` returns `forbidden`; actor type is queryable (`isAgent(id)`) without string sniffing.
- Edge cases: legacy ids (`you`, `agent-0`) are mapped on load; an actor loses `write` mid-session (in-flight batch is rejected).
- Depends on: AGENT-1.

### AGENT-4: Batching and transactions
- Priority: P1
- Size: M
- Interaction: `atomic: true` batches apply all-or-nothing, as a single undo step. Non-atomic batches apply best-effort and report per-command results. Agents are encouraged (docs and helpers) to build a frame plus children in one atomic batch while the visible animation is produced separately by the cursor timeline (AGENT-23), so "animate" and "apply" are decoupled and an LLM agent can answer in one round trip.
- Acceptance: atomic failure leaves the board unchanged; a batch of 100 creations triggers one React commit.
- Edge cases: partial lock denial in an atomic batch (whole batch fails with the first denial); batch containing a `claim.acquire` that fails.
- Depends on: AGENT-1.

### AGENT-5: Event stream and subscriptions
- Priority: P0
- Size: M
- Interaction: `board.subscribe(filter, cb)` returns an unsubscribe. Events: `shape.created|updated|deleted`, `selection.changed`, `comment.created|replied|resolved`, `message.created` (addressed to someone), `mention`, `claim.granted|denied|released`, `lock.revoked`, `actor.joined|left`, `status.changed`, `task.assigned|cancelled`, `board.paused`. Filters by `actors`, `kinds`, `addressedTo`, `regionId`, `shapeIds`. Events carry `seq`, `actor`, `causedBy` (opId). Agents never see their own events unless they opt in. A coalescing option merges bursts (`shape.updated` x30 during a drag into one).
- Acceptance: an agent subscribed to `addressedTo: me` is notified when a comment pin on its layer is created; unsubscribing stops delivery; a drag produces at most one coalesced event every 100 ms for subscribers that ask for it.
- Edge cases: slow subscriber (bounded queue, drops with a `lagged` marker); event for a shape the subscriber cannot see (a region scope); reentrancy (a handler issuing a command that triggers its own event).
- Depends on: AGENT-1, AGENT-2.
- Multi-agent note: this replaces the per-agent `inbox` Map (engine.ts:179). The inbox becomes the persisted subset of events that are tasks (AGENT-9).

### AGENT-6: AgentDriver interface (scripted and LLM interchangeable)
- Priority: P0
- Size: L
- Interaction: both kinds implement `AgentDriver` (see architecture): `start(ctx)`, `onEvent(ev)`, `stop()`, with `ctx` giving `exec`, `subscribe`, `snapshot`, `log`, `signal` (AbortSignal). The engine owns the cursor animation: a driver emits `Intent`s (`move`, `drag`, `type`, `think`) and the `Choreographer` turns them into cursor motion, so an LLM that returns only data still gets a believable cursor. The scripted driver wraps today's `runAgent/build/handle` (engine.ts:290-412) behind this interface; the LLM driver calls `packages/llm` `decide()` or `runWorker()` and maps output into commands.
- Acceptance: swapping `driver: 'scripted' | 'llm'` per agent at spawn changes nothing else in the UI; both drivers produce the same event types; unit test runs a fake driver against the protocol with no React.
- Edge cases: driver throws (status `error`, see AGENT-18); driver ignores `signal`; LLM returns invalid JSON (retry once, then `error`).
- Depends on: AGENT-1, AGENT-5, AGENT-23.
- Multi-agent note: all model calls go through `packages/llm` so tokens are logged and `LLM_PROVIDER` swaps providers (repo rule). The LLM driver MUST NOT call a provider SDK directly.

### AGENT-7: Agent lifecycle (spawn, stop, remove, restart)
- Priority: P0
- Size: M
- Interaction: `spawn({ name?, role?, driver, color?, at?, taskSeed? })`, `stop(id)` (cancels in-flight work, keeps cursor and history, status `stopped`), `remove(id)` (also removes cursor), `restart(id)`. Today there is only spawn/remove/reset/clear (engine.ts:424-457). Stop releases locks and claims (as `stopScript` clears owner, engine.ts:211) and posts a chat line `Stopped by Bryan`.
- Acceptance: stopping an agent mid-drag leaves a valid shape (finalised at current size, flagged `incomplete`) and clears its lock within 1 s; restarting resumes with a fresh task queue; stopped agents remain in the presence list greyed.
- Edge cases: stop during an LLM call (abort via `signal`, an aborted `runWorker` throws `LLMAbortError` and still reports estimated usage, per CLAUDE.md); remove an agent that holds claims (claims released with an event); spawn when the roster is capped (limit 200).
- Depends on: AGENT-6, AGENT-12.

### AGENT-8: Status state machine
- Priority: P0
- Size: M
- Interaction: `AgentState = 'idle' | 'thinking' | 'drawing' | 'waiting_user' | 'waiting_agent' | 'blocked' | 'paused' | 'stopped' | 'error'`, plus an optional free-text `detail` (today's status string, engine.ts:32). Legal transitions are enforced in one place (`setState(id, state, detail)`); each transition emits `status.changed`. Cursor tag and chat header show icon plus detail; the presence ring colours come from the state: idle green, thinking purple pulse, drawing blue, waiting amber, blocked red, paused grey, error red with a cross.
- Acceptance: a state change appears on the cursor tag, avatar ring and chat header together within 250 ms; `waiting_user` displays "Needs you" and bumps the unread badge (COMMENT-6); an illegal transition throws in dev and logs in prod.
- Edge cases: two sources set status concurrently (state owner = driver, `paused/stopped` overridden by the control layer); long detail strings (truncate 40 chars, full in tooltip).
- Depends on: AGENT-6.

### AGENT-9: Task and inbox queue (priority, cancel)
- Priority: P0
- Size: M
- Interaction: per-agent queue of `Task { id, kind: 'note'|'build'|'review'|'custom', text, shapeId?, regionId?, priority: 0-3, from, createdAt, state: 'queued'|'running'|'done'|'cancelled'|'failed' }`. Today `Req` is a FIFO (engine.ts:29, 361-384). New: priority insertion (human > coordinator > agent), reorder, cancel (queued or running), and a visible queue under the chat header (`Doing: make it blue · 2 queued [x]`). A human message can use `!` prefix or a "Do first" toggle for priority 3. Cancelling a running task aborts via `signal`, reverts in-progress partial output if the batch was atomic, and posts `Cancelled`.
- Acceptance: a priority-3 note jumps ahead of two queued notes; cancelling a queued task removes it with a toast; pins attached to cancelled tasks revert from pending to open (COMMENT-4).
- Edge cases: queue capacity (50, then reject with a visible message); a note for a deleted layer (task fails with the existing "layer is gone" message, engine.ts:391); duplicates (merge identical consecutive notes).
- Depends on: AGENT-5, AGENT-8.

### AGENT-10: Ask before destructive
- Priority: P1
- Size: M
- Interaction: commands tagged destructive (`shape.delete` of > 1 shape or a frame with children, `shape.update` that changes > 50% of a frame, `claim` override) from an agent produce a `Proposal` card in its chat (`COMMENT-13`) and the agent goes `waiting_user` until Approve/Reject/Edit. A per-agent and global "autopilot" toggle skips confirmation; default for the demo is confirm only for deletes of frames. The agent can only proceed on `approval.granted`.
- Acceptance: telling an agent "delete the card" shows a proposal listing "Delete Profile card (9 layers)" with Approve and Reject; Reject leaves the board unchanged and the agent replies; approving applies the batch as one undo step.
- Edge cases: proposal ignored (reminder after 60 s, then agent proceeds to the next task, proposal stays); the layer changed since the proposal (stale: card shows `Out of date`, re-propose); two proposals touching the same shape.
- Depends on: AGENT-1, COMMENT-13.

### AGENT-11: Agent claims on regions and frames
- Priority: P0
- Size: L
- Interaction: an agent acquires a `Claim { id, actor, target: {kind:'frame', id} | {kind:'rect', x,y,w,h} | {kind:'shape', id}, mode: 'exclusive'|'shared', ttlMs, reason }`, drawn as a dashed rectangle in the agent's colour with a lock tag `Iris · Profile card`. Other agents' write commands that overlap an exclusive claim are rejected with `claimed_by` (and, from the third repeat, produce a conflict, AGENT-13). Claims auto-extend while the holder is active and expire after TTL (default 120 s, mirroring Contract's 300 s default, `contract.claim(symbolId, ttlSecs = 300)`). Humans are not blocked by claims but get a soft warning toast ("Iris is working here"). Today the only reservation is the internal grid slot (engine.ts:273-279); `claimSlot` becomes the first claimant of the generic claim mechanism.
- Acceptance: agent B asked to edit inside agent A's claimed frame is told no (event + chat line) and picks another task; claim rectangles appear on every client; an expired claim disappears and emits `claim.released`.
- Edge cases: overlapping claims where one is shared; claim on a shape later moved (claim follows the frame; rect claims are static); nested frame claims (a parent claim covers children; child claim is allowed by the same holder only); claim by a stopped agent (released).
- Depends on: AGENT-1, AGENT-5.
- Multi-agent note: this IS the Contract `claim` table on the canvas (SPEC sections 2, 6, 7, `claim_symbol`/`release_claim`): the same shapes of data so a later SpacetimeDB mapping is mechanical.

### AGENT-12: Soft locks as a protocol feature
- Priority: P0
- Size: M
- Interaction: `lock.acquire(shapeIds, ttlMs)` / `lock.release` commands with automatic implicit locks on any mutation (held for the batch plus 500 ms). Lock results flow through `Result.error = 'locked'` with `holder`. Locks are cheaper and shorter-lived than claims: a claim says "this region is mine for the next minutes", a lock says "I am touching this right now".
- Acceptance: in a batch race the first by `seq` wins; the loser gets `retryAfterMs` equal to the remaining TTL; implicit locks release when the batch completes.
- Edge cases: lock on a shape inside a claimed frame (claim check first, then lock); stale locks after a crash (TTL).
- Depends on: AGENT-1, MULTI-8.

### AGENT-13: Conflict detection and coordinator view
- Priority: P1
- Size: L
- Interaction: when two agents repeatedly contend (>= 2 denials in 30 s) over one claim/shape or one instructs a change that breaks another's in-flight work (e.g. resize a frame another agent is filling), the board records a `Conflict { id, kind: 'claim_contention'|'overlap'|'dependency', actors: [a,b], target, state: 'open'|'ruled'|'dismissed', ruling? }` and a red badge appears on the target with both agents' colours. A panel "Coordinator" lists open conflicts, who holds what (a table of actors x claims), and a ruling (`system:coordinator` posts a decision card like Contract's coordinator decisions: "Iris owns Profile card; Juno takes Stat widget"). The ruling is produced by a coordinator driver (a scripted rule now, `packages/llm` `decide()` later) and delivered as events so agents adapt. Mirrors SPEC sections 3 and 8.
- Acceptance: two agents asked to restyle the same frame produce one conflict, one coordinator card in both chats, and one winner; dismissing a conflict removes the badge; the Coordinator panel shows every actor's current claim and task.
- Edge cases: three-way conflict; conflict between agent and human (human wins automatically, with a notice); ruling that arrives after the agents moved on.
- Depends on: AGENT-11, AGENT-12, COMMENT-12.
- Multi-agent note: conflicts and rulings must be representable as rows compatible with Contract's `conflict` table (SPEC section 6) so the existing dashboard can later show them.

### AGENT-14: Coordinator view: who is working on what
- Priority: P1
- Size: M
- Interaction: a board overlay mode ("Work map", key `W`) dims shapes and colours each frame by its current holder (claim or last author), with per-actor task chips: `Iris: Profile card (drawing, 62%)`. A side table lists actors, current task, queue length, state, tokens, claim count. Clicking a row jumps (AGENT-20); clicking a frame filters the chat to its holder.
- Acceptance: toggling the overlay recolours the frames by holder in < 100 ms; unclaimed frames show grey; the table matches the presence list statuses.
- Edge cases: 200 agents (group by state, virtualised); overlapping claims (striped).
- Depends on: AGENT-9, AGENT-11, MULTI-5.

### AGENT-15: Pause, resume, stop one or all; kill switch
- Priority: P0
- Size: S
- Interaction: per-agent pause/resume/stop in the presence row and chat header; global bar buttons `Pause all`, `Resume all`, `Stop all` (today `Pause all` only, Playground.tsx:569ff, engine.ts:433). Hotkeys: `Cmd/Ctrl+.` pause all toggle, `Cmd/Ctrl+Shift+.` stop all. Pause halts the cursor animation and the next command, and in-flight LLM runs are aborted at the next checkpoint (not killed) unless `Stop`. `Stop all` is a visible, always-available kill switch, also reachable while a modal is open.
- Acceptance: pressing the global pause freezes every cursor within one frame and queues no new commands; resume continues exactly where each agent paused; stop-all clears locks and claims.
- Edge cases: pause while a batch is applying (batch completes, then holds); resume with a changed board (agent revalidates its plan, AGENT-6); new agents spawned during global pause start paused.
- Depends on: AGENT-7, AGENT-8.

### AGENT-16: Speed control
- Priority: P0
- Size: S
- Interaction: global speed slider (0.25x-4x, exists as `speed`, engine.ts:187, 465) plus per-agent multiplier. Speed scales cursor motion, typing cadence and waits, NOT model latency. `0` = "step" mode: each click on `Step` advances one command per agent (for debugging and staged demos).
- Acceptance: setting 2x halves cursor travel times; step mode applies exactly one batch per click; the setting persists across reload.
- Edge cases: changing speed mid-tween (re-time remaining distance); step mode with LLM agents (each step is one decision).
- Depends on: AGENT-23.

### AGENT-17: Demo script mode (the stage run)
- Priority: P0
- Size: L
- Interaction: `DemoScript { id, title, steps: Step[] }` where a step is `spawn`, `say-as-human`, `wait`, `agent-task`, `conflict-inject`, `camera` (pan/zoom/follow), `assert` or `caption`. A run bar (`Play / Pause / Next / Restart`) drives the script; steps are deterministic (seeded RNG replaces `Math.random`, engine.ts:229, 310, 326). A "stage mode" hides the dev chrome, enlarges tags, silences toasts, and shows caption overlays. The canonical script for the Contract pitch: three agents spawn, two claim the same frame, a conflict appears, the coordinator rules, a human comments `@Iris make it purple` and the action card + undo happen.
- Acceptance: running the script twice produces identical board output; each step can be skipped with `Space`/`N`; stage mode removes all non-demo chrome with one key.
- Edge cases: a step waits on something that never happens (timeout then continue with a toast); user intervenes mid-script (script pauses with `Resume`/`Skip`); deterministic IDs.
- Depends on: AGENT-1, AGENT-6, AGENT-15, AGENT-16.

### AGENT-18: Error states and degraded modes
- Priority: P1
- Size: M
- Interaction: state `error` shows a red tag `Iris · error`, a chat card with the reason (`LLM timed out after 30s`, `invalid command`, `locked 3x`) and `Retry / Skip / Stop` buttons. Offline (no network to the model) shows a grey banner, and agents fall back to scripted if allowed (`fallback: 'scripted'`). All errors are logged with the `opId`. Rate limiting: per-actor commands/s cap (30) with a soft throttle indicator.
- Acceptance: killing the model process yields an error card within the timeout and does not crash the board; Retry re-runs the same task; the offline banner disappears on recovery.
- Edge cases: error storms (collapse repeating errors into `x5`); error while paused; failed agent holding claims (released).
- Depends on: AGENT-7, AGENT-8, COMMENT-12.

### AGENT-19: Observability: tokens, cost, latency
- Priority: P1
- Size: M
- Interaction: each agent keeps `Usage { prompt_tokens, completion_tokens, cost_usd, estimated?, calls, p50_ms, last_ms }` fed by `packages/llm` `onUsage` (shape from CLAUDE.md). Visible: a compact chip in the presence row and chat header (`12.4k tok · $0.08`), a totals row at the panel bottom, and an expandable per-call log (time, prompt label, tokens, ms, ok/err). Scripted agents report zeros with `estimated: false`. Aborted runs show `~` estimated markers (the interface returns estimated usage on abort). Optionally flows to Contract's token savings metric later.
- Acceptance: a mock LLM call increments the chip; totals equal the sum; an aborted call shows an estimated value flagged `~`; clearing the board does not reset usage.
- Edge cases: missing usage fields; cost unknown for a provider (show tokens only); 10k log entries (cap 500 per agent).
- Depends on: AGENT-6, packages/llm.

### AGENT-20: Jump to agent and find-the-agent
- Priority: P0
- Size: S
- Interaction: clicking an agent in the presence list, its avatar, its chat header, or an offscreen chip (MULTI-17) animates the viewport to centre on its cursor over 400 ms, keeping the current zoom unless the agent is > 5000 units away (then zoom to fit both). Hotkey `Cmd/Ctrl+J` opens a quick-jump palette (type name, Enter). `.` in the chat header "locate" button pulses the cursor with a ring for 1.5 s. Message mentions of an agent are also clickable jumps.
- Acceptance: any agent can be centred in <= 2 clicks from anywhere on the board; the ring pulse is visible at zoom 0.1; jumping to a stopped agent goes to its last position.
- Edge cases: agent being followed (follow already active, no-op); agent in a different board region at extreme zoom; moving target (follow after arrival offered as `Follow`).
- Depends on: MULTI-9, MULTI-17.

### AGENT-21: Agent perception API
- Priority: P1
- Size: M
- Interaction: `ctx.snapshot({ region?, depth?, include?: ['shapes','comments','claims','selection'] })` returns a compact, token-efficient JSON of the board (ids, kinds, names, bounds, fills, text, parents, authors, claims) and optionally a rasterised PNG of a region (for vision-capable models). It is read-only and does not require a lock. Snapshots are versioned with `seq` so edits can be compare-and-set (`ifSeq`).
- Acceptance: snapshot of a 200-shape board is < 8 kB with `include: ['shapes']`; `ifSeq` mismatch yields `stale`; region snapshots only return intersecting shapes.
- Edge cases: huge boards (limit 2000 shapes, with a `truncated` flag); snapshots in step mode.
- Depends on: AGENT-1.

### AGENT-22: Agent personas and roles
- Priority: P1
- Size: S
- Interaction: an agent has `{ name, role, system?, skills: ('layout'|'copy'|'color'|'components'|'review')[], model? }`. Role shows in the tag tooltip and chat header and biases routing (COMMENT-9): comments on text layers go to a Copy agent if one exists. Scripted agents use a role to pick which templates they build (engine.ts:60-115).
- Acceptance: spawning with a role shows it in the UI; routing a text-layer comment prefers the copy-role agent over the nearest one (when no author).
- Edge cases: role absent (generic); two agents with the same role (nearest wins).
- Depends on: MULTI-19, COMMENT-9.

### AGENT-23: Choreographer (intent to cursor motion)
- Priority: P0
- Size: M
- Interaction: drivers emit `Intent`s; the Choreographer owns `moveTo`, press/drag, typing cadence, think-pauses, and publishes presence. It applies the shape changes at the right visual moments (e.g. rect grows with the drag, as engine.ts:281-288) or instantly when `animate: false`. This lets an LLM that returns a finished plan look like it is drawing it. Time budget per intent is capped so a 200-layer plan does not take 10 minutes (adaptive: if > 20 s, speed up, finishing with a ramp).
- Acceptance: the same plan renders animated or instantly depending on a flag; the cursor path starts at the agent's last position; a 40-layer plan completes in <= 20 s at 1x.
- Edge cases: a plan edit mid-animation (restart from current state); pause during animation (existing token behaviour, engine.ts:253-256).
- Depends on: AGENT-1.

### AGENT-24: Per-actor undo needs from this domain
- Priority: P1
- Size: M
- Interaction: this domain provides `CommandLog` entries `{ seq, actor, opId, batch, inverse, groupId }` where `inverse` is the batch that undoes it (captured before apply). HISTORY consumes it to implement: undo my last action (not the last global action), undo an agent's batch (the action card Undo button, COMMENT-12), and undo with conflict checks (`undo_blocked` if a later actor edited the same property; offer "undo anyway / cancel"). Agent batches that are atomic are one undo step.
- Acceptance: Cmd+Z undoes only the human's own last batch even when agents acted since; the action-card Undo reverts exactly the agent's batch; undoing a delete restores the shape and its pins.
- Edge cases: undo of a batch whose shapes were later deleted by another actor; redo after a conflicting edit; undoing a create that others commented on (pins re-anchor to canvas points, COMMENT-10).
- Depends on: AGENT-1, HISTORY.

### AGENT-25: Agent-to-agent messaging and handoff
- Priority: P1
- Size: M
- Interaction: `chat.say` with `to: agentId` posts into a visible agent channel (`#agents`, filterable) and delivers as a `message.created` event to that agent. Handoff: `task.handoff(taskId, to)`. Human can read all agent-to-agent traffic (collapsed by default) to explain coordination.
- Acceptance: Iris tells Juno "I'm done with the card, you can restyle it" and Juno acts; the message appears in `#agents`; unread badges only count messages addressed to the viewer.
- Edge cases: ping-pong loops (rate limit and cooldown); messages to stopped agents (queued with a warning).
- Depends on: AGENT-5, COMMENT-1.

### AGENT-26: Replay and scrub of an agent's actions
- Priority: P2
- Size: L
- Interaction: since all mutations are in the `CommandLog`, a timeline scrubber for one agent (or all) replays batches by `seq` up to the cursor, in a read-only "ghost" view of the board with that agent's cursor path drawn as a polyline. Scrub is draggable; play/pause; `Restore to here` forks a new state (HISTORY).
- Acceptance: scrubbing back removes the agent's shapes progressively; replay at 8x finishes a 5-minute run in under 40 s; exiting replay returns the live board.
- Edge cases: board edited by humans in between (replay shows actual interleaving); log truncation (cap with snapshot checkpoints every 200 seqs).
- Depends on: AGENT-1, AGENT-2.

### AGENT-27: Headless protocol harness and tests
- Priority: P1
- Size: M
- Interaction: `createBoardCore()` is pure TS (no React, like engine.ts:2-3) with an in-memory document, command applier, locks, claims and bus, so vitest can run scripted scenarios (two agents race a frame, atomic rollback, idempotency, queue priority). React only renders. The dev console `window.board` is generated from the same core.
- Acceptance: `npm test` in `dashboard/` runs protocol tests without a browser; a scenario test reproduces the demo conflict deterministically (seeded).
- Edge cases: fake timers for TTLs; fake `packages/llm` driver.
- Depends on: AGENT-1, AGENT-17.

### AGENT-28: LLM agent adapter via packages/llm
- Priority: P1
- Size: L
- Interaction: `LlmDriver` implements `AgentDriver`. Per task: build a prompt with persona, snapshot (AGENT-21) and task; call `decide(prompt, jsonSchema, opts)` returning `{ commands: Command[], say?: string }` validated against the protocol schema (zod-less JSON schema, hand-written to avoid new deps); apply via `exec`; surface `usage` to AGENT-19. For multi-step work with reading and tools, use `runWorker(task, { cwd, signal })` in a Node process (the browser cannot call it; a thin local bridge, see Open questions). `resumeSessionId` keeps conversation memory per agent. Never call a provider directly.
- Acceptance: with `LLM_PROVIDER` set, an LLM agent turns "make a pricing page" into a validated batch that appears via the Choreographer; invalid output is repaired once then surfaces as an `error`; token chip updates.
- Edge cases: model proposes shapes outside its claim (rejected, told why); latency > 20 s (status `thinking` with elapsed timer, COMMENT-17); abort on Stop (`LLMAbortError`).
- Depends on: AGENT-6, AGENT-19, AGENT-21, AGENT-23.

### AGENT-29: Takeover and human override
- Priority: P1
- Size: S
- Interaction: `Take over` (agent row menu) pauses the agent and transfers its current claim to the human; `Hand back` returns it. Dragging an agent's shape while it is working triggers the takeover toast (MULTI-8) rather than silent conflict.
- Acceptance: after takeover the agent is `paused` with a message; its in-flight task stays queued; hand back resumes it from the next command.
- Edge cases: agent finished in the meantime; two humans taking over.
- Depends on: MULTI-8, AGENT-15.

### AGENT-30: Agent capabilities and scope limits
- Priority: P1
- Size: S
- Interaction: each agent has `scope`: allowed claim regions, max shapes per minute, and `canDelete`. Out-of-scope commands return `forbidden` with a human-readable reason shown in chat.
- Acceptance: an agent limited to one frame cannot create outside it; `canDelete: false` agents propose deletions instead (AGENT-10).
- Edge cases: scope changed mid-task.
- Depends on: AGENT-3, AGENT-10.

### COMMENT-1: Chat per agent plus general channel
- Priority: P0
- Size: M
- Interaction: left column has threads `#general`, `#agents` (agent-to-agent log, AGENT-25) and one thread per agent (exists, ChatPanel.tsx:66-78). Thread chips show unread count, a state dot (AGENT-8) and a pending indicator. New: pinned order (people you talk to most first), search box (COMMENT-24), `Cmd/Ctrl+K` thread switcher, a collapsed list for stopped agents. `#general` is a broadcast: a message there routes by mention (COMMENT-8) and otherwise to a coordinator "router" that replies once with where it went and why (replacing the random pick and fake "Claude" line, Playground.tsx:226-233).
- Acceptance: messages in `#general` without a mention produce a visible routing line naming the chosen agent and reason; switching threads keeps scroll position; unread counts survive thread switching.
- Edge cases: 200 agents (threads list virtualised and grouped); a thread for an agent that was removed (read-only, labelled `gone`, as ChatPanel.tsx:70 `gone` class).
- Depends on: AGENT-7, COMMENT-6.

### COMMENT-2: Comment pins anchored to layers
- Priority: P0
- Size: M
- Interaction: with the comment tool (`C`), click a layer to place a pin anchored to it at the clicked offset (exists: Pin, Playground.tsx:11, 240); the pin follows the layer when it moves, resizes proportionally (offset stored as fractions of the layer box, not pixels, fixing absolute `dx/dy`), and is clipped with it when hidden. Pin shows number and the author's colour; pending/answered/resolved visual states.
- Acceptance: moving or resizing the layer moves the pin in step; pin offsets on a resized layer keep their relative position; the pin number is stable across reloads.
- Edge cases: layer inside a rotated frame; layer hidden (pin hidden, listed in sidebar with a "hidden layer" label); zoomed out (pins cluster, COMMENT-19).
- Depends on: CANVAS shape transforms.

### COMMENT-3: Comment pins on canvas points
- Priority: P0
- Size: S
- Interaction: clicking empty canvas with the comment tool places a free pin in world coordinates (not anchored). It routes to `#general` (or nearest agent per COMMENT-9). Dragging a free pin over a frame offers to anchor it (snap highlight). Multi-select comment (P2) anchors to a bounding box.
- Acceptance: a pin on empty canvas stays at the same world position under pan and zoom; dragging it onto a layer anchors it; free pins appear in the sidebar.
- Edge cases: pin placed on top of other pins (stack nudge); outside the board extents.
- Depends on: COMMENT-2.

### COMMENT-4: Threads with replies; resolve and reopen
- Priority: P0
- Size: M
- Interaction: a pin owns a `Thread { id, anchor, messages[], state: 'open'|'answered'|'resolved' }`. Clicking a pin opens a popover with the thread, reply composer and `Resolve` (checkmark). Agents resolve automatically only for their own tasks, marking `answered` first (so the human confirms); today the engine sets `done` itself (engine.ts:390). Resolved pins dim and hide unless the filter shows them; `Reopen` brings them back. Replies are chat messages in the agent's thread tagged with `threadId`, so the chat and the pin show the same conversation.
- Acceptance: replying from the pin popover appears in the agent's chat and vice versa; resolve from either place syncs; reopened thread notifies the agent with a `comment.replied` event.
- Edge cases: resolve while the agent is mid-task (the task completes, pin stays resolved); reply on a resolved thread (auto reopen); deleted thread parents.
- Depends on: AGENT-5, COMMENT-2.

### COMMENT-5: Pins when the layer is deleted
- Priority: P0
- Size: S
- Interaction: deleting an anchored layer turns its pins into orphan pins at the last known world position with a ghost style (dashed ring, "layer deleted") instead of vanishing (Playground.tsx:487 returns null today). Undo restores the layer and re-anchors the pins. If a frame is deleted with children, all child pins orphan. Orphans appear in the sidebar under "Orphaned" with a one-click Resolve all.
- Acceptance: deleting a commented layer keeps the pin visible as a ghost; undo re-anchors; chat "Show on board" on a ghost pin pans to the position and says "Layer was deleted".
- Edge cases: delete by an agent (event includes pins affected); thousands of orphans (cluster).
- Depends on: COMMENT-2, AGENT-24.

### COMMENT-6: Unread badges
- Priority: P0
- Size: M
- Interaction: unread is a per-viewer `lastReadSeq` per thread, not a message count (fixes ChatPanel.tsx:29-36). Badges show on thread chips, the avatar, the sidebar tab, the browser tab title (`(2) Playground`) and pins (a dot). Messages addressed to the viewer (mention or reply) count as `mention` (red badge); others as plain (grey). Opening the thread marks read after the thread is visible for 500 ms and scrolled to the bottom.
- Acceptance: three agent messages show `3`; opening the thread clears it; a mention shows the red variant; badge counts are correct after a reload.
- Edge cases: thread open but the window not focused (not read until focus); retraction of a message (count adjusts).
- Depends on: COMMENT-1.

### COMMENT-7: Comment list and sidebar with filters
- Priority: P1
- Size: M
- Interaction: a `Comments` tab in the left panel lists all threads with preview, anchor name (`Profile card › Button`), author chip, state, age. Filters: Mine, Unresolved, Resolved, Orphaned, By agent (multi-select), By frame, Unread. Sort by newest or by board position. Clicking an item pans to the pin and opens it. Keyboard: `J/K` move, `Enter` open, `R` resolve.
- Acceptance: filters combine (AND); counts update live; the list handles 500 threads; clicking an item centres its pin.
- Edge cases: pin hidden by the "Show comment pins" toggle (Playground.tsx:413) still listed with a dim style; filters empty state.
- Depends on: COMMENT-4.

### COMMENT-8: Mentions routing (@Iris)
- Priority: P0
- Size: M
- Interaction: typing `@` in any composer or pin popover opens an autocomplete of actors (agents and people), with role and status. A mention routes the message to that actor (task for an agent, notification for a human) regardless of the thread it was typed in; the message is also posted into the target's thread with a `from #general` chip. `@all` fans out to all agents (confirm if > 5). Mentions inside a pin thread keep the layer context. Unresolvable names show an error chip, not silent routing.
- Acceptance: `@Iris make it purple` on a layer owned by Juno goes to Iris and the pin context is passed; the autocomplete lists only live actors by default; mentioned humans get a red unread dot.
- Edge cases: two actors with the same first name; mention of a stopped agent (warn `Iris is stopped, start?`); mention inside code/quotes (ignored).
- Depends on: MULTI-19, AGENT-9.

### COMMENT-9: Routing policy (who gets a note without a mention)
- Priority: P0
- Size: M
- Interaction: make the router explicit and inspectable: order = explicit mention, then claim holder of the region, then `author`, then frame author, then role-skill match (AGENT-22), then nearest idle agent, then `#general`. Today: author, frame author, nearest (Playground.tsx:195-208). The pin popover shows the decision (`Iris · made this`, `claimed this frame`, `closest agent`) and lets the human reroute via a dropdown before sending (exists as label, Playground.tsx:518-521). The decision is stored on the message (`routedBy`).
- Acceptance: a layer inside Iris's claim routes to Iris even if Juno is nearer; rerouting in the popover changes the recipient and records it; a no-agent board shows `no agents yet`.
- Edge cases: author removed (fall to claim holder, then nearest); tie by distance (lowest queue length); unauthored human layers (nearest idle).
- Depends on: AGENT-11, AGENT-22.

### COMMENT-10: Pins moving with layers; re-anchor
- Priority: P1
- Size: S
- Interaction: pins store anchor `{ shapeId, fx, fy }` fractions of the layer box and recompute screen position from the live shape. Moving a layer into another frame keeps the pin; duplicating a layer does not copy pins; detaching/ungrouping re-anchors to the child hit under the pin if possible. Drag the pin to re-anchor.
- Acceptance: pin tracks the layer through move, resize, nest, un-nest; dragging the pin onto another layer re-anchors with a snap highlight.
- Edge cases: pin on a hidden/locked layer; pin anchored to a text layer whose content shrank.
- Depends on: COMMENT-2.

### COMMENT-11: Message types
- Priority: P0
- Size: M
- Interaction: `Msg` gains `kind`: `text | status | action | proposal | system | routing | error | usage`. Rendering: text bubbles; `status` as a dim inline line (`Iris is drawing Button`); `action` as a card (COMMENT-12); `proposal` as a card with buttons (COMMENT-13); `system` centred small (`Bryan paused all`); `routing` small chip (`routed to Juno · closest agent`); `error` red card. Today every message is just text (engine.ts:27, ChatPanel.tsx:98-114). Collapsible runs of consecutive `status` lines.
- Acceptance: each kind renders distinctly; keyboard focus reaches buttons in cards; status runs collapse after 3 lines with "Show 12 more".
- Edge cases: unknown kind from a newer client (render as text with a type label); markdown subset (bold, code, links) for text.
- Depends on: AGENT-1.

### COMMENT-12: Action cards with Undo
- Priority: P0
- Size: M
- Interaction: after an agent applies a batch for a task it posts an `action` message: icon, one-line summary (`Changed fill to purple`), a chip with the target layer (click shows it), a diff swatch (old to new for colours, size delta for geometry), a timestamp, and `Undo` (reverts exactly that batch via AGENT-24) and `Re-apply` after undo. Replaces today's text `Done: fill is now purple.` (engine.ts:410). Undo creates a new `system` line and a `shape.updated` event the agent can see. Cards for long builds show `Built Profile card (9 layers)` with a collapsible layer list.
- Acceptance: pressing Undo reverts only that batch and the card changes to `Undone`; undo is disabled with a tooltip when a later edit conflicts (`Changed since`); the card's layer chip pans to the layer.
- Edge cases: shape deleted since (Undo restores, or disabled if blocked); card for an atomic batch of 200 (summarised); undo after reload (log persisted).
- Depends on: AGENT-1, AGENT-24, COMMENT-11.

### COMMENT-13: Proposals needing approval
- Priority: P1
- Size: M
- Interaction: `proposal` messages show a short plan (`Delete Profile card and its 9 layers`) with `Approve`, `Reject`, `Edit` (opens the composer prefilled), optional preview-on-hover (ghost the affected layers on the board in the agent's colour). Expires after N minutes or when stale. Used by AGENT-10 and by the coordinator for claim rulings.
- Acceptance: hovering the card ghosts the affected layers; Approve applies the proposal's batch and the card collapses to an action card; Reject informs the agent through an event.
- Edge cases: stale proposals (board changed); two humans approving at once (first wins, second sees `Already approved`).
- Depends on: COMMENT-11, AGENT-10.

### COMMENT-14: Rich context chips
- Priority: P1
- Size: M
- Interaction: chips in messages and the composer: layer (`Profile card › Button`, click shows it, hover highlights it on the board), frame, selection (`3 layers`), region (`area`), earlier message, agent, claim, and colour. The composer can attach the current selection as a chip with one key (`Cmd/Ctrl+L`, "add selection to chat"). Chips are structured (`{kind, id, label}`), so agents receive ids, not strings (today `ctx` is a label string plus `shapeId`, engine.ts:27, ChatPanel.tsx:138-144).
- Acceptance: chip hover outlines the layer; deleted layers show a struck-through chip; sending with 3 chips delivers 3 structured refs in the event.
- Edge cases: 20 chips (collapse to `+N`); a chip pointing at a layer on a hidden page.
- Depends on: COMMENT-11, SELECT.

### COMMENT-15: Typing indicators
- Priority: P1
- Size: S
- Interaction: `Bryan is typing...` in the thread footer for humans (debounced 1.5 s); for agents the same slot shows `Iris is writing...` while an LLM response streams. In `#general` multiple typers collapse (`3 people are typing`). Also shown as a small dot on the avatar/cursor tag.
- Acceptance: indicator appears while typing and disappears 2 s after the last key or on send; never shows for the viewer's own typing.
- Edge cases: typing in two threads; leaving mid-typing.
- Depends on: MULTI-18.

### COMMENT-16: Agent "thinking" placeholder and streaming
- Priority: P0
- Size: M
- Interaction: as soon as a task starts, a placeholder message `Iris is thinking` (animated dots, elapsed timer after 3 s, `Stop` button) appears; it is replaced in place by the real message. For LLM agents, tokens stream into the bubble; for scripted agents the placeholder is shown for the 350 ms read delay (engine.ts:388). The placeholder is a real `Msg` with `kind:'status'` and `final:false` so reload shows it correctly.
- Acceptance: sending a note shows the placeholder within 150 ms; replacing it keeps scroll position; `Stop` cancels the task.
- Edge cases: model never answers (timeout error card); user sends again while thinking (queued indicator); reduced motion (static ellipsis).
- Depends on: AGENT-8, AGENT-9, COMMENT-11.

### COMMENT-17: Keyboard focus flow between board and chat
- Priority: P1
- Size: M
- Interaction: `Enter` with a selected layer focuses the chat composer with that layer attached; `Esc` in the composer returns focus to the board (selection preserved); `Cmd/Ctrl+/` toggles focus between board and chat; `Cmd/Ctrl+K` thread switcher; `C` then click, or `Shift+C` with a selection, opens the pin popover on the selected layer. Today canvas shortcuts ignore events from inputs (Playground.tsx:152) and `Esc` only clears canvas state. Tab order: top bar, board, toolbar, left tabs, thread, composer, right panel.
- Acceptance: a keyboard-only user can select a layer, comment on it, send, return to the board and select the next; focus rings are visible; no keyboard trap.
- Edge cases: IME composition; chat collapsed (open it first); focus inside a popover when the pin vanishes.
- Depends on: COMMENT-14, SELECT.

### COMMENT-18: Hover preview of comments
- Priority: P1
- Size: S
- Interaction: hovering a pin shows a card (author, first 140 chars, count of replies, state, age) after 200 ms without opening the thread; hovering a thread in the sidebar highlights its pin and layer; hovering a chat message with a layer chip does the same.
- Acceptance: card appears within 300 ms, positioned to avoid the viewport edge; leaving the pin hides it; keyboard focus on the pin shows the same card.
- Edge cases: touch (long press); overlapping pins (cluster list).
- Depends on: COMMENT-2.

### COMMENT-19: Pin clustering and decluttering
- Priority: P1
- Size: M
- Interaction: when pins would overlap at the current zoom, group them into a `+N` bubble in the dominant colour; clicking zooms in or opens a list popover. A global "hide resolved" and an overall "show pins" toggle (exists, Playground.tsx:413). At zoom < 0.2 only badges per frame remain.
- Acceptance: 100 pins on one frame cluster into one bubble at low zoom and separate when zoomed in; no pin hides unread ones (unread always promoted).
- Edge cases: cluster crossing frame boundaries; animation while zooming.
- Depends on: COMMENT-2, COMMENT-6.

### COMMENT-20: Persistence of threads and messages
- Priority: P1
- Size: M
- Interaction: messages, threads and unread cursors survive reload via `localStorage`/IndexedDB now (behind a `Store` interface) and SpacetimeDB later; `engine.reset()` on unmount (Playground.tsx:79-81) must not wipe persisted history. Retention cap 5000 messages per board with archive.
- Acceptance: reload keeps threads, pins, resolved states and unread; a corrupt store falls back to empty without crashing.
- Edge cases: two tabs (storage events); quota exceeded (drop oldest status lines first).
- Depends on: AGENT-1.

### COMMENT-21: Composer behaviour
- Priority: P1
- Size: S
- Interaction: Enter sends, Shift+Enter newline (exists, ChatPanel.tsx:128), `Up` edits the last message when empty, `/` commands in the composer (`/pause`, `/stop`, `/speed 2`, `/claim`, `/follow Iris`, `/undo`), `@` mentions (COMMENT-8), drag a layer from the layers panel to attach (COMMENT-14), draft per thread preserved when switching.
- Acceptance: draft text survives switching threads; `/pause` pauses the thread's agent; unknown slash commands are sent as text after a confirmation hint.
- Edge cases: long paste (> 4000 chars truncated with a warning); disabled while an observer.
- Depends on: COMMENT-1, AGENT-15.

### COMMENT-22: Accessibility of the chat and pins
- Priority: P1
- Size: M
- Interaction: the message list is `role="log"` with `aria-live="polite"` announcing agent messages (not status noise); action cards and proposals have labelled buttons; unread counts have text alternatives (`3 unread messages in Iris`); pins are buttons with accessible names (`Comment 2 on Profile card › Button, open`); colour is never the only signal (state icons, text); all motion respects `prefers-reduced-motion`; focus management per COMMENT-17.
- Acceptance: VoiceOver reads new agent replies once; every control is reachable by keyboard; contrast >= 4.5:1 for message text; no live-region spam from status updates (rate-limited to 1 per 5 s).
- Edge cases: 50 agents posting at once (summarised announcement); screen reader plus thread switch.
- Depends on: COMMENT-1, COMMENT-11.

### COMMENT-23: Reactions on messages and comments
- Priority: P2
- Size: S
- Interaction: hover a message to add an emoji reaction; agents can react as an acknowledgement (`👍` = seen) which can replace short replies. Counts show as chips; the viewer's own are highlighted.
- Acceptance: reactions sync to all clients; removing toggles; agents' reactions show their avatar on hover.
- Edge cases: 100 reactions on one message (collapse).
- Depends on: COMMENT-11.

### COMMENT-24: Message search
- Priority: P2
- Size: M
- Interaction: `Cmd/Ctrl+F` in the chat focuses a search field with filters (thread, actor, kind, has-layer); results jump and highlight. Search is over text, layer names and chip labels.
- Acceptance: search finds a message in any thread and jumps to it with a highlight (like the existing focus-flash, ChatPanel.tsx:47-55).
- Edge cases: thousands of messages (index incrementally); unicode normalisation.
- Depends on: COMMENT-20.

### COMMENT-25: Export transcript
- Priority: P2
- Size: S
- Interaction: `Export` on a thread or the whole board saves Markdown (and JSON) with timestamps, actors, action cards as bullet summaries and layer names. Optional "include usage" appends tokens/cost totals (AGENT-19).
- Acceptance: exported Markdown opens cleanly; action cards read as `[Iris] Changed fill to purple (Button)`; export excludes ephemeral cursor chat.
- Edge cases: huge transcripts (stream to file); redaction of secrets (none stored).
- Depends on: COMMENT-20.

### COMMENT-26: Agent attention requests (notify the human)
- Priority: P1
- Size: S
- Interaction: an agent in `waiting_user` pulses its cursor ring, adds a red dot on its avatar, raises the thread to the top and, if the human has not looked in 10 s, shows a toast `Iris needs you: approve deleting the card` with a Jump action. Do-not-disturb mode (stage) suppresses toasts but keeps badges.
- Acceptance: a proposal triggers the badge and pulse; handling it clears the state; DND mutes toasts only.
- Edge cases: ten agents waiting (grouped toast `4 agents need you`).
- Depends on: AGENT-8, COMMENT-13.

## Data model and architecture implications

Principles: (1) every change is a command in a single ordered log; (2) presence is separate and ephemeral; (3) drivers (scripted or LLM) never touch React or the DOM; they get `exec`, `subscribe`, `snapshot`; (4) shapes keep `author` (who made it) and drop `owner` in favour of a `locks` table; (5) the types map 1:1 to Contract tables so the same board can later run on SpacetimeDB (`agent`, `claim`, `conflict`, `message`).

Where it lives: new pure-TS modules under `dashboard/src/playground/core/` (`protocol.ts`, `board-core.ts`, `choreographer.ts`, `drivers/scripted.ts`, `drivers/llm.ts`, `presence.ts`). `engine.ts` shrinks into the scripted driver plus the choreographer. Shared bindings still come only from `packages/client` once SpacetimeDB is wired (repo rule); until then these types are local to the dashboard.

```ts
// ---- actors -------------------------------------------------------------
export type ActorKind = 'human' | 'agent' | 'api' | 'system';
export type ActorId = `human:${string}` | `agent:${string}` | `api:${string}` | `system:${string}`;
export type Cap = 'read' | 'write' | 'comment' | 'claim' | 'spawn' | 'admin';
export type AgentState =
  | 'idle' | 'thinking' | 'drawing' | 'waiting_user' | 'waiting_agent'
  | 'blocked' | 'paused' | 'stopped' | 'error';

export interface Actor {
  id: ActorId; kind: ActorKind; name: string; role?: string; color: string;
  caps: Cap[]; driver?: 'scripted' | 'llm'; sessionId?: string;
}

// ---- commands (the only way to change the document) ----------------------
export type Ref = string;                         // shape id, or "$0".."$n" back-reference inside a batch
export type Command =
  | { t: 'shape.create'; shape: Omit<Shape, 'id' | 'author'> & { id?: string }; parent?: Ref }
  | { t: 'shape.update'; id: Ref; patch: Partial<Shape>; ifSeq?: number }
  | { t: 'shape.move'; ids: Ref[]; dx: number; dy: number }
  | { t: 'shape.delete'; ids: Ref[] }
  | { t: 'shape.reorder'; id: Ref; to: 'front' | 'back' | number }
  | { t: 'selection.set'; ids: Ref[] }
  | { t: 'cursor.move'; x: number; y: number; tool?: string }
  | { t: 'cursor.press'; down: boolean }
  | { t: 'status.set'; state: AgentState; detail?: string }
  | { t: 'claim.acquire'; target: ClaimTarget; mode: 'exclusive' | 'shared'; ttlMs?: number; reason?: string }
  | { t: 'claim.release'; claimId: string }
  | { t: 'lock.acquire'; ids: Ref[]; ttlMs?: number } | { t: 'lock.release'; ids: Ref[] }
  | { t: 'comment.create'; anchor: Anchor; text: string; chips?: Chip[]; to?: ActorId[] }
  | { t: 'comment.reply'; threadId: string; text: string }
  | { t: 'comment.resolve'; threadId: string; state: 'answered' | 'resolved' | 'open' }
  | { t: 'chat.say'; thread: string; body: MsgBody; to?: ActorId[]; ephemeral?: boolean }
  | { t: 'task.update'; taskId: string; state: TaskState; priority?: 0 | 1 | 2 | 3 }
  | { t: 'approval.respond'; proposalId: string; approve: boolean };

export interface Batch {
  actor: ActorId; opId: string;                  // idempotency key, e.g. `${actor}:${n}`
  commands: Command[]; atomic?: boolean; label?: string; causedBy?: string; // task or message id
  destructive?: boolean;                         // set by core after inspection, not trusted from caller
}
export type CmdError = 'not_found' | 'locked' | 'claimed_by' | 'forbidden' | 'stale' | 'invalid' | 'op_mismatch';
export type Result = { ok: true; id?: string } | { ok: false; error: CmdError; holder?: ActorId; retryAfterMs?: number; message: string };
export interface ExecResult { ok: boolean; seq: number; results: Result[]; duplicate?: boolean }

export type ClaimTarget =
  | { kind: 'frame'; id: string } | { kind: 'shape'; id: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number };
export type Anchor =
  | { kind: 'shape'; shapeId: string; fx: number; fy: number }   // fractions of the layer box
  | { kind: 'point'; x: number; y: number }                       // world coordinates
  | { kind: 'orphan'; x: number; y: number; wasShapeId: string }; // layer deleted
export type Chip = { kind: 'shape' | 'frame' | 'selection' | 'region' | 'message' | 'actor' | 'claim'; id: string; label: string };

// ---- events (what agents and UI subscribe to) -----------------------------
export type BoardEvent = { seq: number; at: number; actor: ActorId; causedBy?: string } & (
  | { t: 'shape.created' | 'shape.updated' | 'shape.deleted'; ids: string[] }
  | { t: 'selection.changed'; ids: string[] }
  | { t: 'comment.created' | 'comment.replied' | 'comment.resolved'; threadId: string; to?: ActorId[] }
  | { t: 'message.created'; messageId: string; thread: string; to?: ActorId[] }
  | { t: 'mention'; messageId: string; who: ActorId }
  | { t: 'claim.granted' | 'claim.denied' | 'claim.released'; claimId: string; holder?: ActorId }
  | { t: 'lock.revoked'; ids: string[]; by: ActorId }
  | { t: 'conflict.opened' | 'conflict.ruled'; conflictId: string }
  | { t: 'actor.joined' | 'actor.left' | 'status.changed'; who: ActorId; state?: AgentState }
  | { t: 'task.assigned' | 'task.cancelled'; taskId: string }
  | { t: 'board.paused' | 'board.resumed' });
export interface Filter { actors?: ActorId[]; kinds?: BoardEvent['t'][]; addressedTo?: ActorId; shapeIds?: string[]; coalesceMs?: number }

// ---- messages ---------------------------------------------------------------
export type MsgBody =
  | { kind: 'text'; text: string }
  | { kind: 'status'; text: string; final?: boolean }                   // "thinking" placeholder is final:false
  | { kind: 'action'; summary: string; batchSeq: number; layers: Chip[]; undone?: boolean }
  | { kind: 'proposal'; plan: string; batch: Batch; state: 'open' | 'approved' | 'rejected' | 'stale' }
  | { kind: 'routing'; to: ActorId; why: 'mention' | 'claim' | 'author' | 'frame-author' | 'role' | 'nearest' | 'manual' }
  | { kind: 'system' | 'error'; text: string };
export interface Message { id: string; thread: string; seq: number; from: ActorId; at: number; body: MsgBody; chips?: Chip[]; threadId?: string; to?: ActorId[] }

// ---- tasks, locks, claims, conflicts ------------------------------------------
export type TaskState = 'queued' | 'running' | 'done' | 'cancelled' | 'failed';
export interface Task { id: string; agent: ActorId; kind: 'note' | 'build' | 'review' | 'custom'; text: string; chips?: Chip[]; priority: 0 | 1 | 2 | 3; from: ActorId; state: TaskState; createdAt: number; pinThreadId?: string }
export interface LockRecord { shapeId: string; holder: ActorId; since: number; ttlMs: number; seq: number }
export interface Claim { id: string; holder: ActorId; target: ClaimTarget; mode: 'exclusive' | 'shared'; expiresAt: number; reason?: string }
export interface Conflict { id: string; kind: 'claim_contention' | 'overlap' | 'dependency'; actors: ActorId[]; target: ClaimTarget; state: 'open' | 'ruled' | 'dismissed'; ruling?: string }
export interface Usage { prompt_tokens: number; completion_tokens: number; cost_usd: number; estimated?: boolean }   // same shape as packages/llm

// ---- presence (ephemeral, separate bus) -------------------------------------
export interface Presence {
  actor: ActorId; sessionId: string; seq: number;
  x?: number; y?: number; down?: boolean; tool?: string;
  selection?: string[]; viewport?: { x: number; y: number; w: number; h: number; z: number };
  typing?: string;                 // thread id
  cursorChat?: string;
  state?: AgentState; detail?: string;
  lastInputAt: number; hidden?: boolean;
}
export interface PresenceBus { publish(p: Partial<Presence>): void; subscribe(cb: (all: Map<ActorId, Presence>) => void): () => void }

// ---- the board core (pure TS, no React) -------------------------------------------
export interface BoardCore {
  exec(batch: Batch): ExecResult;                       // idempotent by opId, ordered by seq
  subscribe(f: Filter, cb: (e: BoardEvent) => void): () => void;
  snapshot(o?: { region?: Rect; include?: ('shapes' | 'comments' | 'claims' | 'selection')[] }): Snapshot; // snapshot.seq for ifSeq
  log(from?: number): LogEntry[];                       // { seq, actor, opId, batch, inverse } for undo and replay
  actors(): Actor[];
}

// ---- the seam: scripted and LLM agents are the same thing -------------------------
export interface AgentContext {
  me: Actor;
  exec: BoardCore['exec'];
  subscribe: BoardCore['subscribe'];
  snapshot: BoardCore['snapshot'];
  intent(i: Intent): Promise<void>;                     // choreographer animates cursor; resolves when done
  setState(s: AgentState, detail?: string): void;
  report(u: Usage, meta?: { label: string; ms: number }): void;  // feeds AGENT-19; LLM driver forwards packages/llm onUsage
  signal: AbortSignal;                                  // pause = soft (driver checks ctx.paused()), stop = abort
  paused(): boolean;
  rng(): number;                                        // seeded, for deterministic demo scripts
}
export type Intent =
  | { t: 'move'; x: number; y: number } | { t: 'drag'; shapeId: string; toX: number; toY: number }
  | { t: 'type'; shapeId: string; text: string } | { t: 'think'; ms?: number } | { t: 'point'; shapeId: string };
export interface AgentDriver {
  readonly kind: 'scripted' | 'llm';
  start(ctx: AgentContext): void | Promise<void>;
  onTask(task: Task): Promise<void>;                    // the queue (AGENT-9) calls this one task at a time
  onEvent?(e: BoardEvent): void;                        // optional extra reactions
  stop(): void;
}
```

How the two driver kinds implement it:
- Scripted driver (today's engine.ts:290-412, wrapped): `onTask` runs `parseEdit`/`pickTemplate` regex logic, produces the same batches, and uses `ctx.intent` for the cursor choreography; templates become `shape.create` batches with back-references. Autonomous building (`runAgent` loop, engine.ts:325-346) becomes a self-issued `Task` of kind `build` when the queue is empty. It reports `Usage` zeros.
- LLM driver: `onTask` calls `snapshot()` (AGENT-21), builds a prompt, calls `decide(prompt, batchJsonSchema, { signal })` from `packages/llm` for single-shot edits, and `runWorker` in a Node bridge for long jobs. It validates the returned `commands` against the protocol, executes them as one atomic batch, then lets the choreographer animate (AGENT-23). Usage from `onUsage` goes to `ctx.report`. Abort maps to `ctx.signal`; `LLMAbortError` is treated as a clean cancel.
- Both are orchestrated by a single `AgentRuntime` that owns the queue (AGENT-9), state machine (AGENT-8), pause/stop (AGENT-15), speed (AGENT-16), claims/locks bookkeeping, and error containment (AGENT-18). Nothing agent-specific leaks into React.

Mapping of today's code:
- `Shape.owner` (engine.ts:22) becomes `LockRecord`; `Shape.author` stays. Add `Shape.parent?: string` (explicit nesting instead of geometric `inside`, which routing uses today at Playground.tsx:34-36).
- `Req` (engine.ts:29) becomes `Task`; `inbox` Map (engine.ts:179) becomes the per-agent task queue inside `AgentRuntime`.
- `CursorMeta.status: string` (engine.ts:32) becomes `{ state: AgentState; detail }`; `paused` is derivable from state.
- `Pin` (Playground.tsx:11) becomes `Thread` with `Anchor`; `done` becomes `state`. Messages gain `kind`, `chips[]`, `seq`, `threadId`.
- `window.board` becomes `createBoardApi(core)`: `exec`, `subscribe`, `snapshot` plus convenience wrappers that build commands, so old console snippets keep working for one release.
- The in-component `routeFor`/`send` (Playground.tsx:195-252) move into a `router.ts` that returns a `RoutingDecision { to, why }` and emits the `routing` message.

SpacetimeDB mapping (later, not MVP): `board_command` (append-only log, reducer `exec_batch` dedups by `op_id`), `board_presence` (ephemeral, TTL), `board_claim` (reuses the Contract `claim` shape and its contention rule), `board_conflict` (reuses Contract `conflict`), `board_message`, `board_thread`. Reducers have no network access, so LLM calls remain in Node agent processes that subscribe to events and call `exec_batch`, matching the CLAUDE.md rule.

Performance budget: presence frames <= 60 msgs/s/actor, 50 actors => ~3000 msgs/s worst case; so batch per tick (one frame per 16-50 ms containing all changed actors), and keep cursor rendering imperative (no React state). Document commands are far lower rate (batch per agent action).

## Open questions

1. Where do LLM agents run? Browser cannot call `packages/llm` (Claude Code CLI). Recommended default: a small local Node bridge (`scripts/` or `agents/`, WebSocket on localhost) that hosts `LlmDriver` instances and relays `exec/subscribe`; the dashboard only needs the `AgentDriver` seam now.
2. Is the board state local-only for the MVP, or backed by SpacetimeDB immediately? Recommended: local `BoardCore` + `PresenceBus` in memory for the hackathon MVP, with the log shaped for SpacetimeDB; add a tables adapter only after the MVP checklist passes.
3. Do humans always win locks and claims? Recommended: yes (humans override agents with a visible takeover toast), agents never override humans, agent-vs-agent decided by `seq` then the coordinator.
4. Which actions are destructive and need approval by default? Recommended: deleting a frame or more than 5 layers, and any bulk update touching > 50% of a frame; everything else is auto-approved; an "autopilot" toggle for the stage demo.
5. Claim TTL and who may rule on conflicts? Recommended: 120 s TTL with auto-extend while active; the coordinator is scripted rules now and `decide()` later, with the human able to overrule from the Coordinator panel.
6. Validation library for LLM output: zod would be a NEW dependency. Recommended: hand-written JSON schema plus a small validator (no new dependency); flag any addition for approval.
7. Per-agent chat vs one unified feed: keep per-agent threads (current) with a global `#agents` log; confirm this matches the Claude Design reference the team wants.
8. Pin numbering: global (current) or per-thread? Recommended: global stable number per thread, shown in the sidebar, not renumbered after resolve.
9. Message and board persistence for the demo: localStorage only, or file-backed? Recommended: localStorage behind a `Store` interface; reset button for the stage.
10. How should demo determinism interact with randomness (cursor bend, typing jitter)? Recommended: a seeded RNG injected into the choreographer; real randomness only outside demo-script mode.
11. Is `@all` allowed? Recommended: allowed with a confirm when more than 5 agents, to avoid accidental token spend (AGENT-19).
12. Cursor chat (`/`) conflicts with browser quick-find in some browsers and with typing `/` for slash commands in the composer. Recommended: cursor chat only when the pointer is on the canvas and no input is focused; composer `/` stays for commands.
