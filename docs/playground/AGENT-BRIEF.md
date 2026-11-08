# Agent brief: building a playground work package

Read this first, then your package's section in `docs/playground/TASKS.md`, then the feature sections it lists in
`docs/playground/domains/*.md`, then `docs/playground/REQUIREMENTS.md` sections 3, 5, 6, 7.

## Where you work
- Only your git worktree `/Users/bryan/git/HackUTD2026/.worktrees/wp-NN` (branch `wp/NN`). Paths in TASKS briefs that
  start with `/Users/bryan/git/HackUTD2026/dashboard/src/playground/` mean `dashboard/src/playground/` in your worktree.
- Never touch the main checkout (another session works there on another branch) or any other worktree.
- Do not commit, push, merge or switch branches. The orchestrator reviews and commits.

## Rules
- Edit only the files your package owns (TASKS "Owns"). If you need a change elsewhere, stop and put the EXACT change
  (file, line, new code) in your report. Frozen, never edit: `core/types.ts`, `ui/Playground.tsx`, `actions/index.ts`,
  `core/gate.ts`, `core/snap.ts`.
- No new dependencies. TypeScript ESM. No React or DOM in `core/`, `presence/`, `agents/`, `chat/`, `comments/`.
- Every chrome colour comes from a `--pg-*` token in `styles/tokens.css` (`styles/tokens.test.ts` enforces it). Per-actor
  colours are data and may be inline.
- Do NOT use any browser tools: the shared browser pane belongs to the user and the orchestrator. Verify with unit
  tests, tsc and vite build; list what needs a browser check in your report.
- Checks: `cd dashboard && /Users/bryan/git/HackUTD2026/node_modules/.bin/tsc --noEmit -p . && /Users/bryan/git/HackUTD2026/node_modules/.bin/vitest run && /Users/bryan/git/HackUTD2026/node_modules/.bin/vite build`.
  Many builds share the CPU: if a timing-only assertion fails, re-run that file alone before reporting it.

## The codebase today (Waves 0 and most of 1 are merged)
- Board: `createBoard()` in `core/commands.ts` returns a `BoardKit` (`exec`, `gesture`, `undo/redo/revert`, `doc`,
  `presence`, `actors`, `locks`, `claims`, `selection`, `index`, `undoManager`, `events`, `gate`, `me`).
  Every document change goes through `board.exec(batch)` or `board.gesture(actor, label, {coalesceKey})`. A gesture's
  `update(cmds)` re-plans the FULL command list from the base each frame (pass absolute targets); `commit()` = one undo
  entry; `abort()` cancels. Command coordinates are parent space. Never write the store directly.
- Document: flat map with `parent` + parent-local coordinates + fractional `index` (`core/tree.ts`: `absRect`, `flatten`,
  `descendants`, `frameAt`; `core/order.ts`: `between`). React hooks in `core/react.ts` take the store as an argument.
- Humans win: `board.gesture` is wrapped by `presence/locks.ts attachLocks` (agent locks are revoked on the first human
  drag frame, `lock.revoked` carries the agent as `holder`, toast "You took over from X"); claims in
  `presence/claims.ts attachClaims` (agents get `claimed_by`; humans only a toast). Agents cannot overwrite text a
  human edited (`humanEdited`).
- Undo is per actor (`core/undo.ts`): Cmd/Ctrl+Z acts on `board.me` only; `board.revert(by, txId)` undoes any tx.
- Page: `ui/Playground.tsx` (frozen composition root) mounts every slot; slots get `SlotProps = {board, ui, rt, cursors}`
  (`ui/slotProps.ts`). UI state: `useUi(ui, key)` / `useSelection(board)` in `ui/hooks.ts`; store in `ui/board/state.ts`
  (`tool`, `editing`, `hover`, `pop`, `persistence`, ...). `activeBoard()` returns the mounted `BoardEnv`
  (`board`, `camera`, `ui`, ...). Kit: `ui/kit.ts` (`humanId()`, `HOST_AGENTS`, `DEMO`). Boot: `ui/useBoot.ts` (the one
  `startAgents` call; global wiring with cleanup; StrictMode runs `createKit` twice, so never register globals there).
- Gestures: `ui/gestures/pipeline.ts` (3 px drag threshold, `onClick`, escape ladder) dispatches to one file per mode.
- Camera `core/camera.ts`; frames `core/raf.ts` (`scheduler.register`); tweens `core/tween.ts`; `core/goto.ts goTo`.
- Spatial index `core/spatial.ts`; hit-test `core/hittest.ts`; snapping facade `core/snap.ts` (engines in `core/snap/`,
  guide store `snapResult`, overlay `ui/overlays/SmartGuides.tsx`).
- Actions: export `actions: Action[]` from your `actions/<area>.ts` (already imported by the frozen index); one key
  dispatcher `core/keys.ts` with focus contexts from `data-pg-ctx`; palette reads the same registry.
- Toasts `core/toast.ts` (`toast(text, {variant, ttlMs, key, onceMs, action})`); prefs `core/prefs.ts`.
- Inspector: `useSelectionProps(board)` -> `{ids, shapes, kinds, get(key), set(patch,label?), editor(key)}`,
  `useFieldFlash`; `ui/inspector/NumberField.tsx` (props `board, sp, prop, label, unit, min, max, step, scale, toPatch`);
  `ui/inspector/ColorPicker.tsx` (`value {color, opacity}`, `onPreview`, `onCommit`, `onCancel`) with
  `useColorGesture(board, v => Command[], label?, key?)`.
- Chat `chat/store.ts` (threads, text/status/action-card messages, `toJSON/load`), hook `ui/chat/useChat.ts`; comment
  threads `comments/threads.ts` (`commentThreads`); persistence `core/persist.ts` (`registerExtra`).
- Agents: `agents/runtime.ts startAgents(board, opts)` (queue, state machine, takeover reaction, speed), scripted driver
  `agents/scripted.ts`, choreographer `agents/choreographer.ts`, templates `agents/templates.ts`.

## Report (max 150 words unless your brief says otherwise)
Files changed; feature IDs done or partial; the vitest summary line; which acceptance items need a browser check; any
change another file needs, written as an exact edit.
