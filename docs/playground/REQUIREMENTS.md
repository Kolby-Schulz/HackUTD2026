# Playground requirements (architecture and scope)

Source material: the seven domain specs in `docs/playground/domains/` (CANVAS, SELECT, ALIGN, HISTORY, LAYERS/PROPS/TEXT, MULTI/AGENT/COMMENT, KEYS/SHARE/SHELL; 411 features). This file is the reconciled contract on top of them. Where a domain file disagrees with a decision below, the decision wins; the disagreement is listed under "Contradictions overridden" so a builder reading the domain file knows. The feature catalog is `FEATURES.md`; the build plan is `TASKS.md`.

## 1. Vision

The playground (`#/playground`) is a Figma / Claude Design style board on which one human and many agent cursors design at the same time. Agents are visible as named, coloured cursors that draw frames, type text and restyle layers; each agent has its own chat, and a comment dropped on a layer is routed to the agent that made it. Every change, human or agent, goes through one command API into one op log, so undo is per actor, an agent can never silently overwrite the human, and the same log can later be mirrored to SpacetimeDB to make the board the visual front end of Contract (agents = `agent`, frames = `claim`, contention = `conflict`). For the hackathon the board runs entirely in the browser with scripted agents behind a driver seam that an LLM driver (via `packages/llm`, in a Node bridge) can fill later.

## 2. Demo story (3 minutes)

Each beat lists what the audience sees and the feature IDs it needs. Every ID below is P0 unless marked.

1. **0:00 Empty board, team waiting.** `#/playground?demo=1` opens a light dotted board, three idle agents in the presence list, demo bar at the bottom. Needs SHELL-1, SHELL-6, SHELL-26 (P1), AGENT-17, MULTI-5, CANVAS-14.
2. **0:15 Human draws a frame.** Press F, drag a frame; it snaps to integer values, a W x H pill follows, one undo entry is recorded. Needs KEYS-3, SELECT-38, SELECT-39, SELECT-30, ALIGN-1, ALIGN-2, ALIGN-7, HISTORY-7, CANVAS-22.
3. **0:30 Ask the team.** In the general chat: "build a landing page: hero, stats, profile card". A routing card shows who got what; three cursors race in with name tags, claim frames (dashed outline in their colour), and build templates with children nested under the frame; the layers tree fills live. Needs COMMENT-1, COMMENT-11, COMMENT-9, AGENT-9, AGENT-11, AGENT-23, AGENT-8, MULTI-1, MULTI-2, MULTI-3, MULTI-6, MULTI-7, LAYERS-1, LAYERS-16, HISTORY-3, AGENT-1.
4. **1:00 Contention.** Two agents want the same frame: the second is denied (`claimed_by`), says so in its chat and picks another slot; a coordinator card explains the ruling. Needs AGENT-11, COMMENT-11, AGENT-13 (P1, conflict card).
5. **1:20 Humans win.** The human drags a rectangle an agent is still drawing; the agent's lock is revoked, a toast says "You took over from Iris", the agent re-plans. Needs MULTI-8, AGENT-12, AGENT-29 (P1), SHELL-9.
6. **1:35 Comment routes to the author.** Comment tool on the hero button: "make it purple". The pin shows "to Iris (made this)", a thinking placeholder appears in Iris's chat, her cursor flies to the button and recolours it, an action card with Undo appears. Needs COMMENT-2, COMMENT-4, COMMENT-9, COMMENT-16, COMMENT-12, AGENT-20, AGENT-9.
7. **1:55 Per-actor undo.** Undo on the action card reverts only Iris's change; the human's Cmd+Z undoes the human's own last move and leaves agent work intact. Needs HISTORY-10, HISTORY-11, HISTORY-6, COMMENT-12.
8. **2:10 Direct manipulation.** Marquee three cards, align tops, resize with Shift, change fill in the inspector, rename a layer in the tree. Needs SELECT-8, SELECT-13, SELECT-15, ALIGN-11, PROPS-1, PROPS-11, PROPS-12, LAYERS-4, LAYERS-7.
9. **2:30 Get it out.** Cmd+K, type "export", PNG of the selection downloads; Share copies a link with the view. Needs KEYS-9, SHARE-4, SHARE-1, SHARE-2.
10. **2:45 Scale.** Shift+1 fits the board; `board.stress({agents: 50})` adds 50 cursors; the HUD shows ~60 fps. Needs CANVAS-10, CANVAS-13, MULTI-16, CANVAS-18, CANVAS-44, CANVAS-34.
11. **3:00 It survives reload.** Reload: board and chat come back; agents restart idle. Needs HISTORY-30, HISTORY-28, COMMENT-20 (P1).

## 3. Design principles

1. **Humans win.** A human edit always succeeds over an agent lock or claim; agents yield, re-plan and say so. Agents never block humans; agent vs agent is decided by claim order, then the coordinator.
2. **Every edit is an op.** The document changes only through ops tagged with an actor and an idempotent `actor:seq` id. No `setShapes`, no direct store writes from UI code.
3. **Agents use the same commands.** Human UI, scripted agents, the console (`window.board`) and future LLM agents call one command API with identical semantics, permissions and undo.
4. **Presence is not document.** Cursors, selections, soft locks, claims, typing and viewports live on an ephemeral bus; they are never saved, never undone, never in the op log.
5. **60 fps with 50 cursors and 2k shapes.** React renders on document changes only; camera, cursors, guides and gesture previews are written once per frame outside React.
6. **One of each.** One camera store, one rAF scheduler, one hit-test, one snapping module, one key dispatcher, one action registry. Agents snap and hit-test with the same functions as the human.
7. **Pure core, thin UI.** `core/`, `presence/` and `agents/` import no React and no DOM (except `render/measure.ts`); they are unit-tested with vitest.
8. **One owner per file per wave.** The module layout below exists so parallel agents never edit the same file at the same time.
9. **Demo first.** Deterministic, seeded, resettable; nothing in the demo path depends on the network.
10. **No new runtime dependencies.** Hand-roll the small things (fractional index, spatial grid, fuzzy search, colour picker, number parser, validator).

## 4. Scope

- **P0 = demo MVP.** Everything needed for the beat sheet above plus the foundation that makes it safe (store, ops, undo, commands, camera, hit-test, keys). 183 features. The MVP is done when the demo checklist in `TASKS.md` passes twice in a row with no console errors.
- **P1 = makes it feel like Figma.** Minimap, follow, off-screen indicators, rotation, distribute, spacing guides, clipboard JSON, board file import/export, help overlay, LLM driver seam. 166 features; 91 are packaged (49 of them in Wave 3, the rest ride along in Waves 0-2), 75 are backlog.
- **P2 = parking lot.** 62 features (pen tool, gradients, components, pages, rich text, touch, time travel, SpacetimeDB multi-human sync). Not packaged.

Non-goals for the hackathon:
- Real multi-user sync between browsers (MULTI-23). Links restore the view, not the content.
- Access control. View-only (SHARE-3) is a UI mode, not security.
- Canvas2D/WebGL rendering of shapes; vector editing; components; auto-layout; pages.
- Running LLM agents in the browser. The browser only has the `AgentDriver` seam; any LLM driver runs in Node via `packages/llm`.
- Dark board theme (SHELL-7 stays P1; board chrome is light).
- New SpacetimeDB tables (`pg_*` / `board_*`). The op log is shaped for them but nothing is published.

## 5. Architecture decisions

**D1. Hierarchy: flat map with explicit `parent`, local coordinates, derived tree.** Shapes live in `Map<ShapeId, Shape>`; each has `parent: ShapeId | null`. Child `x, y` are relative to the parent's top-left. A `children` index (sorted by `index`, then `id`) is derived on change and is the only place sibling order is read. `inside()` / `frameOf()` geometric membership is deleted; agents create children with `parent: frameId` and template-relative offsets. Moving a frame is one write; reparent is one `place` op and undoes cleanly; the record maps 1:1 to a future table row. Rejected: nested tree object (ops cannot address nodes by id cheaply, reparent becomes a subtree move); today's flat array with geometric membership (membership flips at frame edges, ambiguous with overlapping frames, reparent cannot be undone, agents cannot say "put this in that frame"); absolute child coordinates with a parent link (moving a frame rewrites every child). Domains: HISTORY-3, SELECT-40, ALIGN-33, LAYERS-1.

**D2. Ordering: fractional string index per parent, hand-rolled.** Each shape has `index: string`, a base62 key; `between(a?, b?)` in `core/order.ts` (~40 lines, property-tested) produces a key strictly between two neighbours. Ties break by `id`. Reorder is one write and concurrent inserts by 12 agents never rewrite a list. Rejected: array position (whole-list rewrites, conflicts on concurrent insert); integer z with gaps (renumbering storms); the `fractional-indexing` package (new dependency for 40 lines). Domains: HISTORY-4, SELECT-40, LAYERS-10.

**D3. Document store outside React; ops, transactions, per-actor undo, LWW.** `core/store.ts` holds immutable records and a `rev` counter; React reads it through `useSyncExternalStore` (`useDoc`, `useShape`, `useChildren`). Every change is an `OpEnvelope { opId: 'actor:seq', actor, lamport, tx, body }`; `applyOp` is pure and idempotent on `opId`. Conflicts resolve per field by last-writer-wins on `(lamport, actor)`; delete is a tombstone (`deleted: true`) so undo restores the same id and comment pins survive. Gestures open a transaction (`begin` → `apply` per frame → `commit` or `abort`), so one drag, one resize, one typing burst or one agent template build is one undo entry. Undo stacks are per actor; undo emits new ops built from the stored inverse and skips any field another actor has written since (the skip is reported in a toast). Rejected: React state as the document (per-frame whole-array copies, no actor, no undo); global undo stack (human Cmd+Z would revert agents); force-apply undo (clobbers agents); a CRDT library (dependency, overkill for field LWW). Domains: HISTORY-1, 5, 7, 10, 11, 12, 35, 36; AGENT-2, AGENT-24.

**D4. One command API; AgentDriver seam; presence on a separate bus.** `core/commands.ts` exposes `board.exec(batch)` for discrete commands and `board.gesture(actor, label)` for continuous ones; commands validate, consult the gate (locks, claims, capabilities), compile to ops and emit `BoardEvent`s. The human UI, scripted agents, `window.board` (a thin console shim over `exec`) and LLM agents use exactly this. Agents implement `AgentDriver` and act only through `AgentContext` (`exec`, `subscribe`, `snapshot`, `intent`); a `Choreographer` turns intents into cursor motion so a driver that returns data still draws believably. Presence (cursor position, selection, soft locks, claims, typing, viewport, agent state) lives on `presence/bus.ts`; `Shape.owner` is removed. Rejected: keeping `window.board` as the agent API (no actor, no undo, no errors); letting agents patch the store (bypasses gate and history); presence inside shape records (pollutes undo and persistence). Domains: AGENT-1, 3, 5, 6, 23; SELECT-46; MULTI-18; HISTORY-38, 39.

**D5. Rendering stays DOM, with culling, a shared spatial grid, a camera store and one rAF scheduler.** Shapes render as nested DOM (`<div>` per shape, children inside parents, frames clip with `overflow: hidden`). Off-screen subtrees are not mounted (CANVAS-18). `core/spatial.ts` is a uniform grid (512-unit cells) over world AABBs, maintained from store change events and shared by culling, hit-testing, marquee, snapping and the minimap. The camera is a mutable store in `core/camera.ts`; wheel and drag mutate it and one rAF flush writes the world transform, dot grid and overlays. `core/raf.ts` is the only `requestAnimationFrame` loop; it sleeps when idle and when the tab is hidden. Overlays (selection, guides, remote outlines) render in a screen-space layer positioned with `worldToScreen`, so they stay crisp at any zoom. Rejected: Canvas2D/WebGL for shapes (text editing, IME, CSS effects and debugging all get harder; DOM with culling meets the 2k-shape budget); `rbush` (dependency for 60 lines); camera in React state (whole-tree re-render per wheel tick). Domains: CANVAS-1, 2, 13, 15, 18, 19, 33, 34; SELECT-47; ALIGN-9.

**D6. One hit-test, one snapping module, both callable by agents.** `core/hittest.ts` exports `hitTest(pt, opts)` (screen tolerance `4/z`, ellipse and radius aware, topmost by tree order, skips hidden and locked, `deep` for Cmd-click, container rules for frames) used by every gesture, the comment tool and the agent choreographer. `core/snap.ts` exports `snapMove`, `snapResize`, `snapCreate`; gestures call them with a screen threshold (5 px / z) and agents call them through `board.snap(...)` with a 2-unit threshold so agent output lines up. Rejected: per-domain hit-test copies (human and agent disagree on what was clicked); agents placing raw coordinates (untidy demo). Domains: CANVAS-21, SELECT-2, ALIGN-1, ALIGN-10.

**D7. One action registry, one key dispatcher with focus contexts.** UI actions (not to be confused with board commands) are registered as `Action { id, title, group, keys, contexts, when, run }` in `core/actions.ts`; each area owns one file under `actions/`. `core/keys.ts` is the only `keydown` listener: it derives the focus context from `data-pg-ctx` on the focused element, matches platform bindings (`Mod` = Cmd on mac, Ctrl elsewhere, punctuation by `e.code`), prevents browser clashes (Cmd+D, Cmd+G, Cmd+[, Cmd+=, Cmd+0, Cmd+K) and leaves text contexts alone. Tooltips, the help overlay, menus and the command palette read the same registry. Rejected: per-component key handlers (today's swallowed modifier combos and broken text guards); a separate palette command list (drifts from keys). Domains: KEYS-1, 2, 6, 9; SELECT keymap note.

**D8. Humans win every lock and conflict; claims echo Contract.** Soft locks (`presence/locks.ts`) mark shapes an actor is dragging or editing; an agent command on a shape locked by another actor fails with `locked`; a human command on an agent-locked shape succeeds and revokes the lock (`lock.revoked` event, toast, agent re-plans). Claims (`presence/claims.ts`) reserve a frame, shape or rect for an agent with a TTL (default 120 s, auto-extended while active); other agents' writes inside an exclusive claim fail with `claimed_by`; repeated contention opens a `Conflict { kind: 'claim_contention' }` that a scripted coordinator rules on, mirroring Contract's `claim` / `conflict` tables. Humans are never blocked by claims, only warned. Rejected: hard locks for humans (frustrating, wrong for a demo about human control); no locks (agents fight over a shape mid-drag). Domains: MULTI-8, AGENT-11, 12, 13, 29.

**D9. Dependencies: vitest only.** vitest `^3.2.7` is already installed at the root and used by five workspaces; `dashboard/package.json` already has `"test": "vitest run"` and `dashboard/test/model.test.ts`, but does not declare the dependency. WP-01 adds `"vitest": "^3.2.7"` to `dashboard` devDependencies (no new package enters `node_modules`). No `rbush`, `zod`, `fuse.js`, `pixi.js`, `fractional-indexing`, `happy-dom`, `axe-core`, colour-picker or virtual-list packages. Tests live next to sources as `*.test.ts` and must not need a DOM; anything DOM-bound is checked in the browser by the reviewer. Rejected: happy-dom/Playwright (new deps; manual browser checks are enough for a hackathon).

**D10. Light board, localStorage, own ids, browser text measurement.** The board is a light island (`color-scheme: light`) inside the dark dashboard; colours come from tokens in `styles/tokens.css`. Persistence is localStorage: `pg.board.v1.<boardId>` (doc snapshot, chat and pins in `extras`, log tail, actor seqs) and `pg.prefs.v1` (panels, view, toggles), behind try/catch, written on a 500 ms idle debounce and on `pagehide`. Ids come from `core/ids.ts`: `newId(prefix)` = prefix + time-ordered base36 + 6 random base62 chars, collision-free across reloads and tabs; op ids are `${actor}:${seq}` with seqs persisted. Text is measured in the browser (`render/measure.ts`, canvas `measureText` plus a hidden DOM probe for wrapping); agents create text with approximate sizes and the host re-measures and writes back as a system edit. Rejected: IndexedDB (async, more code; revisit past 2 MB); session counters (collide after reload, today's bug); measuring in agents (no DOM).

### Contradictions overridden

- **Field names.** SELECT/ALIGN/LAYERS use `parentId`, `z`/`order`, `visible`; MULTI uses `Shape.parent?`. Decision: `parent: ShapeId | null`, `index: string`, `hidden?: boolean` (undefined = visible, avoiding "visible undefined = true").
- **Op `move`.** HISTORY's op `move` (reparent/reorder) collides with MULTI's command `shape.move` (translate). Decision: the op is `place {id, parent, index}`; translation is the command `shape.translate`.
- **Styles.** HISTORY-27/41 use `fill: Paint` (string) and `stroke?`; LAYERS uses `fills[]`, `strokes[]`, `effects[]`. Decision: `fills: Paint[]`, `strokes?: Stroke[]`, `effects?: Effect[]` (solid paints only in P0); legacy `fill`/`color` are migrated by the loader and accepted by the agent shim.
- **Text.** LAYERS nests typography in `text: {content, font, size, ...}`. Field-level LWW would then treat all typography as one field. Decision: flat fields (`text`, `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textAlign`, `textVAlign`, `textMode`, `color`).
- **Actor ids.** MULTI uses `human:x` / `agent:x`; HISTORY uses `human`, `agent-2`. Decision: `${kind}-${short}` (`human-you`, `agent-k3f9`) so op ids `actor:seq` stay unambiguous.
- **Two kinds of "Command".** KEYS calls registry entries `Command`; MULTI calls protocol messages `Command`. Decision: protocol = `Command` (`core/commands.ts`), registry entry = `Action` (`core/actions.ts`).
- **Locks in the protocol.** AGENT-12 makes `lock.acquire/release` board commands. Decision: locks are presence (D4); gestures acquire them automatically and the gate reads them; there is no lock command in the op log.
- **File layout.** Each domain proposed its own files (`doc.ts`, `geometry.ts`, `keymap.ts`, `snap.ts`, `protocol.ts`, `board-core.ts`, `shortcuts.ts`, `dispatcher.ts`, ...). Decision: the module layout in section 6.
- **Spatial index.** ALIGN proposes per-axis 1-D buckets (256) plus a 512 grid. Decision: one 512-unit grid; snapping queries candidates by rect and builds lines from them.
- **Guide rendering.** ALIGN renders guides as SVG inside the world transform; CANVAS-35 proposes an overlay canvas. Decision: P0 overlays are a screen-space DOM/SVG layer (CANVAS-15 preferred approach); the overlay canvas stays P1.
- **Storage keys.** HISTORY `contract.playground.board.<id>`, CANVAS `pg.view.v1`, KEYS `pg.prefs.v1`. Decision: `pg.board.v1.<boardId>` and `pg.prefs.v1` (view lives in prefs and the URL).
- **Empty-canvas drag.** CANVAS-6 keeps panning by default until marquee exists. Decision: marquee wins once WP-17 lands; pan is Space, middle button, Hand tool and wheel.
- **Text editor keys.** Today Enter commits. Decision (LAYERS Q4, Figma): Enter inserts a newline, Esc or click-away commits.
- **Undo of other actors.** AGENT-24 lets the UI undo any agent batch. Decision: Cmd+Z is the human's own stack only; undoing an agent batch is an explicit action (action card Undo, HISTORY-18 Revert) that uses the same skip-superseded filter.

## 6. Target module layout (after Wave 0)

All paths are under `dashboard/src/playground/`. "Owner" is the work package that creates the file; after its wave, ownership passes only by explicit assignment in `TASKS.md`. Files marked **frozen** change only through the orchestrator (append-only, announced to running agents).

### core/ (pure TS, no React, unit-tested)

| File | Responsibility | Domain | Owner |
| --- | --- | --- | --- |
| `core/types.ts` | All shared types in section 7. **Frozen** after WP-01. | all | WP-01 |
| `core/ids.ts` | `newId(prefix)`, actor seq counters, `opId(actor)`; seqs restorable from save. | HISTORY | WP-01 |
| `core/order.ts` | `between(a?, b?)`, `sortKeys`, `keysBetween(n)`; base62 fractional index. | HISTORY | WP-01 |
| `core/geom.ts` | `Rect`, `Pt`, `union`, `intersects`, `contains`, `norm`, `rotatePoint`, matrix helpers. | SELECT/CANVAS | WP-01 |
| `core/tree.ts` | `buildChildren`, `absRect(id)`, `toLocal`, `toWorld`, `ancestors`, `isDescendant`, `flatten` (render order), `frameAt(pt)`. | HISTORY/SELECT | WP-01 |
| `core/ops.ts` | Pure `applyOp(state, env)`: create, set, place, remove, restore, board; LWW stamps; idempotency on `opId`. | HISTORY | WP-02 |
| `core/store.ts` | `DocStore`: state, `rev`, subscribe, subscribeShape, dispatch, begin/apply/commit/abort, transient frames, `applyRemote`, `log`, snapshot/load, spatial change feed. | HISTORY | WP-03 |
| `core/react.ts` | `useDoc`, `useShape`, `useChildren`, `useSelection`, `useCamera` hooks (`useSyncExternalStore`). | HISTORY | WP-03 |
| `core/undo.ts` | Per-actor undo/redo stacks, skip-superseded filter, `revertTx`, coalescing keys. | HISTORY | WP-04 |
| `core/commands.ts` | `createBoard()`: `exec(batch)`, `gesture()`, `undo/redo/revert`, `snapshot`, back-references `$n`, atomic batches, gate check, op compilation. | AGENT/SELECT | WP-08 |
| `core/gate.ts` | Composes `locks.check` + `claims.check` + capabilities; humans-win rule. **Frozen** after WP-08 (logic lives in presence/). | MULTI | WP-08 |
| `core/events.ts` | `BoardEvent` bus with filters and coalescing. | AGENT | WP-09 |
| `core/actors.ts` | Actor registry (id, kind, name, colour, caps, driver). | AGENT | WP-09 |
| `core/devtools.ts` | `window.board` shim over `exec` (legacy `addShape/updateShape/shapes/cursors` kept), `board.stress`, `board.debug`. | AGENT | WP-08 |
| `core/camera.ts` | Camera store, `screenToWorld`, `worldToScreen`, `visibleWorldRect`, `zoomAt`, `fitRect`, view rect cache. | CANVAS | WP-05 |
| `core/raf.ts` | Single rAF scheduler with priorities, idle sleep, hidden-tab pause, frame stats. | CANVAS | WP-05 |
| `core/tween.ts`, `core/goto.ts` | Animated camera moves, `goTo(target)` with pulse. | CANVAS | WP-29 |
| `core/spatial.ts` | Uniform grid index: `queryRect`, `queryPoint`, incremental update from store changes. | CANVAS/ALIGN | WP-06 |
| `core/hittest.ts` | The one `hitTest(pt, opts)`. | CANVAS/SELECT | WP-06 |
| `core/snap.ts` + `core/snap/*.ts` | Facade `snapMove/snapResize/snapCreate` (stub in Wave 0), implementations in `snap/move.ts`, `snap/resize.ts`, snap result store for guides. | ALIGN | WP-06 (facade), WP-23, WP-52 |
| `core/align.ts` | Align/distribute/match-size as pure functions returning command batches. | ALIGN | WP-24 |
| `core/resize.ts` | Pure `resizeBox(orig, handle, pt, mods)`. | SELECT | WP-15 |
| `core/actions.ts`, `core/keys.ts` | Action registry; the only keydown dispatcher, focus contexts, platform labels. | KEYS | WP-07 |
| `core/prefs.ts`, `core/flags.ts`, `core/toast.ts` | Persisted prefs store; feature flags (`?flag=`); toast queue API. | SHELL | WP-07 |
| `core/clipboard.ts` | Copy/cut/paste payloads, paste placement. | HISTORY | WP-35 |
| `core/persist.ts` | `SavedBoard`, migrations, autosave, load on boot, extras slot. | HISTORY | WP-36 |
| `core/url.ts` | `encodeView` / `decodeView` (center + zoom + selection). | SHARE | WP-48 |
| `core/export.ts` | `boundsOf`, `renderToCanvas(ctx, shapes, opts)`, `downloadBlob`. | SHARE | WP-51 |
| `core/numexpr.ts`, `core/color.ts`, `core/fuzzy.ts` | Arithmetic parser, HSV/hex math, fuzzy match. | PROPS/KEYS | WP-26, WP-49, WP-47 |
| `core/perf.ts`, `core/bench.ts` | FPS/frame stats, `board.bench(n)`. | CANVAS/SHELL | WP-33, WP-32 |

### presence/ (ephemeral, no React)

| File | Responsibility | Domain | Owner |
| --- | --- | --- | --- |
| `presence/bus.ts` | `PresenceBus`: publish/subscribe, per-frame batching, TTL. | MULTI | WP-09 |
| `presence/selection.ts` | Per-actor selection sets, primary, scope; human selection store. | SELECT | WP-09 |
| `presence/locks.ts` | Soft locks, auto-acquire on gesture, revoke on human takeover. | MULTI | WP-09 (stub), WP-39 |
| `presence/claims.ts` | Claims with TTL, contention counting, conflicts. | AGENT | WP-09 (stub), WP-40 |
| `presence/colors.ts` | Actor colour assignment, collision avoidance. | MULTI | WP-37 |
| `presence/cursors.ts` | Imperative cursor painter (rAF subscriber), smoothing, declutter. | MULTI | WP-37 |

### agents/ (no React)

| File | Responsibility | Domain | Owner |
| --- | --- | --- | --- |
| `agents/runtime.ts` | `AgentRuntime`: spawn/stop/remove, state machine, task queue, pause, speed, error containment. | AGENT | WP-10, then WP-41 |
| `agents/choreographer.ts` | Intent to cursor motion (moveTo, drag, type cadence, think), seeded RNG, time budget. | AGENT | WP-10 |
| `agents/scripted.ts`, `agents/templates.ts`, `agents/intent.ts` | Scripted driver, design templates, `parseEdit` (today's engine.ts). | AGENT | WP-10 |
| `agents/router.ts` | Routing policy: mention, claim, author, frame author, nearest, general. | COMMENT | WP-63 |
| `agents/demo.ts`, `agents/seed.ts` | Demo script runner; seed and reset. | AGENT/SHELL | WP-66, WP-67 |
| `agents/coordinator.ts` | Scripted conflict ruling. | AGENT | WP-68 |
| `agents/llm.ts` | LLM driver seam (bridge client). | AGENT | WP-83 |
| `chat/store.ts`, `comments/threads.ts` | Messages and threads; comment pins with anchors. | COMMENT | WP-42, WP-43 |

### ui/, render/, actions/, styles/

| File | Responsibility | Owner |
| --- | --- | --- |
| `Playground.tsx` | One-line re-export of `ui/Playground.tsx` (keeps `main.tsx` untouched). | WP-12 |
| `ui/Playground.tsx` | Composition root: creates board, runtime, presence; mounts shell, board and every slot. **Frozen** after WP-12. | WP-12 |
| `ui/board/Board.tsx`, `ui/board/ShapeView.tsx`, `render/style.ts` | Viewport, world layer, nested shape rendering of every `ShapeProps` field, overlay layer mount. | WP-11 |
| `ui/gestures/pipeline.ts` + `{select,move,resize,create,marquee,pan,text,comment}.ts` | Pointer state machine and one file per gesture mode. | WP-11 (skeleton), Wave 1 owners |
| `ui/overlays/*.tsx` | SelectionBox, Readout, Hover, Marquee, SmartGuides, RemoteSelections, Claims, OffscreenChips, Measure. | WP-11 (stubs), feature owners |
| `ui/shell/*.tsx` | TopBar, Toolbar, Panels, Toasts, ContextMenu, Dialog, ErrorBoundary, Tooltip, FollowBanner. | WP-12 (stubs), feature owners |
| `ui/layers/*`, `ui/inspector/*`, `ui/chat/*`, `ui/comments/*`, `ui/text/*` | Panels and editors. | WP-12 (stubs), feature owners |
| `ui/{ZoomMenu,CommandPalette,PresenceList,AgentsPanel,Cursors,DebugHud,Minimap,DemoBar,HelpOverlay,Present}.tsx` | Single-purpose UI slots. | WP-12 (stubs), feature owners |
| `render/measure.ts` | Browser text measurement. | WP-50 |
| `actions/index.ts` | Imports every `actions/*.ts`. **Frozen** after WP-07. | WP-07 |
| `actions/{tools,edit,clipboard,arrange,layers,view,panels,share,text,agents,file,demo,present}.ts` | One action file per area. | WP-07 (empty), feature owners |
| `styles/tokens.css`, `styles/base.css` | Tokens and resets. Read-only for everyone after WP-12. | WP-12 |
| `styles/<area>.css` | One stylesheet per component area, imported by its own component. | feature owners |

Legacy files: `engine.ts` is deleted by WP-10 (its code moves to `agents/`); `ChatPanel.tsx` moves to `ui/chat/ChatPanel.tsx` and `playground.css` splits into `styles/` in WP-12.

### Fixed action ids

Action ids are part of the contract so menus, palette and toolbar can be built in parallel with the actions themselves: `tool.select|frame|rect|ellipse|text|hand|comment`; `edit.undo|redo|delete|duplicate|selectAll|escape`; `clipboard.copy|cut|paste|pasteInPlace`; `arrange.nudge` (args `{dx,dy}`), `arrange.front|back|forward|backward|group|ungroup|frameSelection`; `layers.lock|hide|rename`; `align.left|hcenter|right|top|vcenter|bottom`; `view.zoomIn|zoomOut|zoomFit|zoomSelection|zoom100|zoom50|zoom200|toggleDebug`; `panel.left|right|ui`; `share.copyLink|exportPng`; `palette.open`; `help.shortcuts`; `agents.pauseAll|resumeAll|stopAll|spawn`; `file.export|import`; `demo.play|next|reset`; `present.start`.

## 7. Core types (reconciled sketch for `core/types.ts`)

```ts
// ---- ids and actors ----
export type ShapeId = string;
export type ActorKind = 'human' | 'agent' | 'api' | 'system';
export type ActorId = string;                         // `${kind}-${short}`: 'human-you', 'agent-k3f9'
export type Cap = 'read' | 'write' | 'comment' | 'claim' | 'spawn' | 'admin';
export interface Actor { id: ActorId; kind: ActorKind; name: string; color: string; caps: Cap[]; role?: string; driver?: 'scripted' | 'llm' }

// ---- geometry ----
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Cam = { x: number; y: number; z: number };  // screen translation of world origin (css px), scale

// ---- shapes ----
export type Kind = 'frame' | 'group' | 'rect' | 'ellipse' | 'text' | 'line' | 'image'; // line/image: type only in P0
export type Paint = { type: 'solid'; color: string; opacity?: number; hidden?: boolean };   // gradients P2
export type Stroke = { color: string; width: number; align?: 'inside' | 'center' | 'outside'; hidden?: boolean };
export type Effect = { type: 'drop' | 'inner' | 'blur'; x: number; y: number; blur: number; spread?: number; color: string; hidden?: boolean };
export type Constraint = { h: 'left' | 'right' | 'leftright' | 'center' | 'scale'; v: 'top' | 'bottom' | 'topbottom' | 'center' | 'scale' }; // P1

export type ShapeProps = {                            // every field is LWW'd independently
  name: string; nameAuto?: boolean;
  x: number; y: number; w: number; h: number;         // parent space, unrotated box
  rotation?: number; flipX?: boolean; flipY?: boolean; // degrees clockwise about center (P1 UI)
  hidden?: boolean; locked?: boolean; opacity?: number;
  fills: Paint[]; strokes?: Stroke[]; effects?: Effect[];
  radius?: number | [number, number, number, number];
  clip?: boolean; lockRatio?: boolean;                // clip default true for frames
  text?: string; fontFamily?: string; fontSize?: number; fontWeight?: number;
  lineHeight?: number | 'auto'; letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify'; textVAlign?: 'top' | 'middle' | 'bottom';
  textMode?: 'auto-w' | 'auto-h' | 'fixed'; color?: string; humanEdited?: boolean;
  constraints?: Constraint;                           // P1
  author?: ActorId;                                   // who made / owns it for routing (reassignable)
};
export type Stamp = readonly [lamport: number, actor: ActorId];
export type Shape = ShapeProps & {
  id: ShapeId; kind: Kind;                            // kind immutable after create
  parent: ShapeId | null; index: string;              // D1, D2
  createdBy: ActorId; deleted?: true;                 // tombstone
  stamps: Partial<Record<keyof ShapeProps | 'place' | 'deleted', Stamp>>;
};

// ---- ops (replayable, idempotent) ----
export type Op =
  | { t: 'create'; shape: Omit<Shape, 'stamps' | 'deleted'> }
  | { t: 'set'; id: ShapeId; patch: Partial<ShapeProps> }
  | { t: 'place'; id: ShapeId; parent: ShapeId | null; index: string }
  | { t: 'remove'; id: ShapeId } | { t: 'restore'; id: ShapeId }
  | { t: 'board'; patch: Partial<BoardMeta> };
export type BoardMeta = { name: string; background?: string };
export type OpEnvelope = { opId: string; actor: ActorId; lamport: number; ts: number; tx: string; session?: string; body: Op };
export type Tx = {
  id: string; actor: ActorId; label: string; ops: Op[]; inverse: Op[];
  produced: Array<{ id: ShapeId; field: string; stamp: Stamp }>;
  coalesceKey?: string; ts: number; sel?: { before: ShapeId[]; after: ShapeId[] }; causedBy?: string;
};
export type DocState = { rev: number; lamport: number; shapes: ReadonlyMap<ShapeId, Shape>; children: ReadonlyMap<ShapeId | null, readonly ShapeId[]>; meta: BoardMeta };
export interface TxHandle { apply(ops: Op[]): void; commit(): Tx | null; abort(): void }
export interface DocStore {
  getState(): DocState; subscribe(l: () => void): () => void; subscribeShape(id: ShapeId, l: () => void): () => void;
  dispatch(actor: ActorId, label: string, ops: Op[], o?: { coalesceKey?: string; causedBy?: string }): Tx | null;
  begin(actor: ActorId, label: string, o?: { coalesceKey?: string }): TxHandle;
  applyRemote(envs: OpEnvelope[]): void; log(from?: number): readonly OpEnvelope[];
  onChange(l: (ids: ShapeId[]) => void): () => void;  // feeds spatial index, culling, events
  snapshot(): SavedBoard; load(b: SavedBoard): void;
}

// ---- board commands (the one API; D4) ----
export type Ref = ShapeId | `$${number}`;            // $n = id created by command n of this batch
export type Command =
  | { t: 'shape.create'; kind: Kind; props: Partial<ShapeProps>; parent?: Ref | null; at?: 'top' | 'bottom' | { after: Ref }; id?: ShapeId }
  | { t: 'shape.update'; ids: Ref[]; patch: Partial<ShapeProps> }
  | { t: 'shape.translate'; ids: Ref[]; dx: number; dy: number }
  | { t: 'shape.resize'; id: Ref; box: Rect }        // box in parent space
  | { t: 'shape.delete'; ids: Ref[] }
  | { t: 'shape.duplicate'; ids: Ref[]; offset?: Pt }
  | { t: 'shape.reparent'; ids: Ref[]; parent: Ref | null; at?: 'top' | 'bottom' | { after: Ref }; keepWorld?: boolean }
  | { t: 'shape.reorder'; ids: Ref[]; to: 'front' | 'back' | 'forward' | 'backward' }
  | { t: 'shape.group'; ids: Ref[]; as?: 'group' | 'frame'; name?: string }
  | { t: 'shape.ungroup'; ids: Ref[] }
  | { t: 'selection.set'; ids: Ref[] }                // presence, not an op
  | { t: 'comment.create'; anchor: Anchor; text: string; to?: ActorId[] }
  | { t: 'comment.reply'; threadId: string; text: string }
  | { t: 'comment.resolve'; threadId: string; state: 'open' | 'answered' | 'resolved' }
  | { t: 'chat.say'; thread: string; body: MsgBody; to?: ActorId[] }
  | { t: 'claim.acquire'; target: ClaimTarget; ttlMs?: number; reason?: string }
  | { t: 'claim.release'; claimId: string }
  | { t: 'status.set'; state: AgentState; detail?: string };
export interface Batch { actor: ActorId; opId: string; commands: Command[]; atomic?: boolean; label?: string; causedBy?: string }
export type CmdError = 'not_found' | 'locked' | 'claimed_by' | 'forbidden' | 'stale' | 'invalid' | 'duplicate';
export type Result = { ok: true; id?: ShapeId } | { ok: false; error: CmdError; holder?: ActorId; message: string };
export interface ExecResult { ok: boolean; seq: number; tx?: string; results: Result[]; duplicate?: boolean }
export interface Gesture { update(cmds: Command[]): void; commit(): ExecResult; abort(): void } // update re-applies from the base snapshot
export interface Board {
  exec(b: Batch): ExecResult; gesture(actor: ActorId, label: string, o?: { coalesceKey?: string }): Gesture;
  undo(actor: ActorId): boolean; redo(actor: ActorId): boolean; revert(by: ActorId, txId: string): Result;
  subscribe(f: Filter, cb: (e: BoardEvent) => void): () => void;
  snapshot(o?: { region?: Rect }): Snapshot; doc: DocStore; presence: PresenceBus; actors: ActorRegistry;
}

// ---- events ----
export type BoardEvent = { seq: number; at: number; actor: ActorId; causedBy?: string } & (
  | { t: 'shape.created' | 'shape.updated' | 'shape.deleted'; ids: ShapeId[] }
  | { t: 'selection.changed'; ids: ShapeId[] }
  | { t: 'comment.created' | 'comment.replied' | 'comment.resolved'; threadId: string; to?: ActorId[] }
  | { t: 'message.created'; messageId: string; thread: string; to?: ActorId[] }
  | { t: 'claim.granted' | 'claim.denied' | 'claim.released'; claimId: string; holder?: ActorId }
  | { t: 'lock.revoked'; ids: ShapeId[]; by: ActorId }
  | { t: 'conflict.opened' | 'conflict.ruled'; conflictId: string }
  | { t: 'actor.joined' | 'actor.left' | 'status.changed'; who: ActorId; state?: AgentState });
export interface Filter { actors?: ActorId[]; kinds?: BoardEvent['t'][]; addressedTo?: ActorId; shapeIds?: ShapeId[] }

// ---- presence (ephemeral; D4) ----
export type AgentState = 'idle' | 'thinking' | 'drawing' | 'waiting_user' | 'waiting_agent' | 'blocked' | 'paused' | 'stopped' | 'error';
export interface Presence {
  actor: ActorId; x?: number; y?: number; down?: boolean; tool?: string;   // world coords
  selection?: ShapeId[]; viewport?: Rect & { z: number }; focus?: Rect; typing?: string;
  state?: AgentState; detail?: string; lastInputAt: number;
}
export interface LockRecord { shapeId: ShapeId; holder: ActorId; since: number; ttlMs: number }
export type ClaimTarget = { kind: 'frame' | 'shape'; id: ShapeId } | ({ kind: 'rect' } & Rect);
export interface Claim { id: string; holder: ActorId; target: ClaimTarget; expiresAt: number; reason?: string }
export interface Conflict { id: string; kind: 'claim_contention'; actors: ActorId[]; target: ClaimTarget; state: 'open' | 'ruled'; ruling?: string }
export interface PresenceBus { publish(p: Partial<Presence> & { actor: ActorId }): void; get(a: ActorId): Presence | undefined; subscribe(cb: (all: ReadonlyMap<ActorId, Presence>) => void): () => void }

// ---- chat and comments ----
export type Anchor = { kind: 'shape'; shapeId: ShapeId; fx: number; fy: number } | { kind: 'point'; x: number; y: number } | { kind: 'orphan'; x: number; y: number; wasShapeId: ShapeId };
export type MsgBody =
  | { kind: 'text'; text: string } | { kind: 'status'; text: string; final?: boolean }
  | { kind: 'action'; summary: string; tx: string; layers: ShapeId[]; undone?: boolean }
  | { kind: 'routing'; to: ActorId; why: 'mention' | 'claim' | 'author' | 'frame-author' | 'nearest' | 'manual' }
  | { kind: 'conflict'; conflictId: string } | { kind: 'system' | 'error'; text: string };
export interface Message { id: string; thread: string; from: ActorId; at: number; body: MsgBody; shapeId?: ShapeId; threadId?: string }

// ---- agents (the seam; D4) ----
export type Intent = { t: 'move'; x: number; y: number } | { t: 'drag'; shapeId: ShapeId; to: Rect } | { t: 'type'; shapeId: ShapeId; text: string } | { t: 'think'; ms?: number } | { t: 'point'; shapeId: ShapeId };
export interface Task { id: string; agent: ActorId; kind: 'note' | 'build'; text: string; shapeId?: ShapeId; threadId?: string; priority: 0 | 1 | 2 | 3; from: ActorId; state: 'queued' | 'running' | 'done' | 'cancelled' | 'failed' }
export interface AgentContext { me: Actor; board: Board; intent(i: Intent): Promise<void>; setState(s: AgentState, detail?: string): void; say(text: string): void; signal: AbortSignal; paused(): boolean; rng(): number }
export interface AgentDriver { readonly kind: 'scripted' | 'llm'; start(ctx: AgentContext): void | Promise<void>; onTask(t: Task): Promise<void>; onEvent?(e: BoardEvent): void; stop(): void }

// ---- UI actions (D7) ----
export type FocusContext = 'canvas' | 'panel' | 'chat' | 'text-edit' | 'palette' | 'dialog';
export interface Action { id: string; title: string; group: 'Tools' | 'Edit' | 'View' | 'Arrange' | 'Share' | 'Agents' | 'Help'; keys?: { mac?: string[]; win?: string[]; all?: string[] }; contexts: FocusContext[]; when?: () => true | string; run(args?: unknown): void }

// ---- persistence (D10) ----
export type SavedBoard = { format: 'contract-board'; v: number; boardId: string; meta: BoardMeta; savedAt: number; lamport: number; seq: Record<ActorId, number>; shapes: Shape[]; logTail?: OpEnvelope[]; extras?: Record<string, unknown> };
```

`Snapshot`, `ActorRegistry` and the gesture context type are defined in WP-01 from these. Adding a field to any type after WP-01 is an orchestrator change (optional fields only).

## 8. Glossary

- **Actor**: anyone who changes the board: the human (`human-you`), an agent, the console (`api-*`), or the system (re-measure, migrations).
- **Action**: a UI registry entry (`core/actions.ts`) bound to keys, menus, palette and toolbar. Calls board commands.
- **Anchor**: where a comment pin sits: on a shape (fractions of its box), on a point, or orphaned after delete.
- **Board command / Command**: a protocol message (`shape.create`, `chat.say`, ...) passed to `board.exec`; compiled into ops.
- **Claim**: an agent's TTL reservation of a frame, shape or rect (Contract `claim`).
- **Choreographer**: turns agent intents into visible cursor motion and timed edits.
- **Conflict**: repeated claim contention, ruled by the coordinator (Contract `conflict`).
- **Gate**: the permission check inside `exec` (caps, locks, claims, humans win).
- **Gesture**: a continuous human or agent manipulation (drag, resize, type); one transaction, one undo entry.
- **Op / OpEnvelope**: the atomic replayable change to the document, with `opId = actor:seq`.
- **Presence**: ephemeral per-actor state (cursor, selection, locks, viewport, agent state); never saved.
- **Slot**: an empty component file created in Wave 0 and mounted by `ui/Playground.tsx` or `Board.tsx`, so a Wave 1 package can fill it without touching the composition root.
- **Soft lock**: a presence marker on a shape being dragged or edited; blocks other agents, never humans.
- **Stamp**: `(lamport, actor)` on each field; the higher stamp wins (LWW).
- **Tombstone**: `deleted: true` on a removed shape, kept so undo and pins can restore it.
- **Tx (transaction)**: the unit of undo: ops plus their inverse and the stamps they produced.

## 9. Open questions

### Decided above (no human input needed unless you disagree)

| Question (source) | Decision |
| --- | --- |
| Parent-relative or absolute child coordinates (HISTORY Q1, SELECT Q2, ALIGN Q2) | Relative (D1) |
| Real `parent` now or later (ALIGN Q1, LAYERS Q1) | Now, in Wave 0, with a one-time geometric migration for old saves |
| Fractional index package (HISTORY Q2, LAYERS Q7) | Hand-rolled (D2) |
| Spatial index / renderer deps (CANVAS Q1-2, SELECT Q5, ALIGN Q8) | Hand-rolled grid, DOM renderer (D5) |
| Undo force vs skip (HISTORY Q3) | Skip superseded fields (D3) |
| vitest / happy-dom / axe / fuse / zod (SELECT Q6, KEYS Q2, MULTI Q6) | vitest only (D9) |
| Board theme (KEYS Q1) | Light (D10) |
| localStorage vs IndexedDB (HISTORY Q6, MULTI Q9) | localStorage (D10) |
| Humans win locks and claims (MULTI Q3, SELECT Q9) | Yes (D8) |
| Empty-canvas drag (CANVAS Q4, SELECT Q4) | Marquee; pan on Space/middle/Hand/wheel |
| Mouse wheel default (CANVAS Q3) | Scroll pans, Cmd/Ctrl+wheel and pinch zoom |
| Zoom range (CANVAS Q5) | 2% to 25600% |
| Native vs drawn human cursor (CANVAS Q6) | Native for the human; drawn arrows for remote cursors |
| URL view encoding (CANVAS Q8) | Center + zoom + selection |
| Touch as demo target (CANVAS Q9) | No (P2) |
| Text Enter key (LAYERS Q4) | Enter = newline, Esc = commit |
| Legacy `fill`/`color` (LAYERS Q5) | Migrate to `fills[]` now |
| Agent text measurement (LAYERS Q3) | Host browser re-measures and writes back |
| Snap threshold, agents snap (ALIGN Q4, Q5) | 5 screen px for humans; agents snap at 2 world units |
| Guide colour (ALIGN Q3) | Red `#F24822` for own snaps; agent colour at 60% for agent snaps |
| Grid step (ALIGN Q7) | 1 (integer rounding) |
| Guides/settings storage (ALIGN Q9) | Settings in prefs; ruler guides P1 in the doc |
| Duplicate offset (SELECT Q3) | +16,+16 on first Cmd+D, then repeat the last delta |
| Rotation convention (SELECT Q8) | Store clockwise degrees; display Figma-style |
| Frame clip default (SELECT Q7) | Clip on; children do not scale |
| Human Cmd+Z on agent work (HISTORY Q4) | No; use action card Undo / Revert |
| History limits (HISTORY Q11) | 200 tx per actor, 500-op log tail |
| Collaborative text (HISTORY Q10) | Whole-string LWW |
| Validation for LLM output (MULTI Q6) | Hand-written validator in `core/commands.ts` |
| Demo determinism (MULTI Q10) | Seeded RNG in the choreographer |
| Pin numbering (MULTI Q8) | Global, stable, not renumbered on resolve |
| Copy-as-PNG binding (KEYS Q5) | Palette and Share menu only |
| Keybinding presets (KEYS Q10) | Figma only |
| File name / prefs in URL (KEYS Q11) | localStorage only; URL carries view only |

### Still open (needs the human; default applies if no answer)

1. **Where LLM agents run.** The browser cannot call `packages/llm`. Default: a local Node bridge (WebSocket on localhost) owned by the agents owner under `agents/` or `scripts/`, built after the MVP; the playground ships only `agents/llm.ts` (seam + bridge client). (MULTI Q1)
2. **SpacetimeDB backing and table names.** The spec freezes table names; `pg_board/pg_shape/pg_op` or `board_*` would be additions. Default: local-only for the hackathon; no tables published. (HISTORY Q8-9, MULTI Q2)
3. **What survives reload.** Default: document, chat, pins and prefs persist; agents restart idle with empty queues; `?demo=1` always starts from the seed. (HISTORY Q5, MULTI Q9)
4. **Second-window beat.** SHELL-25 shows a second window with both views, but boards are per-tab local. Default: drop that beat from the MVP demo; same-machine sync via `BroadcastChannel` is a P1 add-on if wanted. (KEYS Q4)
5. **Destructive-action approval.** Default: deleting a frame or more than 5 layers asks for approval (AGENT-10, P1); stage mode runs with autopilot on, so the demo never blocks. (MULTI Q4)
6. **Fonts.** Bundling woff2 files means editing `dashboard/public/`, outside the playground folder. Default: system font stack (Inter if installed, else system-ui); no bundled fonts. (LAYERS Q2)
7. **Panic reset key.** Default: Cmd/Ctrl+Shift+Backspace resets to the seed, only with `?demo=1`, with an undo toast. (KEYS Q7)
8. **Present mode in the pitch.** SHELL-25 beat 7 uses Present mode (SHARE-11, P1, Wave 3). Default: the stage run uses demo stage mode (AGENT-17) and Present is optional. (KEYS Q6)
9. **Claim TTL and coordinator.** Default: 120 s TTL auto-extended while active; coordinator is scripted rules now, `decide()` later; the human can overrule from the chat card. (MULTI Q5)
10. **`@all` mentions.** Default: allowed, with a confirm above 5 agents. (MULTI Q11)
11. **Same human in two tabs.** Default: second tab shows a banner and is view-only until made primary (no sync). (HISTORY Q12)
12. **Telemetry.** Default: in-browser only (ops per agent in the HUD); no forwarding to the dashboard. (KEYS Q9)
