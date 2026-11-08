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
- todo: `ui/comments/route.ts` `routeFor` calls `route()` from `agents/router.ts` (agents from `rt.agentIds()` mapped to
  `board.actors.get(id)`; pass `board.claims`, `board.presence`, `board.doc.getState()`); return
  `{thread: d.to, how: d.why, label: d.label}`.
- todo: `ui/comments/CommentPopover.tsx` (~line 66) shows `route.label` instead of the three-way ternary.
- todo: `ui/chat/useChat.ts` `send`: replace the `Math.random` pick: `parseMentions` (error line per unknown/ambiguous
  name; "X is stopped, start?" for stopped agents; confirm `@all` when `needsAllConfirm`), `route()` with mentions, post
  `routingCard()` in General with `routedBy`, then `request()`; a General message with no layer or mention tries
  `splitGeneral` first (one request and card per part). Demo beat 3.
- todo: composer and popover textareas: `@` autocomplete with `mentionQuery`, `suggestMentions`, `applyMention`.
- todo: `ui/chat/MessageView.tsx` renders `m.text` for routing messages.
- note: `MsgBody` routing `why` lacks `role|split|general` (types frozen); `routingCard` maps them to `manual`.

## B. Action cards (WP-61)
- todo: `ui/useBoot.ts` `startAgents(..., { host, onSay, ...agentChatHooks(sink.chat) })` + import from
  `./chat/agentChat`.
- todo: `ui/chat/ChatView.tsx` replace `onUndo` with the `doc` + `undo(m)` handler that calls
  `board.revert(board.me, m.body.tx)`, marks the card undone and posts "You undid: ...".
- todo: `styles/chat.css` pulse for `.pg-msg.thinking`.
- todo: `agents/scripted.ts` (~line 87) card label uses `edit.summary.join(', ')`.

## C. Snapping (WP-52)
- todo: `core/snap/move.ts` wraps candidates with `withParent(...)` from `./parent` (parent-frame snapping for moves).
- todo: resize and create gestures call `resetResizeSnapMemory()` on pointer-up and abort.

## D. Culling (WP-32)
- todo: `ui/board/ShapeView.tsx` `useVisible(id, kids)` after `useChildren`; map `visible`.
- todo: `ui/board/Board.tsx` `RootShapes` uses `useVisible(null, ids)`.
- check: `await board.bench([500, 2000, 5000])`: p95 under 16.7 ms at 2k, under 25 ms at 5k; DOM under 600 shapes.

## E. Camera (WP-29)
- todo: pulse-ring overlay in `ui/board` subscribing to `onPulse` from `core/goto.ts`.
- todo: first load fits content (`tweenCam(env.camera, planFitAll(content, view))`); empty-board hint.
- todo: layer chips and presence jump use `goToShape(view, id)`.

## F. Comment threads (WP-43)
- todo: layer comments create threads in `commentThreads` instead of the old `Pin` list in `useChat`.
- todo: `useChat` forwards `commentThreads.onHumanMessage` to the chat thread; `markAnswered` when the agent finishes.
- todo: `ui/comments/CommentList.tsx` lists orphan pins.

## G. Agents and presence
- todo: `core/commands.ts` emits `status.changed` on `status.set` (WP-41; today only `rt.onStatus`).
- todo: `core/actors.ts` and `agents/runtime.ts` assign colours with `pickColor` from `presence/colors.ts` (WP-37).
- todo: after a restored board, tell the runtime which slots are occupied so resumed agents do not build over saved
  work (WP-36); then drop the "start paused" rule.
- todo: agents snap their placements through `agentSnapMove` (WP-24).

## H. Selection, undo, inspector, layers, export
- todo: Shift-click deselect and narrowing a multi-selection happen on pointer-up without movement (`pipeline.onClick`,
  WP-13/14).
- todo: set `Tx.sel` when transactions are created so undo restores selection exactly (WP-34; core).
- todo: `actions/align.ts` Alt+A/D/W/S/H/V align shortcuts (WP-24).
- todo: opacity keys 1-9 and 0 in an actions file (WP-56).
- todo: Share menu and inspector export entries call `exportSelection(board, 1|2|3)` (WP-64).
- todo: layers panel feeds LayerRow the data for ancestor owner rings and "+n" dots (WP-55).
- todo: toasts pause/resume and sticky (WP-45; `core/toast.ts`).

## I. Remaining Wave 1 seams
- todo (WP-28): `ui/layers/LayersPanel.tsx` renders rows through `VirtualList` (import `VirtualList`, `ROW_HEIGHT` from
  `LayerRow`): `<VirtualList className="pg-layers" items={rows} rowHeight={ROW_HEIGHT} getKey={(r) => r.id}
  empty={...} renderRow={(row) => <LayerRow .../>} />`; keep a ref for WP-54's `scrollToIndex`.
- WP-30: no seam.
- todo: WP-16, 33, 46, 50 (pending reports).

## Later (not wiring)
- WP-NET-0 networking prep (see `vault/Scopes/design-board.md`).
