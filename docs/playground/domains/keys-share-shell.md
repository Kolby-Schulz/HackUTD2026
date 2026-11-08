# Keyboard, command palette, share/export, UI shell and polish

Scope: the keyboard layer (one shortcut registry, key dispatch, focus rules, help overlay, command palette, "/" quick actions: `KEYS-*`), getting work out of the board (links, view-only, PNG/SVG/JSON export, import, present, print: `SHARE-*`), and the application shell (top bar, panels, theme, toasts, menus, tooltips, onboarding, settings, a11y, error boundaries, perf budget, telemetry, tests, flags, demo script: `SHELL-*`). Canvas mechanics (pan, zoom math, snapping, drawing) belong to CANVAS, selection and transform handles to SELECT, undo/redo and the board file format to HISTORY, chat and agent orchestration to MULTI. This domain only binds keys to their commands and wraps them in UI.

## Today
- Keyboard: one `window` keydown handler, `dashboard/src/playground/Playground.tsx:170-192`. It ignores input/textarea/select targets (`:172`), makes Space a pan modifier (`:173`), deletes the selected shape (`:174`), Esc resets tool and selection (`:181`), Shift+1 fits (`:182`), Cmd/Ctrl+0 resets to 100% (`:183`), and any other Cmd/Ctrl/Alt combo returns early (`:184`). Single-key tool switching reads `TOOLS[].key` (`:25-33`, lookup `:185`). Missing: copy/paste/duplicate, select all, nudge, group, zoom in/out, undo, panel toggles, any help or palette. Space is only prevented while not focused in an input, but `contenteditable` text editing is not excluded (the text layer editor at `:615` uses its own onKeyDown).
- Wheel: `e.preventDefault()` on a non-passive listener (`:152-166`); pinch/Cmd-wheel zoom clamped 0.08 to 4 (`:158`). Browser page zoom via Cmd+/-/= is not intercepted.
- Share: the Share button copies `location.href` and shows a 1.6s toast (`:263-267`, button `:418`). The URL carries no viewport or selection, so the link is just `#/playground`.
- Top bar: `<header className="pg-top">` (`:396`) holds back arrow, logo, static title "Playground", subtitle, comment-options menu (`:410-415`), Share (`:418`), zoom button that fits (`:422`), avatar stack capped at 8 (`:403`). File name is not editable; zoom button is not a menu.
- Panels: fixed 240px left and 260px right, no collapse, no resize (`playground.css:35-37`). Left holds layers, chat and agents; right holds cursors/speed (`Playground.tsx:426-575`).
- Toolbar tooltips are `title` attributes built from `TOOLS` (`:546`); the only a11y labels are on the chat Send button (`:523`) and decorative SVGs (`aria-hidden`, `:535`).
- Theme: playground is a light island (`playground.css:3-15`, `color-scheme: light` at `:15`) inside a Primer-dark dashboard (`dashboard/src/styles.css:2-24`, `color-scheme: dark` at `:24`). Colors in the board CSS are partly tokens (`--pg-*`) and partly hard-coded hex (`#f1efe9`, `#fff`, `#ebe8e1` at `:23,30,51,66`). No `prefers-color-scheme` or `prefers-reduced-motion` handling.
- Routing: `main.tsx:10` matches `/^#\/?playground/`; any query string after it is currently ignored, which is safe for `?x=&y=&z=&sel=`. Playground bypasses SpacetimeDB (`main.tsx:9,19`).
- Toast is a single `useState` string with `setTimeout` (`:263-267`); no stacking, no variants. No error boundary anywhere; a throw inside an engine tick or ShapeView white-screens the page. `window.board` exposes `addShape/updateShape/press/removeCursor/shapes/cursors` for scripted agents (`:140-146`), which is the only test hook. No unit tests exist for `engine.ts` (468 lines), no feature flags, no telemetry, no perf measurement.

## Features

### KEYS-1: Shortcut registry (single source of truth)
- Priority: P0
- Size: M
- Interaction: new `shortcuts.ts` exports a typed array of `Command` objects (id, title, group, keys per platform, context, when(), run()). The dispatcher (KEYS-2), tooltips (SHELL-11), help overlay (KEYS-8), command palette (KEYS-9), context menus (SHELL-10) and the top-bar menus all render from it. Nothing else may hard-code a key string; `TOOLS[].key` is derived from the registry.
- Acceptance: grep for hard-coded shortcut text outside `shortcuts.ts` finds none; a vitest asserts no two commands with overlapping `context` share a binding on either platform; changing a binding in one place updates tooltip, overlay and palette.
- Edge cases: commands with two bindings (Delete and Backspace); chords (G then V); commands with no key (palette-only); platform detection falls back to Windows labels on unknown UA.
- Depends on: none. Everyone else depends on it.
- Multi-agent note: agents invoke the same `Command.run` by id through the op bus (SHELL-21), so a command is both human-bindable and agent-callable.

### KEYS-2: Global key dispatcher and focus-context guard
- Priority: P0
- Size: M
- Interaction: replace the keydown effect (`Playground.tsx:170-192`) with one capture-phase dispatcher that computes a focus context from `document.activeElement`: `canvas`, `panel`, `chat`, `text-edit`, `palette`, `dialog`. A command fires only if its `context` list includes the current one. In `chat`, `text-edit` and `palette` only Esc and Cmd+K/Cmd+S-style "global" commands fire. Use `e.target.closest('input, textarea, select, [contenteditable=true], [role=textbox]')`, not tag names alone. Canvas gets `tabIndex=0` and takes focus on pointerdown so keys work after clicking the board.
- Acceptance: typing "r" in the chat box or while editing a text layer never switches tools; clicking the board after typing in chat re-enables tool keys; Esc inside the chat box blurs it and a second Esc clears selection.
- Edge cases: IME composition (`e.isComposing`, KEYS-18); focus inside an iframe or the Comment popover (`.pg-pop`); key held across a focus change (keyup must still clear sticky state); Playground unmounted (listeners removed).
- Depends on: KEYS-1.
- Multi-agent note: agent cursors never produce keyboard events; they call commands, so focus context does not gate them.

### KEYS-3: Tool shortcuts (full map)
- Priority: P0
- Size: S
- Interaction: single letters, no modifiers: V move, H hand, F frame (A is an alias in Figma, optional), R rectangle, O ellipse, L line, P pen/path, T text, C comment, I eyedropper, K scale (later). Tap = persistent tool switch; after drawing one shape the tool reverts to Move unless Tool Lock (Q) is on. Toolbar highlights the active tool and shows the letter as a hint.
- Acceptance: every tool in `TOOLS` has a key in the table below; pressing it updates the toolbar highlight within one frame; Shift+letter does not switch tools.
- Edge cases: tools that do not exist yet are registered with `flag` (SHELL-24) and hidden; non-QWERTY layouts use `e.key` for letters (KEYS-18).
- Depends on: KEYS-1, CANVAS tool set.

### KEYS-4: Edit shortcuts
- Priority: P0
- Size: M
- Interaction: Cmd/Ctrl+A select all, Cmd+C/X/V copy/cut/paste (paste in place at the cursor world position, Cmd+Shift+V paste to original position), Cmd+D duplicate (offset 10px, repeated duplicates continue the offset), Delete/Backspace remove, Cmd+G group, Cmd+Shift+G ungroup, Cmd+Alt+G frame selection, Cmd+Z / Cmd+Shift+Z (and Ctrl+Y on Windows) undo/redo, Esc deselect. The keys only dispatch; behavior is SELECT/HISTORY.
- Acceptance: each binding calls the matching command exactly once per press; Cmd+D never opens the browser bookmark dialog (KEYS-6); keys no-op with a toast hint ("Nothing selected") rather than failing silently when selection is empty.
- Edge cases: selection includes a shape an agent is mid-editing (command still runs; HISTORY decides conflicts); paste with an empty clipboard; paste of foreign clipboard text creates a text layer (P2).
- Depends on: KEYS-1, KEYS-2, SELECT, HISTORY.
- Multi-agent note: human edits to agent-owned layers show an "edited by you" toast chip; ownership policy is MULTI's.

### KEYS-5: View shortcuts
- Priority: P0
- Size: S
- Interaction: Shift+1 fit all, Shift+2 zoom to selection, Shift+0 or Cmd+0 100%, Cmd+= / Cmd+- zoom in/out by a step (steps 8, 12, 25, 50, 100, 200, 400%), Cmd+scroll continuous (exists), Z-key hold = zoom tool (P2), Cmd+\ toggle all panels (KEYS-17 detail in SHELL-4), Cmd+Shift+H toggle cursor names, Cmd+' toggle pixel grid (P2), Cmd+Shift+P present (SHARE-11), F11/Cmd+Ctrl+F fullscreen is left to the browser.
- Acceptance: zoom in and out land on the step list and clamp to 8-400%; zoom commands center on the viewport center when the pointer is outside the board, else on the pointer; Shift+2 with no selection toasts "Select something first".
- Edge cases: zoom mid-pan (Space held); zoom while a modal is open (blocked by context).
- Depends on: KEYS-1, CANVAS camera API.

### KEYS-6: Browser shortcut conflict prevention
- Priority: P0
- Size: S
- Interaction: the dispatcher calls `preventDefault()` for any combo the registry owns, in the capture phase, only while focus context is `canvas` or `panel`. Known conflicts handled: Cmd/Ctrl+D (bookmark), Cmd/Ctrl+S (save page), Cmd/Ctrl+P (print; rebound to our print, SHARE-13), Cmd/Ctrl+G (find next), Cmd/Ctrl+K (some browsers focus the address bar), Cmd/Ctrl+= / - / 0 (page zoom), Space (scrolls page; `overflow:hidden` on `.pg` plus preventDefault), Backspace (old back navigation), Cmd+[ and Cmd+] (back/forward on macOS), Cmd+Left/Right (history), Alt+Left. Not preventable and therefore not used: Cmd/Ctrl+W, Cmd/Ctrl+T, Cmd/Ctrl+N, Cmd/Ctrl+Q, Cmd+Shift+N, Ctrl+Tab, F5/Cmd+R.
- Acceptance: with the board focused, Cmd+D duplicates and no bookmark UI appears (verify in Chrome and Safari); Space pans without scrolling the host page; Cmd+- changes board zoom and leaves browser zoom at 100%.
- Edge cases: Firefox reserves some combos; Safari swallows Cmd+Option+*; a browser extension binds the same key (we cannot detect it, document the workaround: use the palette). Cmd+Shift+4 etc. are OS-level.
- Depends on: KEYS-1, KEYS-2.

### KEYS-7: Momentary and sticky modifiers
- Priority: P1
- Size: M
- Interaction: momentary (active only while held): Space = hand (restores previous tool on release, including when released outside the window via `blur`/`visibilitychange` reset), Shift = constrain ratio / add to selection, Alt/Option = duplicate-drag or draw from center, Cmd/Ctrl = bypass snap (not canvas default, configurable) or pick deepest on click. Sticky: Caps-style Tool Lock (Q) keeps the tool after drawing; H pressed twice does nothing. A modifier "state bar" in the bottom-left shows held modifiers while dragging.
- Acceptance: holding Space then clicking a text field does not leave the board stuck in pan mode; alt-tabbing away while holding Space clears it; modifier state bar disappears on release.
- Edge cases: Meta key keyup is not fired for other keys on macOS (clear all letter-chords on Meta release); stuck keys after window blur; two-key chords.
- Depends on: KEYS-2, CANVAS pan, SELECT modifiers.

### KEYS-8: Shortcut cheat sheet overlay
- Priority: P1
- Size: M
- Interaction: `?` (Shift+/) or Help menu opens a modal grouped by Tools, Edit, View, Arrange, Text, Present. Reads KEYS-1 only. Shows the platform's glyphs (⌘⇧⌥⌃ on macOS, Ctrl+Shift+Alt on Windows). Searchable with a filter input. Esc or `?` again closes it.
- Acceptance: every registry command with a key appears exactly once; adding a command to the registry updates the sheet with no other edit; focus is trapped and returned to the board on close.
- Edge cases: narrow screens (single column); long localized labels; screen reader reads it as a table.
- Depends on: KEYS-1, SHELL-6.

### KEYS-9: Command palette
- Priority: P0
- Size: M
- Interaction: Cmd+K or Cmd+/ (Ctrl on Windows) opens a centered 560px palette with a search box; Up/Down move, Enter runs, Esc closes, Tab does nothing. Results are grouped (Actions, Tools, View, Layers on the board, Agents, Settings). Shows each command's shortcut right-aligned. Commands that need a missing precondition are shown disabled with a reason.
- Acceptance: Cmd+K opens within 100ms from any non-text focus (and also from chat, since it is a global command); typing "fit" runs "Zoom to fit" on Enter; the board remains interactive-looking but inert behind a scrim.
- Edge cases: opened while a drag is active (cancel drag first); palette open + agent ops continue; 3k layers in the Layers group is virtualized and capped to 50 results.
- Depends on: KEYS-1, KEYS-2.

### KEYS-10: Fuzzy search
- Priority: P1
- Size: S
- Interaction: subsequence match with scoring (start of word and consecutive bonuses), matches on title, aliases ("rect" finds Rectangle) and group; highlight matched characters. Hand-rolled (about 40 lines), no new dependency; if `fuse.js` is wanted it is an open question.
- Acceptance: "zf" ranks "Zoom to fit" first; "dup" finds Duplicate; empty query shows recents then all; vitest covers 10 queries.
- Edge cases: unicode and case folding; very long layer names; ties broken by recents then alphabetical.
- Depends on: KEYS-9.

### KEYS-11: Recents and frecency
- Priority: P2
- Size: S
- Interaction: the last 5 run commands appear first when the query is empty; ranking multiplies by a frecency score stored in localStorage (`pg.recents`).
- Acceptance: running "Export PNG" puts it first the next time the palette opens; clearing site data resets it.
- Edge cases: localStorage unavailable (private mode) falls back to in-memory.
- Depends on: KEYS-9, SHELL-29.

### KEYS-12: Selection-aware palette actions
- Priority: P1
- Size: M
- Interaction: when selection is non-empty the palette surfaces a "Selection (3)" group: Duplicate, Group, Rename, Export as PNG/SVG, Copy as PNG, Bring to front, Delete, "Ask owner agent about this layer" (opens Comment tool on it), "Send to agent…" (sub-palette lists live agents). Each registry command declares `needs: 'selection' | 'single' | 'frame' | 'none'`.
- Acceptance: with nothing selected selection actions are hidden (not just disabled) from the empty-query view but still reachable by typing, with a disabled reason; "Export as PNG" runs SHARE-4 on the selection.
- Edge cases: selection containing locked or agent-busy layers; selection of 3k shapes (count only, no list).
- Depends on: KEYS-9, SELECT, SHARE-4, MULTI comment routing.
- Multi-agent note: "Send to agent" reuses `routeFor` semantics (`Playground.tsx:~195`): author, else nearest live agent.

### KEYS-13: "/" quick actions menu
- Priority: P1
- Size: M
- Interaction: pressing `/` on the board (no text focus) opens a small anchored menu at the cursor or selection, like Figma's quick actions: shows the top 8 context-relevant commands (for empty canvas: tools and Insert; for a selection: Duplicate, Group, Export, Ask agent). Same engine and fuzzy search as KEYS-9 but anchored and compact; Cmd+/ remains the full palette.
- Acceptance: `/` then "rect" then Enter switches to Rectangle; menu closes on Esc or outside click; it never opens while typing in chat (a literal "/" is typed there).
- Edge cases: `/` on keyboards where it needs Shift (use `e.key`); near the viewport edge the menu flips.
- Depends on: KEYS-9, SHELL-10.

### KEYS-14: Arrange and layer shortcuts
- Priority: P1
- Size: S
- Interaction: Cmd+] / Cmd+[ forward/back, Cmd+Shift+] / [ to front/back, Cmd+Alt+K create component (P2), Cmd+Shift+L lock, Cmd+Shift+H hide, Cmd+R rename (preventDefault to stop reload; also F2), Cmd+Alt+C / V copy/paste properties (P2). Arrow keys nudge 1px, Shift+Arrow 10px; Enter on a frame selects its children, Shift+Enter selects parent.
- Acceptance: no key reloads or navigates the page; nudge works at any zoom in world units; bindings appear in the table.
- Edge cases: Cmd+[ is browser Back on macOS Safari/Chrome (prevented while board is focused, KEYS-6); nudging multiple shapes owned by different agents.
- Depends on: KEYS-1, SELECT.

### KEYS-15: Agent and chat commands
- Priority: P1
- Size: S
- Interaction: Cmd+Shift+C hmm conflicts with devtools, so use `Alt+A` focus agent chat input, `Alt+1..9` focus agent N, `.` or Cmd+. is reserved for the right panel toggle (SHELL-4), Cmd+Enter in chat sends to all agents, Esc returns focus to the board. Palette entries: "Pause all agents", "Resume all agents", "Set speed 1x/2x/4x", "Spawn demo agent".
- Acceptance: Alt+A puts the caret in the chat input; Esc returns focus to canvas without losing the draft; speed commands update the right-panel speed buttons (`Playground.tsx:565`).
- Edge cases: macOS Option+letter types special characters when focus is in a text field (so bindings only fire outside text contexts); no agents present.
- Depends on: KEYS-1, MULTI chat/agents.
- Multi-agent note: pause/resume affect every scripted cursor simultaneously.

### KEYS-16: Keybinding overrides
- Priority: P2
- Size: M
- Interaction: Settings lists commands with a "press new shortcut" capture field, conflict warning, reset to default; stored as `{commandId: binding}` in prefs. Optional preset: "Figma" (default), "Penpot", "Sketch".
- Acceptance: rebinding R to X makes X switch to Rectangle everywhere (tooltip, overlay, palette); conflicts are blocked with the conflicting command named.
- Edge cases: rebinding to a browser-reserved combo (blocked with explanation); import/export prefs.
- Depends on: KEYS-1, SHELL-14.

### KEYS-17: Chorded shortcuts (G then ...)
- Priority: P2
- Size: S
- Interaction: two-key sequences with a 800ms window, shown in a small "g …" hint pill (e.g. G L jump to layers panel, G A jump to agents, G C go to chat). Registry's `keys` accepts `['g','l']`.
- Acceptance: the pill appears after the first key and disappears on timeout or Esc; typing in a text field never starts a chord.
- Edge cases: chord prefix collides with a single-key tool (no single-letter tool may be a chord prefix).
- Depends on: KEYS-1, KEYS-2.

### KEYS-18: Non-US layouts, IME and key repeat
- Priority: P1
- Size: S
- Interaction: letter commands match `e.key` (layout-aware), while position-based commands (Space, Digit1 for Shift+1 fit, arrows, bracket keys) match `e.code`. Skip dispatch when `e.isComposing` or `e.keyCode === 229`. `e.repeat` is ignored for toggles and one-shot commands, but allowed for nudge and zoom steps.
- Acceptance: on an AZERTY/Dvorak layout tool letters match the printed key; Shift+1 fit works on a layout where Shift+1 produces "&" or "!"; holding Cmd+D does not duplicate 30 times.
- Edge cases: Caps Lock on (`e.key` uppercase, normalize); dead keys; Cyrillic layouts fall back to `e.code` letters.
- Depends on: KEYS-1.

### SHARE-1: Copy link with viewport and selection
- Priority: P0
- Size: M
- Interaction: Share button (and Cmd+Shift+L is not used; palette "Copy link") writes `#/playground?x=<camX>&y=<camY>&z=<zoom>&sel=<id,id>` to the clipboard, where x,y are the world coordinates at the viewport center (rounded to int), z rounded to 2 decimals, sel capped at 20 ids. Optional `&frame=<id>` is accepted instead of x/y/z (fit that frame). A "Copy link to this view" and "Copy link to selection" pair is in the Share menu. Toast "Link copied".
- Acceptance: pasting the link in a fresh tab restores the same view center and zoom within 1px and re-selects the ids that exist; the link is under 300 chars with 5 ids.
- Edge cases: selection ids that no longer exist (ignore silently, toast "1 layer not found"); non-integer zoom; clipboard API denied (select-all text in a fallback input); links to a board with different contents (the board state is local today, so a link only carries view and ids; see open question on persistence).
- Depends on: SHARE-2, CANVAS camera, SELECT.

### SHARE-2: Parse view state from URL
- Priority: P0
- Size: S
- Interaction: on mount and on `hashchange`, parse the query part of `location.hash` (after `?`) with `URLSearchParams`, clamp z to 0.08-4, apply the camera once, never fight the user afterwards (no continuous URL writes while panning; only an explicit "Update URL" via replaceState, debounced 500ms, behind the pref `urlSync`, default off). `main.tsx:10` regex already tolerates the query.
- Acceptance: invalid values (`z=abc`) are ignored; opening a link with `sel=` scrolls the selection into view (reuse the focus-layer code near `Playground.tsx:258-261`); back/forward navigation restores views.
- Edge cases: `x`/`y` huge (clamp to ±1e6); hash with duplicate keys; link opened before shapes load (apply after first engine tick).
- Depends on: CANVAS camera.

### SHARE-3: View-only mode
- Priority: P1
- Size: M
- Interaction: `&mode=view` (or Share menu "Anyone with the link can: View") sets a read-only flag: tools, editing keys, chat input, drag and delete are disabled; toolbar hidden; pan, zoom, Present, export, comment pin viewing, and layer selection (inspect only) remain. A "View only" badge sits in the top bar with an "Edit a copy" button (P2).
- Acceptance: in view mode pressing R/Delete/Cmd+V does nothing and shows "View only" toast at most once per 5s; the palette shows only view commands; agents still animate (it is a spectator).
- Edge cases: user removes `mode=view` from the URL (it is a UI mode not security; state this); view mode + chat typing stays disabled.
- Depends on: KEYS-1 (`needs`/`when` predicates), SHELL-24.
- Multi-agent note: a spectator gets no cursor of their own in the avatar stack.

### SHARE-4: Export selection or frame as PNG
- Priority: P0
- Size: L
- Interaction: Export from the right panel, the palette, context menu, or Cmd+Shift+E. Renders the selection's bounds (or the selected frame) to a canvas: shapes are drawn with a pure function `renderToCanvas(shapes, bounds, scale)` in `export.ts` (not by screenshotting the DOM), then `canvas.toBlob('image/png')` and a download named `<file>-<layer>.png`. Transparent background by default, optional board background fill. Text uses the same font stack; wait for `document.fonts.ready`.
- Acceptance: exporting a 400x300 frame at 2x yields an 800x600 PNG that matches the on-screen render of fills, strokes, radius and text; exporting with nothing selected exports the whole board bounds after a confirm toast; download starts within 1s for 500 shapes.
- Edge cases: canvas limit (browsers fail above about 16k px or 268MP: clamp scale and warn); zero-size shapes; rotated shapes; nested frames with clipping; selection spanning agent-moving shapes (snapshot the engine state at click time); empty selection on empty board.
- Depends on: SELECT bounds, CANVAS shape model, SHARE-5.

### SHARE-5: Scale and format options (1x/2x/3x, devicePixelRatio aware)
- Priority: P1
- Size: S
- Interaction: export popover with scale chips 0.5x, 1x, 2x, 3x, 4x and a default "Auto" = `window.devicePixelRatio` clamped 1-3; format PNG | SVG | JPG (P2), plus optional suffix (`@2x`). Multiple export rows per selection like Figma (P2). Shows computed pixel size ("800 × 600 px").
- Acceptance: on a DPR 2 display "Auto" shows 2x; changing scale updates the pixel readout live; the same settings are remembered per session.
- Edge cases: fractional DPR (1.25, 1.5) rounds output size to integers; browser zoom changes DPR mid-session.
- Depends on: SHARE-4.

### SHARE-6: Export as SVG
- Priority: P1
- Size: M
- Interaction: `toSvg(shapes, bounds)` returns a string: `<svg viewBox>` with `<rect rx>`, `<ellipse>`, `<text>` (fonts referenced by family, optional "outline text" is P2), nested frames as `<g clip-path>`. Download as .svg; also used by SHARE-8.
- Acceptance: the SVG opens in a browser and in Figma/Illustrator showing the same geometry; no external references; file passes `xmllint` well-formedness (vitest uses DOMParser).
- Edge cases: XML-escaping text and names; opacity and blend modes; gradients/shadows once added; id collisions in clip paths (prefix with layer id).
- Depends on: SHARE-4 (shared bounds helper), CANVAS shape model.

### SHARE-7: Copy as PNG to clipboard
- Priority: P1
- Size: S
- Interaction: Cmd+Shift+C (palette "Copy as PNG") puts a `ClipboardItem({'image/png': blob})` on the clipboard using the Auto scale; toast "Copied as PNG (2x)". Needs a user gesture and a secure context (localhost is fine).
- Acceptance: pasting into Slack/Docs gives the image; failure shows an error toast with "Download instead".
- Edge cases: Safari requires the blob promise passed inside `ClipboardItem` synchronously within the gesture; Firefox support gaps (fallback to download); Cmd+Shift+C is Chrome DevTools' inspect-element combo, so the binding is a P1 conflict to verify (open question).
- Depends on: SHARE-4, KEYS-6.

### SHARE-8: Copy as SVG / copy as text
- Priority: P2
- Size: S
- Interaction: palette "Copy as SVG" writes the SVG string as `text/plain` (and `image/svg+xml` when supported); "Copy layer names" and "Copy as JSON" (selected shapes) for pasting into chat prompts.
- Acceptance: pasted text starts with `<svg`; JSON copy round-trips through SHARE-10 import.
- Edge cases: huge selections (cap 2MB, toast).
- Depends on: SHARE-6.

### SHARE-9: Export whole board as JSON
- Priority: P1
- Size: M
- Interaction: File menu "Export board…" and palette: downloads `<file>.board.json` containing `{version, name, exportedAt, shapes, pins, cursors? (agents meta only)}` produced by HISTORY's serializer. This domain only owns the button, filename, toast and the download helper (`downloadBlob`). Format and versioning are HISTORY's (handoff below).
- Acceptance: file validates against HISTORY's schema; exporting then importing yields identical shapes (deep equal by id); the filename uses the editable file name (SHELL-2).
- Edge cases: 3k shapes (<1MB, no main-thread freeze over 100ms; stringify in a microtask if needed); circular refs impossible by construction; includes only shapes, not transient cursor positions.
- Depends on: HISTORY serializer (open handoff), SHELL-2.

### SHARE-10: Import board JSON
- Priority: P1
- Size: M
- Interaction: File > Import… or drag a `.json` onto the board; a confirm dialog "Replace this board? / Add to this board" (default Add, offset by the viewport center); validation by HISTORY's `parseBoard(json)` returning `{ok, board, errors}`; success toast with counts. Import is one undo step.
- Acceptance: invalid JSON shows the first validation error without touching the board; Add mode regenerates ids to avoid collisions; Replace is undoable.
- Edge cases: future `version` (reject with message), file >10MB, JSON with agent-owned shapes whose agent is not live (shapes become unowned).
- Depends on: SHARE-9, HISTORY.
- Multi-agent note: imports pause agent ops for the one tick it takes to apply.

### SHARE-11: Present mode
- Priority: P1
- Size: L
- Interaction: Cmd+Shift+P hmm collides with the command palette in some apps; use Cmd+Alt+P or the top-bar "Present" button, and palette "Present". Enters browser fullscreen (`requestFullscreen`, user gesture), hides all chrome, fits the first frame (ordered by layer order, or the `present` order set in a frames list) with a 150ms ease; Right/Down/Space/PageDown = next frame, Left/Up/PageUp = previous, number keys jump, Esc exits, `N` toggles agent cursors, `L` laser pointer (P2). Bottom-center slide counter "2 / 5" fades after 2s.
- Acceptance: with 3 frames the right arrow cycles 1→2→3→(stops or loops per setting); Esc exits fullscreen and restores the previous camera; agents keep moving in the background if cursors are visible.
- Edge cases: no frames (present the fit-all view with a hint); one frame; fullscreen denied (fallback to app-level full viewport); window resize while presenting re-fits; reduced motion (SHELL-17) uses a cut instead of ease.
- Depends on: CANVAS camera animation, SHELL-4, SHELL-17.
- Multi-agent note: the demo's money shot; frames being created by agents appear in the sequence live, with a toast "New frame: <name>".

### SHARE-12: Frame embed / pitch image
- Priority: P1
- Size: S
- Interaction: "Copy embed image" produces a 2x PNG of the selected frame with a subtle 24px padding and rounded corners on a transparent or deck-matching background (setting), plus optional "Frame label" chip. Output goes to clipboard (SHARE-7) or a download named for slide order. A `?embed=1&frame=<id>` URL renders only that frame fit to the window with no chrome (read-only), for iframes in the pitch deck.
- Acceptance: `#/playground?embed=1&frame=abc` shows only the frame, no panels, no top bar, no toolbar; the PNG is crisp at 1920 wide; embed mode implies view-only.
- Edge cases: frame deleted since the link was made (empty state "Frame not found"); iframe sizing and `X-Frame-Options` come from the host, not this app.
- Depends on: SHARE-3, SHARE-4, SHELL-12.

### SHARE-13: Print
- Priority: P2
- Size: S
- Interaction: Cmd/Ctrl+P (we intercept, KEYS-6) renders the same SVG as SHARE-6 for the selected frames (or whole board) into a hidden print container and calls `window.print()`; `@media print` hides all `.pg-*` chrome and sets `@page` margin 10mm; each frame on its own page.
- Acceptance: print preview shows only frame content, one frame per page, no panels or dots; background colors print (`print-color-adjust: exact`).
- Edge cases: frames larger than a page are scaled to fit; empty board message.
- Depends on: SHARE-6.

### SHARE-14: Share menu and dialog
- Priority: P1
- Size: M
- Interaction: the Share button (`Playground.tsx:418`) becomes a popover: Copy link to view, Copy link to selection, access dropdown (Edit | View only), toggle "Include selection", "Embed" tab with copyable `<iframe>` snippet (SHARE-12), "Export" tab (SHARE-4/5/9). Cmd+Shift+S hmm browsers Save-as; use only the button and palette.
- Acceptance: each action produces its toast; the popover closes on Esc and returns focus to the Share button; keyboard operable.
- Edge cases: clipboard denied; popover near viewport edge.
- Depends on: SHARE-1, SHARE-3, SHELL-9.

### SHARE-15: Follow link to an agent or layer
- Priority: P2
- Size: S
- Interaction: `&follow=<agentId>` makes the camera track that agent's cursor (spectator camera, smooth) until the user pans; `&focus=<layerId>` is an alias for single-layer selection + fit. Palette: "Follow <agent>".
- Acceptance: opening a follow link keeps the cursor centered; any wheel/drag stops following and shows "Following stopped" toast.
- Edge cases: agent not present; two followers.
- Depends on: SHARE-2, MULTI cursor ids.

### SHELL-1: Top bar structure
- Priority: P0
- Size: M
- Interaction: left to right: back arrow (`#/live`), logo menu (File/Edit/View/Help menus; macOS-style menu bar is not needed), editable file name (SHELL-2), then flex spacer; centre-right: Comment menu (exists, `Playground.tsx:410`), avatar stack with presence popover, Share, Present, zoom menu (SHELL-3). Height stays 44px (`playground.css:21`). Every control is a `<button>` with an accessible name and a tooltip with its shortcut.
- Acceptance: all current controls remain; tab order follows visual order; at 1280px nothing wraps; at <900px the file name truncates with ellipsis and the subtitle ("proof of concept") disappears.
- Edge cases: 50+ agents (avatar overflow "+42" with popover, today capped at 8 at `:403`); long file names.
- Depends on: SHELL-6, SHELL-11.

### SHELL-2: Editable file name
- Priority: P1
- Size: S
- Interaction: click the title (or F2 / palette "Rename board") to turn it into an input; Enter/blur commits, Esc cancels; stored in prefs and in the URL title and `document.title` ("Name · Playground"). Max 60 chars; empty reverts to "Untitled".
- Acceptance: renamed title persists across reload; exported files (SHARE-4/9) use it; keys typed inside do not trigger tools (KEYS-2).
- Edge cases: illegal filename chars are sanitized only on export; double-click selects all text.
- Depends on: KEYS-2, SHELL-29.

### SHELL-3: Zoom menu
- Priority: P0
- Size: S
- Interaction: the zoom button (`Playground.tsx:422`, currently fit only) opens a menu: Zoom in, Zoom out, Zoom to 100%, 50%, 200%, Zoom to fit, Zoom to selection, Show/hide pixel grid; each row shows its shortcut from KEYS-1. Clicking the percentage still shows the value; typing a number in the menu header sets exact zoom.
- Acceptance: menu opens on click and closes on Esc/outside click; "Zoom to fit" matches Shift+1; the label updates during zoom gestures.
- Edge cases: menu open while an agent moves the camera (no agents move the human camera); extreme zooms clamp.
- Depends on: KEYS-5, SHELL-10.

### SHELL-4: Collapsible panels (Cmd+\ and Cmd+.)
- Priority: P0
- Size: M
- Interaction: Cmd/Ctrl+\ toggles the left panel, Cmd/Ctrl+. toggles the right panel, Cmd/Ctrl+Shift+\ toggles both ("UI hidden", also top bar stays); each panel has a chevron button at its edge. Collapse animates width over 160ms (instant under reduced motion). The canvas gains the freed space and keeps the world point under its center fixed (adjust camera by half the width delta).
- Acceptance: toggling panels does not visibly shift shapes; collapsed state persists after reload; chat input is not lost when the left panel collapses (state lives above the panel).
- Edge cases: collapsing while the chat input is focused (focus moves to the board); both panels collapsed on a 600px window.
- Depends on: KEYS-1, SHELL-29, SHELL-5.

### SHELL-5: Resizable panel widths (persisted)
- Priority: P1
- Size: M
- Interaction: a 6px drag handle on each panel's inner edge; min 200px, max 420px; double-click resets to default (240 / 260); width stored as CSS variables `--pg-left-w` and `--pg-right-w` in prefs. Keyboard: focus the handle and use Left/Right (role="separator", `aria-valuenow`).
- Acceptance: dragging resizes at 60fps with the canvas reflowing; reload restores widths; keyboard resizing moves 16px per key.
- Edge cases: window narrower than min panel widths sum (panels auto-collapse, SHELL-8); pointer leaves window while dragging (pointer capture).
- Depends on: SHELL-29.

### SHELL-6: Theme tokens
- Priority: P0
- Size: M
- Interaction: consolidate every color in `playground.css` into `--pg-*` tokens (surface, surface-raised, line, ink, muted, hover, selection, accent, dot, board-bg, focus-ring, danger, success) defined once under `.pg` and overridden by `.pg[data-theme='dark']`. Replace hard-coded hex (`#f1efe9`, `#fff`, `#ebe8e1`, `playground.css:23,30,51,66`). Shape fills stay raw user data and are not themed. Radius, spacing (4px scale), z-index and motion durations (`--pg-dur-fast: 120ms`) tokens too.
- Acceptance: no hex literal remains in `playground.css` outside the token block (grep check in a vitest or lint script); switching `data-theme` re-skins all chrome with no reload.
- Edge cases: agent cursor colors need contrast on both themes (name label text color computed); selection blue on a blue shape.
- Depends on: none.

### SHELL-7: Dark mode (decision: board chrome follows theme, canvas background follows theme, shapes unchanged)
- Priority: P1
- Size: M
- Interaction: recommended decision: default `system` with three-way setting Light | Dark | System. The surrounding dashboard is Primer dark (`styles.css:24`), so the light board is a jarring island; dark chrome (panels, top bar, toolbar) and a dark dotted canvas (`--pg-bg: #161b22`, dots `#30363d`) match it, but the demo should default to Light for stage projectors and screenshots (see open question). Shapes keep their authored colors; default new-shape fill is theme aware.
- Acceptance: Dark applies `color-scheme: dark` for scrollbars/inputs; all text meets 4.5:1 in both themes (checked with the a11y script, SHELL-16); exported PNG/SVG never bake in dark chrome (export uses a light or transparent board background by option).
- Edge cases: `prefers-color-scheme` changes live; screenshots for the pitch; shape named "Background" with white fill in dark theme.
- Depends on: SHELL-6, SHELL-14.

### SHELL-8: Responsive breakpoints
- Priority: P1
- Size: M
- Interaction: ≥1200px full layout; 900-1199px right panel auto-collapses to an overlay drawer; 600-899px both panels become overlays with a toggle in the top bar, toolbar shrinks to icons only; <600px (phone, view-only) hides editing UI and offers Present. Touch: coarse pointer gets 44px hit targets and pinch zoom is CANVAS's.
- Acceptance: at 1024, 768 and 390 widths nothing overlaps the toolbar and the board stays pannable; no horizontal page scroll.
- Edge cases: orientation change; software keyboard on mobile pushing the chat input.
- Depends on: SHELL-4, SHELL-6.

### SHELL-9: Toasts and notifications pattern
- Priority: P0
- Size: M
- Interaction: replace the single-string toast (`Playground.tsx:263-267`) with a `toast.show({text, kind: info|success|warn|error, action?, id?, ttl})` API from a `ToastProvider`; bottom-center stack, newest at the bottom, max 3 visible, 2.5s default ttl (6s with an action, sticky for errors), `id` dedupes and updates an existing toast (e.g. "Exporting… → Exported"). Hover pauses timer. Container is `role="status"` `aria-live="polite"` (errors `assertive`). Agent-related toasts are rate limited to 1 per agent per 2s.
- Acceptance: firing the same id twice shows one toast; 10 toasts in a burst show 3; errors stay until dismissed; screen readers announce each once.
- Edge cases: toast over presenter mode (suppressed except errors); reduced motion (fade only).
- Depends on: SHELL-6.

### SHELL-10: Context menus pattern
- Priority: P0
- Size: M
- Interaction: one `ContextMenu` component driven by registry commands: right-click (or Shift+F10 / Menu key) on a layer, canvas, frame, layer row, agent row, or avatar opens a menu at the pointer with sections and shortcuts at right. Layer menu: Copy, Paste here, Duplicate, Group, Bring to front, Rename, Lock, Export…, Ask agent about this, Delete. Canvas menu: Paste here, Select all, Zoom to fit, Add comment here. Keyboard: arrows, Enter, Esc, typeahead; submenus open with Right. Menu closes on scroll, resize, outside click, Esc; the browser menu is suppressed only on the board.
- Acceptance: right-clicking a shape selects it first (if not already part of the selection) and opens the menu within a frame; every entry equals a registry command and shows the same shortcut; menu is reachable via keyboard.
- Edge cases: menu near edges flips; right-click during drag cancels; `contextmenu` on text inputs keeps the native menu; touch long-press.
- Depends on: KEYS-1, SHELL-6.

### SHELL-11: Tooltips with shortcut hints
- Priority: P1
- Size: S
- Interaction: replace `title=` attributes (toolbar at `Playground.tsx:546`, share, zoom) with a `<Tooltip label shortcutId>` that shows label plus a `<kbd>` rendered from KEYS-1 for the current platform; 500ms show delay, instant when moving between adjacent tooltips, hides on press or Esc, placed away from edges. Also available on keyboard focus (`:focus-visible`), referenced with `aria-describedby`.
- Acceptance: hovering the Rectangle tool shows "Rectangle R"; Windows shows "Ctrl" glyphs where relevant; no tooltips on touch; tooltip text equals the registry title.
- Edge cases: disabled buttons still show a tooltip with the reason; tooltip inside a scrolled panel.
- Depends on: KEYS-1, SHELL-6.

### SHELL-12: Empty states
- Priority: P1
- Size: S
- Interaction: designed empty states for: empty board ("Press R to draw, or ask an agent. Press / for actions."), empty layers list (exists as `.pg-empty`, `playground.css:48`), no agents (CTA "Spawn demo agents"), no comments, no search results in the palette, frame-not-found in embed mode, export with nothing selected. Each has one line of copy, one primary action and a keyboard hint.
- Acceptance: every list surface has an empty state; the board empty state disappears on the first shape and does not intercept pointer events.
- Edge cases: board emptied by an agent; view-only mode (copy changes to "Nothing here yet").
- Depends on: SHELL-6.

### SHELL-13: First-run onboarding hints
- Priority: P1
- Size: M
- Interaction: no modal tour (annoying on stage). Instead 4 dismissible contextual hints shown once each: "Hold Space to pan, pinch or Cmd+scroll to zoom", "Press / for quick actions", "Click the comment tool and point at a layer to talk to its agent", "Press ? for all shortcuts". A "Take the tour" item in Help restarts them; seen flags stored in prefs; `?demo=1` suppresses all of them.
- Acceptance: hints appear once, in order, never overlap the toolbar, and disappear after the related action is performed; clearing prefs brings them back.
- Edge cases: fresh profile in presenter mode (suppressed); screen readers read hint text (`role="status"`).
- Depends on: SHELL-9, SHELL-29, SHELL-24.

### SHELL-14: Settings panel
- Priority: P1
- Size: M
- Interaction: gear menu or Cmd+, opens a popover/dialog with grouped toggles: Snap to objects (on), Snap to pixel grid, Grid size (8/16/32), Show dot grid, Show comment pins, Show agent cursor names, Show agent trails (P2), Agent speed (1x/2x/4x, mirrors the right-panel control `Playground.tsx:565`), Theme (Light/Dark/System), Reduced motion (Auto/On), Nudge amounts, URL sync (SHARE-2), Show FPS HUD (SHELL-20), Reset onboarding, Reset all settings. Shapes of the setting live in one typed `Prefs` object.
- Acceptance: each toggle takes effect immediately without reload and persists; "Reset all" returns to defaults after confirm; settings are searchable in the palette ("Toggle snap").
- Edge cases: settings changed in another tab (storage event updates this tab); invalid stored values are dropped field by field.
- Depends on: SHELL-29, KEYS-1.

### SHELL-15: Keyboard-only operation
- Priority: P1
- Size: M
- Interaction: everything reachable without a mouse: Tab moves through top bar → left panel → canvas → right panel (canvas is a single tab stop with `role="application"`), F6 cycles regions, arrows in the layer list move the selection (roving tabindex), Enter on a layer focuses it, `Alt+Arrow` moves the camera, `Cmd+Enter`/Esc exit text edit, "Skip to canvas" link. Focus ring (`--pg-focus-ring`, 2px, `:focus-visible` only) on every interactive element. Drawing by keyboard is out of scope; the palette can create shapes ("Insert rectangle at center").
- Acceptance: a user can add a rectangle, rename it, move it with arrows, export it and share the link with the keyboard alone; focus is never lost to `body` after closing a menu or dialog.
- Edge cases: focus return when a focused layer row is deleted by an agent (focus moves to the next row); dialogs trap focus.
- Depends on: KEYS-2, SHELL-10, SELECT arrows.

### SHELL-16: Screen-reader labels and a11y baseline
- Priority: P1
- Size: M
- Interaction: landmark roles (`banner`, `navigation` for the toolbar, `complementary` for panels, `main` for canvas with `aria-label`); toolbar uses `role="toolbar"` and `aria-pressed` for the active tool; every icon-only button gets `aria-label`; layers list is `role="tree"`/`listbox` with `aria-selected`; a visually hidden `aria-live="polite"` region announces major events ("Rectangle added by Lin", "3 layers selected", "Zoom 200%"), batched and rate limited to 1 per second so 50 cursors do not flood it; color contrast ≥ 4.5:1; layer type conveyed in text, not color alone.
- Acceptance: an axe-core run (as a devDependency script, flag as new-dep open question, or a manual checklist) reports no serious/critical issues on the main view; VoiceOver can list tools and read the layer names.
- Edge cases: announcements during Present mode; non-Latin layer names.
- Depends on: SHELL-6, SHELL-15.

### SHELL-17: Reduced motion
- Priority: P1
- Size: S
- Interaction: a `useReducedMotion()` hook reads `prefers-reduced-motion` and the pref override; when on, camera animations (fit, zoom-to-selection, Present) become instant cuts, panel collapse and toasts only fade, agent cursor smoothing is capped (cursors jump to targets, no easing trails), pulsing pins stop pulsing. CSS uses `@media (prefers-reduced-motion: reduce)` for transitions via the duration tokens (set to 0).
- Acceptance: with the OS setting on, Shift+1 changes camera in a single frame; no CSS animation runs; demo can force it off for show (pref "Always animate").
- Edge cases: setting changes live (media query listener); engine speed pref is separate.
- Depends on: SHELL-6, SHELL-14.

### SHELL-18: Error boundaries
- Priority: P0
- Size: M
- Interaction: three boundaries: app root (Playground shell fallback with "Reload board" and "Copy error"), per-shape (`ShapeView` renders a red dashed placeholder labelled "Shape <id> failed" with a "Remove" action instead of crashing the board), per-panel (a panel can crash without taking down the canvas). The engine tick and agent-op application (`window.board.*` and the op bus) wrap each op in try/catch, drop the bad op, log to the console and a ring buffer, and raise a single dedup'd error toast "Agent <name> sent a bad op (ignored)". Non-finite numbers, missing fields and unknown kinds are normalized by a `sanitizeShape()` guard before they reach React state.
- Acceptance: `board.addShape({w: NaN, x: undefined})` does not crash and results in either a sanitized shape or a rejected op with a toast; throwing inside one ShapeView leaves other shapes and panels interactive; the fallback shows the last 5 error messages.
- Edge cases: errors in event handlers are not caught by boundaries (use try/catch in the dispatcher); error loops (boundary resets only on user action); StrictMode double-render noise.
- Depends on: SHELL-9, SHELL-21.
- Multi-agent note: a misbehaving agent is quarantined after N bad ops in 10s (its cursor greys out, "paused: too many bad ops"); other agents continue.

### SHELL-19: Performance budget and how to measure it
- Priority: P0
- Size: M
- Interaction: budget: 60fps (p95 frame ≤ 16.7ms, p99 ≤ 25ms) during pan/zoom with 50 agent cursors and 3,000 shapes; shape drag at ≥ 55fps with 500 selected; input latency (keydown to visible change) ≤ 50ms; palette open ≤ 100ms; export of 500 shapes ≤ 1s; initial load JS ≤ 300KB gzip for the playground chunk (lazy-load export/present code); memory growth ≤ 50MB over a 10-minute run. Measure with `?perf=1`: a harness page script (`perf.ts`) that seeds 3k shapes + 50 cursors through `window.board`, scripts a 10s pan/zoom path with `requestAnimationFrame` timestamps and `PerformanceObserver` (`longtask`, `measure`), then prints p50/p95/p99 frame times and long-task count to the console and to `window.__perfReport`. Chrome DevTools Performance and React Profiler are the manual fallbacks.
- Acceptance: running `#/playground?perf=1` yields a report meeting the budget on the demo laptop; the report is attached to the PR touching hot paths; a regression of >20% p95 fails the review checklist.
- Edge cases: background tab throttling (hidden-pane rAF), 120Hz displays (budget is in ms, not fps), first-run JIT warmup (discard first 2s).
- Depends on: CANVAS render strategy (virtualize/cull shapes offscreen), SHELL-20.
- Multi-agent note: agent cursors should render on one canvas/layer or via CSS transforms with `will-change`, not one React state update per cursor per frame; engine already ticks centrally (`engine.ts`).

### SHELL-20: FPS and perf HUD
- Priority: P1
- Size: S
- Interaction: toggle via palette "Show performance HUD" or `?hud=1`; small corner overlay: fps, p95 frame ms, shapes count, cursors count, ops/sec, render count of Playground. Uses rAF deltas, updated at 2Hz to avoid its own cost.
- Acceptance: HUD costs <0.5ms per frame; hidden by default and never shown in embed or present modes.
- Edge cases: tab hidden (HUD pauses).
- Depends on: SHELL-14.

### SHELL-21: Telemetry hooks (ops per agent)
- Priority: P1
- Size: M
- Interaction: a tiny in-memory `telemetry` module with `count(name, tags)`, `time(name)` and `snapshot()`; hooks at the op bus (create/update/delete/move per agent id), command runs (by command id and source: key|palette|menu|agent), toasts, errors, exports and frame times. Right panel shows a "Stats" section: ops per agent (live counter and sparkline), ops/min, total shapes, and the session's command usage. `window.__telemetry.snapshot()` returns JSON for the demo dashboard. Nothing leaves the browser; no network.
- Acceptance: after the scripted demo each agent has a non-zero ops count; counters survive panel collapse; snapshot size stays <100KB (ring buffers).
- Edge cases: 200 agents (aggregate beyond top 10); counters reset button.
- Depends on: MULTI op bus, SHELL-14.
- Multi-agent note: this is the source for the "who did what" pitch slide.

### SHELL-22: Unit test strategy (vitest, pure engine functions)
- Priority: P0
- Size: M
- Interaction: add vitest in `dashboard/` (check whether it is already a devDependency; if not it is a new dependency, flagged in Open questions) and keep engine and helpers pure so they test without a DOM: `engine.ts` (tick, easing, cursor targets), geometry (`inside`, `frameOf`, `toWorld`, bounds), `shortcuts.ts` (no conflicts, platform labels), fuzzy search, URL encode/decode (SHARE-1/2), `toSvg`, `sanitizeShape`, prefs migration, board JSON round-trip. Files `*.test.ts` next to sources; `npm test` runs under 10s. A DOM-needing component test uses `happy-dom` only if unavoidable (open question).
- Acceptance: CI/local `npm test` passes; each new pure function in this domain ships with tests; coverage target ≥ 80% for `shortcuts.ts`, `url.ts`, `export.ts`.
- Edge cases: engine uses `performance.now`/`requestAnimationFrame` (inject a clock); seeded RNG for agent scripts so tests are deterministic.
- Depends on: engine and geometry kept free of React imports.

### SHELL-23: Browser smoke check (no Playwright)
- Priority: P1
- Size: M
- Interaction: a checklist script `docs/playground/smoke.md` (outside this task) executed with the in-app browser pane (`mcp__Claude_Browser__*`): navigate to `#/playground`, press keys via `computer`, read `window.board.shapes()` via `javascript_tool`, and assert via `read_page`. Steps: load without console errors; press R, drag, expect 1 shape; Cmd+K, type "fit", Enter; `?` opens overlay; Cmd+\ collapses panel; Share link round-trips; export triggers a download blob (assert `URL.createObjectURL` call via a test hook `window.__lastExport`); reload keeps settings; 0 console errors.
- Acceptance: the script is run before each demo and each merge to the playground branch; failures are reported with step numbers.
- Edge cases: hidden-pane rAF throttling (the tool notes timing can be off; prefer `read_page`).
- Depends on: SHELL-22, KEYS-9, SHARE-1.

### SHELL-24: Feature flags
- Priority: P0
- Size: S
- Interaction: `flags.ts` exports `flag(name): boolean` resolved from, in order: URL `?ff=a,b,-c`, localStorage `pg.flags`, defaults table (`palette: true`, `present: false`, `darkMode: false`, `exportSvg: false`, `perfHud: false`, `viewOnly: false`, `onboarding: true`, `telemetry: true`). Registry commands (KEYS-1) and UI sections can be `flag`-gated; unfinished work ships dark. Palette "Toggle flag…" lists all flags (dev builds only: `import.meta.env.DEV`).
- Acceptance: unfinished features are invisible by default and enable via `?ff=present`; production demo URL has all MVP flags on without parameters; unknown flags are ignored.
- Edge cases: flags that change mid-session (re-render via a store); flag gating of keyboard commands (hidden from overlay and palette too).
- Depends on: SHELL-29.

### SHELL-25: Demo script and stage checklist
- Priority: P0
- Size: M
- Interaction: a rehearsed 3-minute script: (1) open board empty, agents idle; (2) human drops a frame; (3) prompt agents in chat, cursors race in with names; (4) human uses `/` to duplicate and Cmd+K "export"; (5) Comment tool on a layer, note goes to its agent; (6) copy link, open in a second window showing both views; (7) Present mode flip through frames; (8) show the ops-per-agent panel. Checklist before going on stage: projector resolution 1920x1080, browser zoom 100%, Light theme (decision), Reduced motion off, notifications/Do Not Disturb on, `?demo=1` URL, speed 1x, FPS HUD off, network not required, backup recording, localStorage cleared, battery saver off, a fallback of pre-exported PNG/JSON files, and a "panic" key (Cmd+Shift+Backspace in demo mode) that resets to the seeded board.
- Acceptance: a run-through takes ≤ 3:30 with zero console errors; the checklist lives in `docs/playground/demo-script.md`; two people can rehearse it from the doc alone.
- Edge cases: Wi-Fi drops (app has no network dependency); an agent ops spike; presenter hits a wrong key (Cmd+Z everywhere works).
- Depends on: SHELL-26, SHARE-11, SHELL-21.

### SHELL-26: Demo mode, seed and reset
- Priority: P1
- Size: S
- Interaction: `?demo=1` seeds a deterministic starter board (3 frames, 20 shapes), suppresses onboarding hints, hides FPS HUD, locks the scripted agent speed, enables the panic-reset key, and shows a tiny "Reset demo" in Help. Seed lives in `demoSeed.ts` using HISTORY's board format.
- Acceptance: after Reset the board equals the seed (deep equal) within 300ms; demo mode never runs unless the param is present.
- Edge cases: reset during an in-flight export.
- Depends on: HISTORY format, SHELL-24.

### SHELL-27: Menus (File, Edit, View, Help)
- Priority: P1
- Size: M
- Interaction: the logo opens a menu structure rendered from the registry: File (Rename, Import, Export board, Export selection, Print), Edit (Undo/Redo, Copy, Paste, Duplicate, Select all), View (Zoom items, Panels, Grid, Theme, Present, Performance HUD), Help (Shortcuts ?, Take the tour, Reset demo, About). Each row shows its shortcut; disabled rows show why on hover.
- Acceptance: every menu row has a registry command; opening the menu with Alt+F, Alt+E, Alt+V (Windows) or from the logo works; arrows/Enter/Esc work.
- Edge cases: menus while in view-only mode (edit items hidden).
- Depends on: KEYS-1, SHELL-10.

### SHELL-28: Confirm dialog and modal pattern
- Priority: P1
- Size: S
- Interaction: one `Dialog` component (focus trap, Esc, scrim, return focus) used by Import-replace, Reset all, Delete frame with children, Shortcut overlay, Settings, Share. Primary button is the safe default; destructive actions are red and labeled with the verb ("Delete 12 layers").
- Acceptance: Tab cycles inside; Esc/scrim click closes unless `blocking`; screen reader announces the title via `aria-labelledby`.
- Edge cases: stacked dialogs (only top responds to Esc); dialog opened while presenting.
- Depends on: SHELL-6.

### SHELL-29: Prefs store (persisted settings)
- Priority: P0
- Size: S
- Interaction: `prefs.ts` provides a typed store `usePrefs()` over localStorage key `pg.prefs.v1` with schema versioning, defaults, per-field validation, cross-tab sync (`storage` event), `useSyncExternalStore`, and a try/catch memory fallback when storage throws. Holds panel widths/collapsed, theme, snap, grid, names, speed, recents, onboarding flags, file name, flag overrides.
- Acceptance: corrupt JSON falls back to defaults without a crash; changing a pref in one tab updates another; unit tests cover migration and fallback.
- Edge cases: quota exceeded; Safari private mode; schema bump (migrate or drop).
- Depends on: none.

### SHELL-30: Presence popover and avatar overflow
- Priority: P2
- Size: S
- Interaction: clicking the avatar stack (`Playground.tsx:403`) lists all cursors (humans and agents) with status, ops count (SHELL-21), "Follow" (SHARE-15) and "Locate" (jumps camera to the cursor). Overflow shows "+N" instead of cutting at 8.
- Acceptance: with 50 agents the list scrolls and filters; Locate moves the camera to the cursor.
- Edge cases: agent leaves while the popover is open.
- Depends on: SHELL-10, MULTI cursors.

### SHELL-31: Comment shortcut in top bar and notifications
- Priority: P2
- Size: S
- Interaction: top-bar Comment button toggles the comment tool (C) and shows an unread dot when an agent replies to a pin; Shift+C... is avoided; "Resolve all" lives in the palette. In-app notification list (bell) mirrors toasts for the last 20 events with timestamps.
- Acceptance: new agent reply shows a dot until the panel is opened; the bell list is keyboard reachable.
- Edge cases: notifications while the panel is collapsed.
- Depends on: SHELL-9, MULTI comments.

## Data model and architecture implications

Files to add under `dashboard/src/playground/` (new files only; existing ones are changed by feature owners): `shortcuts.ts`, `commands.ts`, `dispatcher.ts`, `palette/Palette.tsx`, `palette/fuzzy.ts`, `QuickActions.tsx`, `HelpOverlay.tsx`, `export.ts`, `url.ts`, `prefs.ts`, `flags.ts`, `telemetry.ts`, `perf.ts`, `toast.tsx`, `ContextMenu.tsx`, `Tooltip.tsx`, `Dialog.tsx`, `ErrorBoundary.tsx`.

```ts
type Platform = 'mac' | 'win';
type FocusContext = 'canvas' | 'panel' | 'chat' | 'text-edit' | 'palette' | 'dialog';
type Binding = string | string[]; // 'Mod+Shift+K', 'V', chord ['g','l']; Mod = Cmd on mac, Ctrl on win

interface Command {
  id: string;                       // 'tool.rect', 'edit.duplicate', 'view.fit'
  title: string;                    // palette/tooltip/menu text
  group: 'Tools' | 'Edit' | 'View' | 'Arrange' | 'Share' | 'Agents' | 'Settings' | 'Help';
  aliases?: string[];               // for fuzzy search
  keys?: { mac?: Binding[]; win?: Binding[]; all?: Binding[] };
  contexts: FocusContext[];         // where the key fires; palette/menu ignore this
  needs?: 'none' | 'selection' | 'single' | 'frame';
  when?: (ctx: AppContext) => boolean | string; // false/ reason string => disabled
  flag?: string;
  run: (ctx: AppContext, args?: unknown) => void | Promise<void>;
  source?: 'key' | 'palette' | 'menu' | 'agent'; // set by caller for telemetry
}

interface AppContext {                    // handed to commands, not React state
  engine: Engine; getShapes(): Shape[]; getSelection(): string[];
  camera: { get(): Cam; set(c: Cam, opts?: { animate?: boolean }): void };
  toast: Toaster; prefs: Prefs; mode: 'edit' | 'view' | 'present' | 'embed';
}

interface Prefs {                         // localStorage 'pg.prefs.v1'
  v: 1; fileName: string; theme: 'light' | 'dark' | 'system';
  leftW: number; rightW: number; leftOpen: boolean; rightOpen: boolean;
  snapObjects: boolean; snapGrid: boolean; gridSize: 8 | 16 | 32;
  showDots: boolean; showPins: boolean; showCursorNames: boolean;
  speed: 1 | 2 | 4; reducedMotion: 'auto' | 'on'; urlSync: boolean;
  nudge: number; bigNudge: number; recents: string[]; seen: Record<string, true>;
  keymap?: Record<string, string>; flags?: Record<string, boolean>;
}

interface ShareView { x: number; y: number; z: number; sel: string[]; frame?: string; mode?: 'view'|'embed'; follow?: string; }
// url.ts: encodeView(v): string  /  decodeView(hash): Partial<ShareView> (pure, tested)

interface ExportOptions { scale: number | 'auto'; format: 'png' | 'svg' | 'jpg'; bg: 'transparent' | 'board'; padding: number; }
// export.ts: boundsOf(shapes), renderToCanvas(shapes,b,o) (pure draw fn taking a 2D context), toSvg(shapes,b), downloadBlob(blob,name)
```

Architecture points:
- Single dispatcher and registry, so keys, palette, quick actions, menus, tooltips, overlay and agents all execute `Command.run`. Agents call `commands.run(id)` through the op bus, which also feeds telemetry (SHELL-21) and error isolation (SHELL-18).
- Move imperative app state (camera, selection, tool, mode) behind refs plus a small store, because the dispatcher lives outside React render and `Playground.tsx:170-192` currently re-subscribes on every `selected` change.
- Focus context is derived, not stored: `activeElement.closest('[data-pg-ctx]')` with `data-pg-ctx` on canvas, panels, chat and dialogs.
- Export renders from the shape model, not the DOM, so it works for offscreen shapes and is unit testable. `renderToCanvas` takes a `CanvasRenderingContext2D` so tests can use a recording stub.
- Camera API must accept `animate` and respect reduced motion; URL read/write goes through it.
- HISTORY handoff: need `serializeBoard(state): BoardFile`, `parseBoard(json): {ok, board, errors}`, `version` field and migrations, and that import is a single history entry. This domain only does I/O and UI.
- CANVAS handoff: `getBounds(ids)`, `fitToBounds(b, opts)`, shape culling for the perf budget, an `onViewportChange` hook (debounced) for URL sync.
- MULTI handoff: agent id, display name and color on every op; `commands.run` accepts `source:'agent'` and `actor`.
- CSS: keep one stylesheet but all color/spacing from tokens; `@media (prefers-reduced-motion)`, `@media print`, and responsive rules live at its end.
- The playground route ignores query strings today (`main.tsx:10`), so no router change is needed; if `?` params must reach the dashboard's own routes later, a shared `parseHash` helper belongs in `main.tsx` (outside this domain).

### Shortcut table

Mod = Cmd on macOS, Ctrl on Windows. "Ctx" is the focus context where it fires (C canvas/panel, G global incl. chat). Conflict column lists browser/OS clashes and the resolution.

| Action | Mac | Windows | Ctx | Conflicts / handling |
| --- | --- | --- | --- | --- |
| Move / select tool | V | V | C | none |
| Hand tool | H (hold Space) | H (hold Space) | C | Space scrolls page: preventDefault |
| Frame tool | F (A alias) | F (A alias) | C | none |
| Rectangle | R | R | C | none |
| Ellipse | O | O | C | none |
| Line | L | L | C | none |
| Pen / path | P | P | C | none |
| Text | T | T | C | none |
| Comment | C | C | C | none |
| Eyedropper | I | I | C | none |
| Tool lock | Q | Q | C | none |
| Cancel / deselect / back to Move | Esc | Esc | G | closes the topmost layer first (dialog, palette, menu, popover) |
| Command palette | Cmd+K or Cmd+/ | Ctrl+K or Ctrl+/ | G | Ctrl/Cmd+K focuses address bar in some browsers: preventDefault |
| Quick actions | / | / | C | typed literally in text contexts |
| Shortcut sheet | ? (Shift+/) | ? | C | none |
| Settings | Cmd+, | Ctrl+, | G | Safari preferences when not prevented |
| Select all | Cmd+A | Ctrl+A | C | native select-all in text contexts: not intercepted there |
| Copy / Cut / Paste | Cmd+C / X / V | Ctrl+C / X / V | C | native in text contexts |
| Paste in original place | Cmd+Shift+V | Ctrl+Shift+V | C | browser paste-as-plain-text: preventDefault on canvas |
| Duplicate | Cmd+D | Ctrl+D | C | bookmark: preventDefault (Mac Safari/Chrome, Win Chrome/Edge) |
| Delete | Delete / Backspace | Delete / Backspace | C | old Backspace-back: preventDefault |
| Undo / Redo | Cmd+Z / Cmd+Shift+Z | Ctrl+Z / Ctrl+Y, Ctrl+Shift+Z | C | native in text contexts (HISTORY) |
| Group / Ungroup | Cmd+G / Cmd+Shift+G | Ctrl+G / Ctrl+Shift+G | C | find-next: preventDefault |
| Frame selection | Cmd+Alt+G | Ctrl+Alt+G | C | none |
| Rename | Cmd+R or F2 | F2 or Ctrl+R | C | reload: preventDefault Cmd/Ctrl+R on canvas only |
| Lock / hide | Cmd+Shift+L / Cmd+Shift+H | Ctrl+Shift+L / Ctrl+Shift+H | C | Ctrl+Shift+H history (Firefox): best effort |
| Bring forward / back | Cmd+] / Cmd+[ | Ctrl+] / Ctrl+[ | C | Cmd+[ is Back on Safari/Chrome: preventDefault |
| Bring to front / send to back | Cmd+Shift+] / [ | Ctrl+Shift+] / [ | C | tab switching in some browsers (best effort) |
| Nudge 1 / 10 px | Arrows / Shift+Arrows | Arrows / Shift+Arrows | C | page scroll: preventDefault |
| Constrain ratio / add to selection | hold Shift | hold Shift | C | momentary |
| Draw from center / duplicate-drag | hold Option | hold Alt | C | Alt focuses menu bar on Windows: preventDefault keyup |
| Pan | hold Space + drag; middle-drag; wheel | same | C | Space scroll |
| Zoom in / out | Cmd+= / Cmd+- | Ctrl+= / Ctrl+- | C | browser page zoom: preventDefault |
| Zoom 100% | Shift+0 or Cmd+0 | Shift+0 or Ctrl+0 | C | page zoom reset: preventDefault |
| Zoom to fit | Shift+1 | Shift+1 | C | match by `e.code` (layout) |
| Zoom to selection | Shift+2 | Shift+2 | C | match by `e.code` |
| Zoom wheel/pinch | Cmd+wheel / pinch | Ctrl+wheel / pinch | C | page zoom: wheel preventDefault (exists) |
| Toggle left panel | Cmd+\ | Ctrl+\ | G | none known |
| Toggle right panel | Cmd+. | Ctrl+. | G | none known |
| Toggle both panels (UI hidden) | Cmd+Shift+\ | Ctrl+Shift+\ | G | none known |
| Focus agent chat | Option+A | Alt+A | C | types "å" in text fields: only fires outside text contexts |
| Send to all agents | Cmd+Enter | Ctrl+Enter | chat | none |
| Export selection | Cmd+Shift+E | Ctrl+Shift+E | C | Chrome/Firefox DevTools combos vary: best effort |
| Copy as PNG | Cmd+Shift+C | Ctrl+Shift+C | C | Chrome DevTools inspect: verify, else palette-only |
| Copy link | palette / Share button | palette / Share button | G | no key (avoid browser clashes) |
| Present | Cmd+Alt+P | Ctrl+Alt+P | C | none known |
| Next / previous frame (Present) | Right, Down, Space / Left, Up | same | Present | Space scrolls: preventDefault |
| Print | Cmd+P | Ctrl+P | C | native print: we replace it with SHARE-13 |
| Save page / find | not used | not used | - | Cmd/Ctrl+S, Cmd/Ctrl+F stay native |
| Close tab / new tab / window / quit | not used | not used | - | cannot be prevented (Cmd/Ctrl+W, T, N, Q); never bind |
| Panic reset (demo mode only) | Cmd+Shift+Backspace | Ctrl+Shift+Backspace | G | only with `?demo=1` |

## Open questions
1. Default theme: should the board default to Light (stage projector, screenshots) or follow the dark dashboard? Recommended: Light default for the demo, with a Dark/System setting available (SHELL-7).
2. New dependencies: vitest (and `happy-dom` for component tests), `axe-core` (a11y check), `fuse.js` (fuzzy search). Recommended: vitest only if `dashboard/` does not already have it; hand-rolled fuzzy search; manual a11y checklist; no `happy-dom`.
3. Board JSON format and import/export API: HISTORY must provide `serializeBoard`, `parseBoard` and versioning before SHARE-9/10 ship. Recommended default: `{version:1, name, shapes, pins}` with ids stable.
4. Link semantics: the board state is local (the playground bypasses SpacetimeDB, `main.tsx:9`), so shared links restore only the view and ids, not the content. Is multi-user persistence in scope for the demo? Recommended: no; label the Share button "Copy view link" and rely on a second window of the same session for the demo.
5. Copy-as-PNG binding: Cmd+Shift+C is Chrome's inspect-element shortcut. Recommended: palette-only (and Share menu) unless testing on the demo browser shows no conflict.
6. Present shortcut and fullscreen: Cmd+Alt+P chosen to avoid conflicts; does the pitch use a real browser fullscreen or only chrome-less app mode? Recommended: real fullscreen with fallback.
7. Cmd+Shift+Backspace panic reset and `?demo=1` seed: confirm the team wants a hidden destructive key. Recommended: yes, demo mode only, with a visible undo toast.
8. View-only is a UI mode, not access control (no server). Acceptable for the demo? Recommended: yes; label it honestly in the Share dialog.
9. Telemetry: keep everything in-browser (recommended) or forward ops counts to the existing dashboard/SpacetimeDB via an adapter later?
10. Keybinding presets and rebinding (KEYS-16) are P2; confirm Figma bindings are the only preset for now. Recommended: yes.
11. Should file name and prefs sync to the URL or just localStorage? Recommended: localStorage only; the URL carries view state only.
