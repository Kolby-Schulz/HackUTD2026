# Wiring ledger (playground)

Feature packages own only their files. When a package needs a hook somewhere else, it reports the exact edit; those
edits are applied here, on branch `playground/wiring` (worktree `.worktrees/wiring`), never on the features branch.

- `playground/features`: work-package merges only.
- `playground/wiring`: merges `playground/features`, then applies the seams below, one commit per group, each with a
  test where the behaviour is risky.
- `feat/dashboard-playground`: fast-forwarded to `playground/wiring` once tsc, vitest, vite build and the visual pass
  are green.

Status: `todo`, `done <commit>`, `dropped (reason)`. Applied before this ledger existed (on the integration branch):
lock layer and takeover, claims, snap source, chat store and chat.say events, persistence and extras, restored-board
rule, double-click enter, escape ladder, native cursors, avatar stack, guide token, text tool box, TextEditor mount,
humanEdited rule, palette.open, toast action, share link and URL view.

## A. Routing and mentions (WP-63) - large, delegate
- done (wire/chat): `ui/comments/route.ts` `routeFor` calls `route()` from `agents/router.ts` (agents from `rt.agentIds()` mapped to
  `board.actors.get(id)`; pass `board.claims`, `board.presence`, `board.doc.getState()`); return
  `{thread: d.to, how: d.why, label: d.label}`.
- done (wire/chat): `ui/comments/CommentPopover.tsx` (~line 66) shows `route.label` instead of the three-way ternary.
- done (wire/chat): `ui/chat/useChat.ts` `send`: replace the `Math.random` pick: `parseMentions` (error line per unknown/ambiguous
  name; "X is stopped, start?" for stopped agents; confirm `@all` when `needsAllConfirm`), `route()` with mentions, post
  `routingCard()` in General with `routedBy`, then `request()`; a General message with no layer or mention tries
  `splitGeneral` first (one request and card per part). Demo beat 3.
- done (wire/chat): composer and popover textareas: `@` autocomplete with `mentionQuery`, `suggestMentions`, `applyMention`.
- done (wire/chat): `ui/chat/MessageView.tsx` renders `m.text` for routing messages.
- note: `MsgBody` routing `why` lacks `role|split|general` (types frozen); `routingCard` maps them to `manual`.

## B. Action cards (WP-61)
- done (wire/core): `ui/useBoot.ts` `startAgents(..., { host, onSay, ...agentChatHooks(sink.chat) })` + import from
  `./chat/agentChat`.
- done (wire/chat): `ui/chat/ChatView.tsx` replace `onUndo` with the `doc` + `undo(m)` handler that calls
  `board.revert(board.me, m.body.tx)`, marks the card undone and posts "You undid: ...".
- done (wire/chat): `styles/chat.css` pulse for `.pg-msg.thinking`.
- done (wire/chat): `agents/scripted.ts` (~line 87) card label uses `edit.summary.join(', ')`.

## C. Snapping (WP-52)
- done (wire/board): `core/snap/move.ts` wraps candidates with `withParent(...)` from `./parent` (parent-frame snapping for moves).
- done (wire/board): resize and create gestures call `resetResizeSnapMemory()` on pointer-up and abort.

## D. Culling (WP-32)
- done (wire/board): `ui/board/ShapeView.tsx` `useVisible(id, kids)` after `useChildren`; map `visible`.
- done (wire/board): `ui/board/Board.tsx` `RootShapes` uses `useVisible(null, ids)`.
- check: `await board.bench([500, 2000, 5000])`: p95 under 16.7 ms at 2k, under 25 ms at 5k; DOM under 600 shapes.

## E. Camera (WP-29)
- done (wire/board): pulse-ring overlay in `ui/board` subscribing to `onPulse` from `core/goto.ts`.
- done (wire/board): first load fits content (`tweenCam(env.camera, planFitAll(content, view))`); empty-board hint.
- done (wire/board): layer chips and presence jump use `goToShape(view, id)`.

## F. Comment threads (WP-43)
- done (wire/chat): layer comments create threads in `commentThreads` instead of the old `Pin` list in `useChat`.
- done (wire/chat): `useChat` forwards `commentThreads.onHumanMessage` to the chat thread; `markAnswered` when the agent finishes.
- done (wire/chat): `ui/comments/CommentList.tsx` lists orphan pins.

## G. Agents and presence
- done (wire/core): `core/commands.ts` emits `status.changed` on `status.set` (WP-41; today only `rt.onStatus`).
- done (wire/core): `core/actors.ts` and `agents/runtime.ts` assign colours with `pickColor` from `presence/colors.ts` (WP-37).
- done (wire/core): `rt.occupy(state)`; start-paused rule removed: after a restored board, tell the runtime which slots are occupied so resumed agents do not build over saved
  work (WP-36); then drop the "start paused" rule.
- dropped (agents place templates on a fixed, already aligned slot grid; snapping adds nothing for the demo): agents snap their placements through `agentSnapMove` (WP-24).

## H. Selection, undo, inspector, layers, export
- done (wire/board): Shift-click deselect and narrowing a multi-selection happen on pointer-up without movement (`pipeline.onClick`,
  WP-13/14).
- done (wire/core): exec/gesture set it, undo/redo reselect: set `Tx.sel` when transactions are created so undo restores selection exactly (WP-34; core).
- done (wire/core): `actions/align.ts` Alt+A/D/W/S/H/V align shortcuts (WP-24).
- done (wire/core): in `actions/layers.ts`: opacity keys 1-9 and 0 in an actions file (WP-56).
- done (wire/core): Share menu and inspector export entries call `exportSelection(board, 1|2|3)` (WP-64).
- done (wire/board): layers panel feeds LayerRow the data for ancestor owner rings and "+n" dots (WP-55).
- done (wire/core): store API + Toasts hover (orchestrator): toasts pause/resume and sticky (WP-45; `core/toast.ts`).

## I. Remaining Wave 1 seams
- done (wire/board) (WP-28): `ui/layers/LayersPanel.tsx` renders rows through `VirtualList` (import `VirtualList`, `ROW_HEIGHT` from
  `LayerRow`): `<VirtualList className="pg-layers" items={rows} rowHeight={ROW_HEIGHT} getKey={(r) => r.id}
  empty={...} renderRow={(row) => <LayerRow .../>} />`; keep a ref for WP-54's `scrollToIndex`.
- WP-30: no seam.
- WP-16, WP-50: no seam (WP-50 write-back of measured text sizes is WP-60's job, Wave 2).
- done (wire/board) (WP-46): `ui/gestures/pipeline.ts` `down()` ignores `button === 2` so a right-click opens the context menu without
  starting a select/move gesture.
- done (wire/core) (WP-33): `actions/view.ts` adds `{ id: 'view.toggleDebug', title: 'Toggle debug HUD', group: 'View', contexts: ctx,
  run: () => toggleDebug() }` (import `toggleDebug` from `../core/perf`); `core/devtools.ts` adds
  `debug: (on = true) => setDebug(on)`.

## Assignment for the wiring agents (file-disjoint)
- W-chat: sections A, B (except the `useBoot` line), F. Files: `ui/chat/*`, `ui/comments/*`, `agents/scripted.ts`,
  `styles/chat.css`, `styles/comments.css`.
- W-board: sections C, D, E, the WP-28 and WP-46 entries, H "Shift-click on pointer-up", H "layers ancestor rings".
  Files: `core/snap/move.ts`, `ui/gestures/*`, `ui/board/*`, `ui/layers/*`, `ui/overlays/*` (new pulse overlay allowed).
- W-core: section G, B's `useBoot` line, H `Tx.sel`, align shortcuts, opacity keys, export entries, toasts, WP-33.
  Files: `core/commands.ts`, `core/actors.ts`, `agents/runtime.ts`, `ui/useBoot.ts`, `core/toast.ts`, `core/devtools.ts`,
  `actions/align.ts`, `actions/view.ts`, `actions/layers.ts`, `actions/share.ts`, `ui/shell/TopBar.tsx`,
  `ui/inspector/*` (export section only).

## Visual pass (browser, 2026-11-08)
- done (fix/visual-pass): activity-based locks + one focus outline per agent (owner-reported clutter); humans win
  even after an activity lock lapses; Restart / Restart all for stopped agents; toasts above the toolbar; copy-link
  fallback (execCommand, then a dialog); playground class names scoped (.diff/.card/.chip/.body leaked dark styles).
- known, not fixed: "Restart all" only shows when every agent is stopped; 60 fps not proven in the app's throttled
  pane (per-frame work under 1 ms; culling mounts ~370 of 5,000).

## Waves 2-3 seams
- todo (WP-53): `ui/Cursors.tsx` painter calls `layoutTags(...)` and `cursorScale(zoom)` from `presence/cursors.ts` and
  toggles the `.pg-tag` full/short/dot classes and the "+n" chip (tag declutter when zoomed out / crowded).
- todo (WP-60): `ui/gestures/resize.ts` text resize commit adds `textMode: modeAfterResize(shape.textMode, handle)`;
  handle double-click sets `modeAfterHandleDoubleClick()` then `writeMeasuredSize`.
- todo (WP-60): agent host calls `writeMeasuredSize(board, id, {role:'host'}, true)` after agent text create/update
  (host peer only).
- todo (WP-60/57): inspector font/size/mode changes call `writeMeasuredSize(..., {role:'editor', actor})` so auto-width
  text re-measures after a typography change.
- todo (WP-60): fold `commitText` and the fitted-size write into one undo entry (`ui/gestures/text.ts`).
- todo (WP-54): `LayerRow.tsx` flash class on reveal; `onHover` prop for a canvas hover outline from the layers panel
  (keep the comment tool's use of `ui.hover`).
- todo (WP-62/44): one document title: `(N) <file name> · Playground` (WP-44 sets the file-name title, WP-62 the unread
  count; today whichever runs last wins).
- WP-57, WP-59: no seam.
- todo (WP-68): `ui/useBoot.ts` starts the coordinator next to `startAgents` (and stops it in cleanup):
  `startCoordinator({ board, chat: sink.chat, pickSlot, freeSlot, onRedirect })` wired to the runtime's slot API
  (check the real `occupy`/slot signatures in `agents/runtime.ts`).
- todo (WP-71): `ui/shell/TopBar.tsx` `AvatarStack onPick={toggleFollow}` (follow an agent from its avatar).
- todo (WP-73): `core/snap/move.ts` runs `snapSpacing(final, cands, t, round, axes)` from `./spacing` on axes without an
  edge snap and builds lines from the spaced box (equal-gap snap + pink gap labels). Note: no hysteresis yet.
- todo (WP-70): register `view.minimap` (Shift+KeyM) in `actions/view.ts` and remove the minimap's private window
  keydown handler (one key dispatcher, D7).
- todo (WP-74): `ui/gestures/pipeline.ts` `down()`: `if (p.handle?.startsWith('rot-')) { const m = startRotate(env, p);
  if (m) { begin(m, p); return; } }` before `startResize` (+ import). Check `rotate.ts` setting `document.body.style.cursor`
  does not fight the board's cursor handling.
- todo (WP-77): `core/commands.ts` `BoardKit.reapply(by, txId)` (gate check, `undoManager.reapply`, `afterUndo`), and
  `actions/edit.ts` skips "Nothing to undo" when `undoManager.last()?.outcome.skipped.length` (fields were superseded).
- WP-65, WP-69, WP-75: no seam.

## Owner requests
- done: cursor tags show only the action, with the state dots after it; hovering an agent's arrow shows the name and
  pins the pill at your pointer while the agent keeps moving, then eases it back on leave (`ui/Cursors.tsx`,
  `styles/cursors.css`). WP-53's `layoutTags` seam must keep the `.hot`/`.pinned` classes and the tag transform.

## Later (not wiring)
- WP-NET-0 networking prep (see `vault/Scopes/design-board.md`).
