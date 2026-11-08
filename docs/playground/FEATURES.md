# Playground feature catalog

Every feature from the seven domain specs in `docs/playground/domains/`, once, with its work package. Priority and size are the domain author's; the work package and wave come from `TASKS.md`. Full feature text (interaction, acceptance, edge cases) stays in the domain file named in each table heading. Architecture decisions D1-D10 in `REQUIREMENTS.md` override domain text where they disagree.

Columns: **P** priority, **Size** S/M/L as estimated by the domain, **Wave** 0-3 (`-` = not packaged), **Depends on** as written in the domain spec, **Work package** = `WP-nn`, `backlog` (P1 not packaged yet) or `parking` (P2). Duplicates keep their own ID and say "same as".

## Counts

| | Total | P0 | P1 | P2 |
| --- | --- | --- | --- | --- |
| All features | 411 | 183 | 166 | 62 |
| Wave 0 | 54 | 41 | 13 | 0 |
| Wave 1 | 130 | 108 | 22 | 0 |
| Wave 2 | 37 | 30 | 7 | 0 |
| Wave 3 | 53 | 4 | 49 | 0 |
| Backlog (P1, not packaged) | 75 | 0 | 75 | 0 |
| Parking (P2) | 62 | 0 | 0 | 62 |

| Domain | Features | P0 | P1 | P2 |
| --- | --- | --- | --- | --- |
| Canvas, viewport and navigation (CANVAS) | 44 | 19 | 18 | 7 |
| Selection, transform and direct manipulation (SELECT) | 51 | 30 | 17 | 4 |
| Alignment, snapping and layout (ALIGN) | 41 | 11 | 19 | 11 |
| History, document model, clipboard, persistence (HISTORY) | 43 | 21 | 17 | 5 |
| Layers, inspector, text (LAYERS, PROPS, TEXT) | 88 | 45 | 24 | 19 |
| Multiplayer, agents, comments (MULTI, AGENT, COMMENT) | 80 | 35 | 37 | 8 |
| Keys, share, shell (KEYS, SHARE, SHELL) | 64 | 22 | 34 | 8 |

52 features are marked as duplicates or overlaps of another ID; each duplicate pair is assigned to a single work package (or both stay unpackaged).

## Today (already exists; do not rebuild, port it)

- **Board and camera** (`Playground.tsx`): dotted light board; camera `{x,y,z}` in React state with pointer-anchored Cmd/Ctrl+wheel and pinch zoom (clamped 0.08-4), wheel pan, Space/middle/Hand pan, plain empty-drag pan; Shift+1 fit, Cmd+0 reset (wrong anchor); zoom pill = fit. CSS radial-gradient dot grid (24 px, doubles below 14 px). Counter-scaled labels via `/ z`.
- **Shapes**: flat `Shape[]` (`engine.ts`) with kinds frame/rect/ellipse/text, absolute coordinates, `fill`, `color`, `text`, `fontSize`, `weight`, `radius`, `owner` (edit outline) and `author` (routing). Memoised `ShapeView`, all shapes mounted. Frame membership is geometric (`inside`, `frameOf`).
- **Selection and tools**: single selection; AABB hit-test, last-in-array wins; 4 corner handles with flip-through resize; move drags geometric children; W x H pill. Tools V F R O T C H with click-for-default-size, text placement with a textarea editor (Enter and Esc both commit), tool resets to Move after create; Delete deletes with geometric children; Esc clears.
- **Agents** (`engine.ts`): scripted cursors with eased, bent `moveTo` tweens painted in a rAF loop straight to DOM; 4 design templates (Profile card, Mobile tasks, Stat widget, Hero) built step by step with drag-to-size and per-character typing; grid slot reservation (`claimSlot`); `parseEdit` regex intents (colour, bigger/smaller, rounder, bold, delete, quoted text); per-agent inbox FIFO; pause, remove, global speed; 12 fixed names and colours.
- **Chat and comments** (`ChatPanel.tsx`, `Playground.tsx`): one thread per agent plus general; thread switcher with unread counts (count-based); composer sends on Enter; comment tool drops numbered pins anchored to a shape offset; routing = shape author, frame author, nearest agent, else random agent in general; pins resolve when the agent finishes.
- **Shell**: top bar (back, logo, title, comment options, Share = copy `location.href` with 1.6 s toast, zoom pill, avatar stack capped at 8); fixed 240 px left (chat/layers tabs) and 260 px right (cursors, speed); flat layers list (reversed, capped at 400, owner dot); `window.board` console API (`spawnAgent, addCursor, moveCursor, press, removeCursor, addShape, updateShape, shapes, cursors`).
- **Infra**: route `#/playground` in `dashboard/src/main.tsx` (query strings ignored, safe for `?v=`); vitest 3.2.7 installed at the root, `dashboard` has `"test": "vitest run"` and `test/model.test.ts`; no playground tests, no persistence, no undo, no error boundary.

## Canvas, viewport and navigation (CANVAS)

Source: `domains/canvas.md`.

| ID | Feature | P | Size | Wave | Depends on | Work package |
| --- | --- | --- | --- | --- | --- | --- |
| CANVAS-1 | Camera store and rAF-coalesced updates | P0 | M | 0 | none | WP-05 |
| CANVAS-2 | Coordinate API (screen/world, visible rect) | P0 | S | 0 | CANVAS-1 | WP-05 |
| CANVAS-3 | Wheel input classification (mouse wheel vs trackpad vs pinch) | P0 | M | 1 | CANVAS-1 | WP-31 |
| CANVAS-4 | Zoom around pointer with clamp and smooth exponent | P0 | S | 0 | CANVAS-2, CANVAS-3 | WP-05 |
| CANVAS-5 | Space-drag, middle-mouse and Hand tool panning | P0 | S | 1 | CANVAS-1 | WP-31 |
| CANVAS-6 | Plain-drag-on-empty-space policy | P1 | S | 1 | CANVAS-5, SELECT marquee | WP-17 |
| CANVAS-7 | Pan momentum (inertia) for drag-release and wheel | P2 | M | - | CANVAS-1, CANVAS-5 | parking |
| CANVAS-8 | Keyboard viewport navigation | P1 | S | - | CANVAS-1, SELECT nudge | backlog |
| CANVAS-9 | Soft pan bounds | P2 | S | - | CANVAS-10 | parking |
| CANVAS-10 | Zoom-to-fit family (Shift+1 / Shift+2 / Shift+0) | P0 | S | 1 | CANVAS-2, CANVAS-13 | WP-29 |
| CANVAS-11 | Zoom menu and percent field | P0 | M | 1 | CANVAS-4, CANVAS-10 | WP-30 |
| CANVAS-12 | Keyboard zoom (+ / - and presets) | P0 | S | 1 | CANVAS-4 | WP-29 |
| CANVAS-13 | Animated camera moves (tweens) | P0 | M | 1 | CANVAS-1, CANVAS-2 | WP-29 |
| CANVAS-14 | Zoom-aware dot grid | P0 | M | 1 | CANVAS-1 | WP-31 |
| CANVAS-15 | Counter-scaled UI helper (constant-screen-size chrome) | P1 | S | 0 | CANVAS-1, CANVAS-2 | WP-11 |
| CANVAS-16 | Stroke, text and label level of detail | P1 | M | - | CANVAS-1, CANVAS-18 | backlog |
| CANVAS-17 | Rulers | P1 | M | - | CANVAS-1, CANVAS-2, ALIGN guides | backlog |
| CANVAS-18 | Viewport culling of shapes | P0 | M | 1 | CANVAS-2, CANVAS-19 | WP-32 |
| CANVAS-19 | Spatial index | P0 | M | 0 | none | WP-06 |
| CANVAS-20 | Pixel grid | P1 | S | - | CANVAS-14, CANVAS-35 | backlog |
| CANVAS-21 | Hit testing: screen-space tolerance, topmost, shape-aware | P0 | M | 0 | CANVAS-19 | WP-06 |
| CANVAS-22 | Cursor styles per tool and state | P0 | M | 1 | SELECT handles | WP-20 |
| CANVAS-23 | Zoom tool and Z-drag marquee zoom | P2 | S | - | CANVAS-12, CANVAS-13 | parking |
| CANVAS-24 | Minimap / navigator | P1 | L | 3 | CANVAS-1, CANVAS-2, CANVAS-19 | WP-70 |
| CANVAS-25 | Scroll bars | P2 | S | - | CANVAS-1 | parking |
| CANVAS-26 | Go to layer / comment pin / cursor (jump) | P0 | M | 1 | CANVAS-13, CANVAS-2 | WP-29 |
| CANVAS-27 | Follow cursor (spotlight / observe) | P1 | M | 3 | CANVAS-13, CANVAS-26, MULTI viewport broadcast | WP-71 |
| CANVAS-28 | Agent "show me" request with consent | P2 | S | - | CANVAS-26 | parking |
| CANVAS-29 | Off-screen cursor and activity indicators | P1 | M | 3 | CANVAS-2, CANVAS-26 | WP-69 |
| CANVAS-30 | Touch gestures (iPad / phone) | P2 | M | - | CANVAS-1, CANVAS-4 | parking |
| CANVAS-31 | Safari trackpad gesture events and browser-zoom guards | P1 | S | 1 | CANVAS-3 | WP-31 |
| CANVAS-32 | HiDPI and fractional-zoom crispness | P1 | M | - | CANVAS-1, CANVAS-35 | backlog |
| CANVAS-33 | Rendering backend decision (DOM vs SVG vs Canvas2D vs WebGL) | P0 | L | 1 | CANVAS-18 | WP-32 |
| CANVAS-34 | rAF loop budget and idle throttling | P0 | M | 0 | CANVAS-1 | WP-05 |
| CANVAS-35 | Overlay canvas layer | P1 | M | - | CANVAS-1, CANVAS-32 | backlog |
| CANVAS-36 | Viewport persistence in URL hash (same as SHARE-1/2) | P1 | S | 1 | CANVAS-1, CANVAS-2 | WP-48 |
| CANVAS-37 | Viewport persistence in localStorage | P1 | S | 1 | CANVAS-36 | WP-48 |
| CANVAS-38 | Smart initial view and first-paint framing | P1 | S | 1 | CANVAS-10 | WP-29 |
| CANVAS-39 | Resize handling (ResizeObserver, panel toggles) | P0 | S | 0 | CANVAS-1, CANVAS-2 | WP-05 |
| CANVAS-40 | Snap-to-pixel for geometry and camera (same as ALIGN-7) | P1 | S | 1 | CANVAS-11 | WP-23 |
| CANVAS-41 | Presentation / focus view (hide chrome) (overlaps AGENT-17 stage mode) | P2 | M | - | CANVAS-39 | parking |
| CANVAS-42 | Cursor and overlay stress mode (50+ cursors, 5k shapes) (same as MULTI-16 stress) | P1 | M | 2 | CANVAS-18, CANVAS-34 | WP-53 |
| CANVAS-43 | Accessibility and reduced motion for navigation | P1 | S | 3 | CANVAS-13 | WP-82 |
| CANVAS-44 | Canvas debug HUD and tests | P0 | S | 1 | CANVAS-2 | WP-33 |

## Selection, transform and direct manipulation (SELECT)

Source: `domains/selection.md`.

| ID | Feature | P | Size | Wave | Depends on | Work package |
| --- | --- | --- | --- | --- | --- | --- |
| SELECT-1 | Selection model (multi-id set, primary, focus scope) | P0 | M | 0 | none (everything else builds on this); LAYERS-* must read t… | WP-09 |
| SELECT-2 | Click select with proper hit testing | P0 | M | 1 | SELECT-1, SELECT-27 (lock/hide flags), SELECT-24 (rotation)… | WP-14 |
| SELECT-3 | Shift-click add/remove | P0 | S | 1 | SELECT-1, SELECT-2 | WP-14 |
| SELECT-4 | Cmd/Ctrl-click deep select | P0 | S | 1 | SELECT-2, SELECT-3 | WP-14 |
| SELECT-5 | Click-hierarchy rules (what a plain click picks) | P0 | M | 1 | SELECT-40, SELECT-2 | WP-14 |
| SELECT-6 | Double-click to enter a container or edit text | P0 | M | 1 | SELECT-5, SELECT-9 | WP-14 |
| SELECT-7 | Hover highlight | P0 | S | 1 | SELECT-2 | WP-17 |
| SELECT-8 | Marquee (rubber-band) selection | P0 | M | 1 | SELECT-1, SELECT-5, SELECT-47 | WP-17 |
| SELECT-9 | Click vs drag disambiguation and gesture pipeline | P0 | M | 1 | SELECT-1 | WP-13 |
| SELECT-10 | Escape ladder and click-away deselect | P0 | S | 1 | SELECT-9, SELECT-26 | WP-13 |
| SELECT-11 | Select all, select siblings, select same | P1 | S | 1 | SELECT-1, SELECT-45 | WP-34 |
| SELECT-12 | Selection box (single and multi) | P0 | M | 1 | SELECT-1 | WP-15 |
| SELECT-13 | Corner resize handles | P0 | M | 1 | SELECT-12, SELECT-9 | WP-15 |
| SELECT-14 | Edge resize handles | P0 | S | 1 | SELECT-13 | WP-15 |
| SELECT-15 | Shift = proportional resize | P0 | S | 1 | SELECT-13 | WP-15 |
| SELECT-16 | Alt/Option = resize from center | P0 | S | 1 | SELECT-13 | WP-15 |
| SELECT-17 | Cmd/Ctrl = ignore snapping during drag (same as ALIGN-6) | P1 | S | 1 | ALIGN-* (snapping API), SELECT-9 | WP-23 |
| SELECT-18 | Rotation handles at corners | P1 | L | 3 | SELECT-12, SELECT-2, SELECT-40 | WP-74 |
| SELECT-19 | Shift = 15 degree rotation steps | P1 | S | 3 | SELECT-18 | WP-74 |
| SELECT-20 | Move by dragging | P0 | M | 1 | SELECT-9, SELECT-1 | WP-18 |
| SELECT-21 | Shift = axis lock while moving | P0 | S | 1 | SELECT-20 | WP-18 |
| SELECT-22 | Arrow-key nudge | P0 | S | 1 | SELECT-1; HISTORY-* for coalescing | WP-19 |
| SELECT-23 | Duplicate with Mod+D (same as HISTORY-23) | P0 | S | 1 | SELECT-1, SELECT-40 | WP-34 |
| SELECT-24 | Alt/Option-drag duplicate | P1 | M | - | SELECT-20, SELECT-23 | backlog |
| SELECT-25 | Delete and cut-delete | P0 | S | 1 | SELECT-1, SELECT-40, HISTORY-* | WP-34 |
| SELECT-26 | Escape cancels a drag mid-way | P0 | S | 1 | SELECT-9, SELECT-10 | WP-13 |
| SELECT-27 | Lock and unlock (same as LAYERS-8) | P1 | S | 2 | SELECT-40, LAYERS-* | WP-55 |
| SELECT-28 | Hide and show (same as LAYERS-8) | P1 | S | 2 | SELECT-40, LAYERS-* | WP-55 |
| SELECT-29 | Z-order shortcuts | P0 | S | 1 | SELECT-40 | WP-19 |
| SELECT-30 | Live size, position and distance readouts | P0 | M | 1 | SELECT-12 | WP-16 |
| SELECT-31 | Cursor shapes per handle and gesture (overlaps CANVAS-22) | P1 | M | 3 | SELECT-13, SELECT-14, SELECT-18 | WP-74 |
| SELECT-32 | Group and ungroup | P0 | M | 1 | SELECT-40, SELECT-5 | WP-19 |
| SELECT-33 | Frame selection (wrap in frame) | P1 | M | 1 | SELECT-32, SELECT-40 | WP-19 |
| SELECT-34 | Reparent by drag in/out of frames | P0 | M | 1 | SELECT-40, SELECT-20 | WP-18 |
| SELECT-35 | Flip horizontal / vertical | P1 | S | - | SELECT-13, SELECT-18 | backlog |
| SELECT-36 | Resizing frames with children (clip vs grow) (needs SELECT-37) | P1 | M | - | SELECT-37, SELECT-40, SELECT-13 | backlog |
| SELECT-37 | Constraints when the parent resizes | P1 | L | - | SELECT-36, SELECT-40 | backlog |
| SELECT-38 | Draw tools: click for default size, drag for sized | P0 | S | 1 | SELECT-9, SELECT-34 | WP-20 |
| SELECT-39 | Draw tool modifiers (Shift square, Alt from center) | P0 | S | 1 | SELECT-38 | WP-20 |
| SELECT-40 | Hierarchy in the document model (parentId + local coordinates) (same as HISTORY-3) | P0 | L | 0 | none (blocks 2, 5, 18, 23, 25, 29, 32, 33, 34, 36, 37) | WP-01 |
| SELECT-41 | Text tool: click to place (auto width) (same as TEXT-1) | P0 | S | 1 | SELECT-6, SELECT-34 | WP-22 |
| SELECT-42 | Text tool: drag to create a fixed-width box | P1 | S | - | SELECT-41, SELECT-39 | backlog |
| SELECT-43 | Text resize modes (same as TEXT-4) | P1 | S | 2 | SELECT-41, SELECT-14 | WP-60 |
| SELECT-44 | Line, arrow and pen tools | P2 | L | - | SELECT-40, SELECT-12 (variant), SELECT-18 | parking |
| SELECT-45 | Right-click context menu (uses SHELL-10) | P1 | M | - | SELECT-11, SELECT-27, SELECT-28, SELECT-29, SELECT-32, SELE… | backlog |
| SELECT-46 | Agent selection and command API (same operations for agents and the human) (same as AGENT-1) | P0 | L | 0 | SELECT-1, SELECT-40, HISTORY-*, MULTI-* | WP-08 |
| SELECT-47 | Spatial index and render culling for hit tests (same as CANVAS-19) | P1 | M | 0 | SELECT-40 | WP-06 |
| SELECT-48 | Vector point-edit on double-click | P2 | L | - | SELECT-44, SELECT-6 | parking |
| SELECT-49 | Image placement and drop (same as HISTORY-25) | P2 | M | - | SELECT-40, SELECT-15 | parking |
| SELECT-50 | Measurement on Alt-hover (handoff to ALIGN) (same as ALIGN-16) | P1 | S | 3 | SELECT-7, SELECT-24; ALIGN-* consumes | WP-73 |
| SELECT-51 | Selection persistence across commands and reload | P2 | S | - | SELECT-1, HISTORY-*, MULTI-* | parking |

## Alignment, snapping and layout (ALIGN)

Source: `domains/alignment.md`.

| ID | Feature | P | Size | Wave | Depends on | Work package |
| --- | --- | --- | --- | --- | --- | --- |
| ALIGN-1 | Edge and center snapping while moving | P0 | L | 1 | ALIGN-4, ALIGN-9, SELECT move gesture | WP-23 |
| ALIGN-2 | Smart guide rendering (red/pink lines) | P0 | M | 1 | ALIGN-1 | WP-24 |
| ALIGN-3 | Snapping while resizing | P0 | M | 2 | ALIGN-1, ALIGN-4, SELECT resize gesture, ALIGN-5 (edge hand… | WP-52 |
| ALIGN-4 | Snap threshold in screen pixels | P0 | S | 1 | camera `cam.z` (`Playground.tsx:45`) | WP-23 |
| ALIGN-5 | Resize handles on edges (supporting) (same as SELECT-14) | P1 | S | 1 | SELECT. Listed here because ALIGN-3 and ALIGN-23 need edge… | WP-15 |
| ALIGN-6 | Snapping toggle: hold Cmd/Ctrl and a setting | P0 | S | 1 | ALIGN-1 | WP-23 |
| ALIGN-7 | Integer position rounding | P0 | S | 1 | ALIGN-1 | WP-23 |
| ALIGN-8 | Snap to parent frame edges and center | P0 | M | 2 | ALIGN-1, ALIGN-33 | WP-52 |
| ALIGN-9 | Spatial index and candidate culling (same as CANVAS-19) | P0 | M | 0 | ALIGN-1 | WP-06 |
| ALIGN-10 | Programmatic snapping API for agents | P0 | M | 1 | ALIGN-1, ALIGN-11, ALIGN-7 | WP-24 |
| ALIGN-11 | Align toolbar (left, center, right, top, middle, bottom) | P0 | M | 1 | SELECT multi-selection, HISTORY | WP-24 |
| ALIGN-12 | Align to selection vs align to parent vs key object | P1 | S | 3 | ALIGN-11, ALIGN-33 | WP-72 |
| ALIGN-13 | Distribute horizontally and vertically | P1 | M | 3 | ALIGN-11 | WP-72 |
| ALIGN-14 | Equal-spacing detection while dragging (smart spacing guides) | P1 | L | 3 | ALIGN-1, ALIGN-15 | WP-73 |
| ALIGN-15 | Gap and distance labels | P1 | S | 3 | ALIGN-2 | WP-73 |
| ALIGN-16 | Distance measurement on Alt/Option hover | P1 | M | 3 | ALIGN-15, hit-test (`Playground.tsx:269`) | WP-73 |
| ALIGN-17 | Pixel grid snapping (same as CANVAS-40) | P1 | S | - | ALIGN-1, ALIGN-6 | backlog |
| ALIGN-18 | Visible pixel grid and dot-grid unification (same as CANVAS-20) | P2 | S | - | ALIGN-17 | parking |
| ALIGN-19 | Ruler guides: create by dragging from the rulers | P1 | M | - | none | backlog |
| ALIGN-20 | Snap to ruler guides | P1 | S | - | ALIGN-19, ALIGN-1 | backlog |
| ALIGN-21 | Make same width / same height (size matching) | P1 | S | 3 | ALIGN-11, ALIGN-3 | WP-72 |
| ALIGN-22 | Rotation snapping (15 degrees) (same as SELECT-19) | P1 | M | 3 | SELECT (rotation handle), ALIGN-34 | WP-74 |
| ALIGN-23 | Snap while creating shapes | P1 | S | 1 | ALIGN-1, ALIGN-3 | WP-20 |
| ALIGN-24 | Auto-layout creation and properties (direction, gap, padding) | P1 | L | - | ALIGN-33 (real parent/child), ALIGN-25 | backlog |
| ALIGN-25 | Sizing modes: hug, fill, fixed | P1 | M | - | ALIGN-24 | backlog |
| ALIGN-26 | Reorder by drag inside auto-layout | P1 | L | - | ALIGN-24, ALIGN-33, SELECT drag, HISTORY (single undo step) | backlog |
| ALIGN-27 | Absolute-positioned child inside auto-layout | P2 | S | - | ALIGN-24, ALIGN-28 | parking |
| ALIGN-28 | Constraints and pinning when a frame resizes (same as SELECT-37) | P1 | L | - | ALIGN-33 | backlog |
| ALIGN-29 | Tidy up | P1 | L | - | ALIGN-13, ALIGN-11 | backlog |
| ALIGN-30 | Pack | P2 | M | - | ALIGN-29 | parking |
| ALIGN-31 | Make grid | P2 | M | - | ALIGN-29 | parking |
| ALIGN-32 | Layout grids on frames (columns, rows, grid) | P2 | L | - | ALIGN-1, ALIGN-33 | parking |
| ALIGN-33 | Real parent/child relationship (`parentId`) (same as HISTORY-3) | P0 | L | 0 | LAYERS, SELECT | WP-01 |
| ALIGN-34 | Rotated and nested bounding boxes for snapping | P2 | M | - | ALIGN-22, ALIGN-33 | parking |
| ALIGN-35 | Multi-selection snapping | P1 | M | 1 | ALIGN-1, SELECT multi-selection | WP-23 |
| ALIGN-36 | Keyboard nudge with snapping rules | P1 | S | - | SELECT | backlog |
| ALIGN-37 | Snapping considers in-flight shapes of other cursors | P2 | S | - | ALIGN-9 | parking |
| ALIGN-38 | Snap indicator on the cursor and tooltips | P2 | S | - | ALIGN-2 | parking |
| ALIGN-39 | Magnetic text baseline alignment | P2 | M | - | TEXT metrics, ALIGN-1 | parking |
| ALIGN-40 | Grid-aware create-and-duplicate offset | P2 | S | - | SELECT, HISTORY | parking |
| ALIGN-41 | Multi-agent alignment review (stretch) | P2 | M | - | ALIGN-10, ALIGN-7 | parking |

## History, document model, clipboard, persistence (HISTORY)

Source: `domains/history.md`.

| ID | Feature | P | Size | Wave | Depends on | Work package |
| --- | --- | --- | --- | --- | --- | --- |
| HISTORY-1 | Document store (single source of truth outside React state) | P0 | L | 0 | HISTORY-5 | WP-03 |
| HISTORY-2 | Collision-free stable ids | P0 | S | 0 | none | WP-01 |
| HISTORY-3 | Explicit parent/child tree | P0 | L | 0 | HISTORY-1, HISTORY-4 | WP-01 |
| HISTORY-4 | Fractional z-order within a parent | P0 | M | 0 | HISTORY-3 | WP-01 |
| HISTORY-5 | Command and transaction API | P0 | M | 0 | HISTORY-1 | WP-03 |
| HISTORY-6 | Undo and redo shortcuts | P0 | M | 1 | HISTORY-5, HISTORY-10 | WP-34 |
| HISTORY-7 | Coalesce continuous gestures into one entry | P0 | M | 0 | HISTORY-5 | WP-03 |
| HISTORY-8 | Coalesce typing bursts and nudge runs | P1 | S | 0 | HISTORY-5, HISTORY-7 | WP-04 |
| HISTORY-9 | Escape cancels an in-flight gesture | P0 | S | 0 | HISTORY-7 | WP-03 |
| HISTORY-10 | Per-actor undo stacks | P0 | M | 0 | HISTORY-5 | WP-04 |
| HISTORY-11 | Undo never clobbers other actors (skip superseded fields) | P0 | M | 0 | HISTORY-10, HISTORY-35 | WP-04 |
| HISTORY-12 | Undo/redo of create and delete using tombstones | P0 | M | 0 | HISTORY-3, HISTORY-5 | WP-04 |
| HISTORY-13 | Undo of reorder and reparent | P1 | S | 0 | HISTORY-3, HISTORY-4, HISTORY-12 | WP-04 |
| HISTORY-14 | Undo of group and ungroup | P1 | S | 0 | HISTORY-3, HISTORY-27 | WP-04 |
| HISTORY-15 | Undo of property changes and selection restore | P1 | S | 0 | HISTORY-5, HISTORY-8 | WP-04 |
| HISTORY-16 | Undo/redo UI affordances | P1 | S | 3 | HISTORY-6 | WP-77 |
| HISTORY-17 | History panel (overlaps HISTORY-43) | P2 | M | - | HISTORY-5, HISTORY-34 | parking |
| HISTORY-18 | Revert an agent's action or session | P1 | M | 3 | HISTORY-11, HISTORY-17 | WP-77 |
| HISTORY-19 | Copy, cut and paste within the board | P0 | M | 1 | HISTORY-2, HISTORY-3, HISTORY-5 | WP-35 |
| HISTORY-20 | System clipboard as JSON plus text fallback | P1 | M | 3 | HISTORY-19, HISTORY-28 | WP-78 |
| HISTORY-21 | Paste at pointer vs paste in place | P0 | S | 1 | HISTORY-19 | WP-35 |
| HISTORY-22 | Paste into a frame keeping relative position | P1 | M | 3 | HISTORY-3, HISTORY-19, HISTORY-21 | WP-78 |
| HISTORY-23 | Duplicate (Cmd+D) | P0 | S | 1 | HISTORY-19 | WP-34 |
| HISTORY-24 | Paste plain text creates a text layer | P1 | S | 3 | HISTORY-19, HISTORY-27 | WP-78 |
| HISTORY-25 | Paste an image | P2 | M | - | HISTORY-19, HISTORY-31 | parking |
| HISTORY-26 | Shape names stay unique and meaningful | P1 | S | 3 | HISTORY-19 | WP-78 |
| HISTORY-27 | Shape kinds and shared fields schema | P0 | M | 0 | none | WP-01 |
| HISTORY-28 | Saved format version and migrations | P0 | S | 1 | HISTORY-27 | WP-36 |
| HISTORY-29 | Compaction and tombstone garbage collection | P2 | S | - | HISTORY-12, HISTORY-30 | parking |
| HISTORY-30 | Autosave to localStorage | P0 | M | 1 | HISTORY-1, HISTORY-27, HISTORY-28 | WP-36 |
| HISTORY-31 | Storage budget and quota handling | P1 | S | 1 | HISTORY-30 | WP-36 |
| HISTORY-32 | JSON export and import of the whole board | P1 | S | 3 | HISTORY-28, HISTORY-30 | WP-79 |
| HISTORY-33 | Named versions and snapshots | P1 | M | - | HISTORY-30, HISTORY-35 | backlog |
| HISTORY-34 | Append-only op log and replay | P1 | M | 0 | HISTORY-5, HISTORY-35, HISTORY-36 | WP-03 |
| HISTORY-35 | Conflict policy (field-level last-writer-wins, delete wins) | P0 | M | 0 | HISTORY-36 | WP-02 |
| HISTORY-36 | Idempotent op ids and remote apply | P0 | M | 0 | HISTORY-2, HISTORY-5 | WP-02 |
| HISTORY-37 | Dirty and sync indicator | P1 | S | 1 | HISTORY-30 | WP-36 |
| HISTORY-38 | Migrate engine, agents and window.board onto the command API | P0 | M | 0 | HISTORY-1, HISTORY-3, HISTORY-5 | WP-10 |
| HISTORY-39 | Keep ephemeral state out of the document | P0 | S | 0 | HISTORY-1 | WP-03 |
| HISTORY-40 | Transforms (rotation) in the model | P1 | M | 0 | HISTORY-3, HISTORY-27 | WP-01 |
| HISTORY-41 | Styles model (fills, strokes, effects) | P1 | M | 0 | HISTORY-27 | WP-01 |
| HISTORY-42 | Text content and runs (same as TEXT-17) | P2 | M | - | HISTORY-27, HISTORY-35 | parking |
| HISTORY-43 | Time-travel scrubber | P2 | M | - | HISTORY-33, HISTORY-34 | parking |

## Layers, inspector, text (LAYERS, PROPS, TEXT)

Source: `domains/layers-props-text.md`.

| ID | Feature | P | Size | Wave | Depends on | Work package |
| --- | --- | --- | --- | --- | --- | --- |
| LAYERS-1 | Nested layer tree | P0 | L | 1 | SCENE-* (parentId in the document), LAYERS-3 | WP-27 |
| LAYERS-2 | Per-kind icons | P0 | S | 1 | LAYERS-1 | WP-27 |
| LAYERS-3 | Expand and collapse | P0 | S | 1 | LAYERS-1 | WP-27 |
| LAYERS-4 | Click and range select in tree | P0 | M | 2 | SELECT-* (selection store), LAYERS-1 | WP-54 |
| LAYERS-5 | Canvas to tree selection sync | P0 | S | 2 | LAYERS-3, SELECT-* | WP-54 |
| LAYERS-6 | Tree to canvas selection sync | P0 | S | 2 | LAYERS-4 | WP-54 |
| LAYERS-7 | Rename by double-click | P0 | S | 2 | LAYERS-4 | WP-55 |
| LAYERS-8 | Lock and hide toggles | P0 | M | 2 | LAYERS-1, SELECT-* | WP-55 |
| LAYERS-9 | Scroll-into-view and reveal | P0 | S | 2 | LAYERS-3, LAYERS-20 | WP-54 |
| LAYERS-10 | Drag to reorder | P0 | L | 3 | LAYERS-1, HISTORY-* | WP-65 |
| LAYERS-11 | Drag to reparent | P0 | M | 3 | LAYERS-10, SCENE-* (coordinate conversion) | WP-65 |
| LAYERS-12 | Reorder shortcuts (same as SELECT-29) | P0 | S | 1 | LAYERS-10 | WP-19 |
| LAYERS-13 | Group, ungroup, frame wrap (same as SELECT-32 + SELECT-33) | P0 | M | 1 | LAYERS-1, HISTORY-* | WP-19 |
| LAYERS-14 | Search and filter | P1 | M | 3 | LAYERS-1, LAYERS-20 | WP-81 |
| LAYERS-15 | Context menu on rows | P1 | M | 3 | LAYERS-4, MULTI-* | WP-81 |
| LAYERS-16 | Owner and editing indicators | P0 | M | 2 | LAYERS-1, MULTI-* | WP-55 |
| LAYERS-17 | Author badge and recent activity | P1 | S | - | LAYERS-16 | backlog |
| LAYERS-18 | Row inline preview and thumbnails | P2 | M | - | LAYERS-1 | parking |
| LAYERS-19 | Text layer rows show content | P0 | S | 1 | LAYERS-7, TEXT-1 | WP-27 |
| LAYERS-20 | Virtualised list | P0 | M | 1 | LAYERS-1 | WP-28 |
| LAYERS-21 | Keyboard navigation | P1 | S | 3 | LAYERS-4 | WP-81 |
| LAYERS-22 | Multi-select drag and bulk toggles | P1 | S | - | LAYERS-8 | backlog |
| LAYERS-23 | Empty and loading states | P1 | S | - | LAYERS-1 | backlog |
| LAYERS-24 | Pages | P2 | L | - | SCENE-*, MULTI-* | parking |
| LAYERS-25 | Layer panel resize and collapse (same as SHELL-5) | P2 | S | - | LAYERS-1 | parking |
| LAYERS-26 | Layer count and selection summary | P1 | S | 3 | LAYERS-14 | WP-81 |
| LAYERS-27 | Mask and clip indicators (needs PROPS-18) | P2 | M | - | PROPS-18 | parking |
| LAYERS-28 | Duplicate and paste in tree | P1 | S | - | LAYERS-1, HISTORY-* | backlog |
| LAYERS-29 | Drag layer out to chat | P2 | S | - | MULTI-* | parking |
| LAYERS-30 | Agent selection does not hijack the panel | P0 | S | 2 | LAYERS-16 | WP-54 |
| LAYERS-31 | Component and instance rows | P2 | M | - | PROPS-25 | parking |
| PROPS-1 | Right inspector panel shell | P0 | M | 1 | LAYERS-4 | WP-25 |
| PROPS-2 | Position X/Y | P0 | S | 2 | PROPS-8 | WP-56 |
| PROPS-3 | Size W/H with lock ratio | P0 | M | 2 | PROPS-8 | WP-56 |
| PROPS-4 | Rotation field | P1 | S | 3 | PROPS-8, SELECT-* (rotate handle) | WP-75 |
| PROPS-5 | Corner radius | P0 | S | 2 | PROPS-8 | WP-56 |
| PROPS-6 | Independent corner radius | P1 | M | - | PROPS-5 | backlog |
| PROPS-7 | Number field engine | P0 | M | 1 | HISTORY-* | WP-26 |
| PROPS-8 | Arithmetic and units in number fields | P0 | S | 1 | PROPS-7 | WP-26 |
| PROPS-9 | Scrub value by dragging the label | P1 | M | - | PROPS-7 | backlog |
| PROPS-10 | Mixed values on multi-select | P0 | M | 1 | PROPS-1 | WP-25 |
| PROPS-11 | Fill: solid colour | P0 | M | 2 | PROPS-7, PROPS-12 | WP-58 |
| PROPS-12 | Colour picker popover | P0 | L | 1 | PROPS-11 | WP-49 |
| PROPS-13 | Recent and document colours | P1 | S | - | PROPS-12 | backlog |
| PROPS-14 | Eyedropper | P2 | M | - | PROPS-12 | parking |
| PROPS-15 | Gradient fills | P2 | L | - | PROPS-12 | parking |
| PROPS-16 | Stroke | P0 | M | 2 | PROPS-11 | WP-59 |
| PROPS-17 | Stroke dashes, caps, joins | P2 | M | - | PROPS-16 | parking |
| PROPS-18 | Clip content (frames) | P0 | S | 2 | LAYERS-1 | WP-56 |
| PROPS-19 | Layer opacity | P0 | S | 2 | PROPS-7 | WP-56 |
| PROPS-20 | Blend mode | P2 | S | - | PROPS-19 | parking |
| PROPS-21 | Drop shadow and inner shadow | P0 | M | 2 | PROPS-12 | WP-59 |
| PROPS-22 | Layer blur and background blur | P1 | M | - | PROPS-21 | backlog |
| PROPS-23 | Export settings per layer | P1 | M | - | SHARE-* | backlog |
| PROPS-24 | Shared colour and text styles | P1 | L | - | PROPS-11, TEXT-8 | backlog |
| PROPS-25 | Components and instances | P2 | L | - | LAYERS-31 | parking |
| PROPS-26 | Tab order and focus | P0 | S | 1 | PROPS-7 | WP-26 |
| PROPS-27 | Constraints and alignment (same as SELECT-37) | P1 | M | - | PROPS-2, HISTORY-* | backlog |
| PROPS-28 | Live agent edits update inspector | P0 | S | 1 | PROPS-7, MULTI-* | WP-25 |
| PROPS-29 | Read-only inspection of locked layers | P1 | S | - | LAYERS-8 | backlog |
| PROPS-30 | Copy and paste properties | P2 | S | - | PROPS-11 | parking |
| PROPS-31 | Inspect (dev) view | P2 | M | - | SHARE-* | parking |
| PROPS-32 | Auto layout section basics (same as ALIGN-24) | P2 | L | - | SCENE-* | parking |
| TEXT-1 | Create text with T tool | P0 | S | 1 | SELECT-* | WP-22 |
| TEXT-2 | Inline editing on double click | P0 | M | 1 | LAYERS-1 | WP-21 |
| TEXT-3 | Caret and selection behaviour | P0 | M | 1 | TEXT-2 | WP-21 |
| TEXT-4 | Resize modes: auto width, auto height, fixed | P0 | M | 2 | PROPS-3 | WP-60 |
| TEXT-5 | Font family | P0 | M | 2 | TEXT-4 | WP-57 |
| TEXT-6 | Font size and weight | P0 | S | 2 | TEXT-5 | WP-57 |
| TEXT-7 | Line height and letter spacing | P0 | S | 2 | TEXT-6 | WP-57 |
| TEXT-8 | Alignment horizontal and vertical | P0 | S | 2 | TEXT-4 | WP-57 |
| TEXT-9 | Text colour | P0 | S | 2 | PROPS-11 | WP-58 |
| TEXT-10 | Text decoration and case | P1 | S | - | TEXT-6 | backlog |
| TEXT-11 | Placeholder for empty text | P0 | S | 1 | TEXT-1 | WP-22 |
| TEXT-12 | Wrapping and measurement at any zoom | P0 | L | 1 | TEXT-4, TEXT-5 | WP-50 |
| TEXT-13 | IME composition | P1 | S | 3 | TEXT-2 | WP-76 |
| TEXT-14 | Paste as plain text | P0 | S | 1 | TEXT-2 | WP-21 |
| TEXT-15 | Human edits of agent text | P0 | S | 1 | TEXT-2, MULTI-* | WP-22 |
| TEXT-16 | Agent typing animation | P1 | M | 3 | TEXT-12 | WP-76 |
| TEXT-17 | Rich text runs | P2 | L | - | TEXT-3 | parking |
| TEXT-18 | Lists | P2 | M | - | TEXT-17 | parking |
| TEXT-19 | Text styles (part of PROPS-24) | P1 | M | - | PROPS-24 | backlog |
| TEXT-20 | Truncate and max lines | P2 | S | - | TEXT-4 | parking |
| TEXT-21 | Text overflow handling and fit | P1 | S | 3 | TEXT-4 | WP-76 |
| TEXT-22 | Typography keyboard shortcuts | P1 | S | - | TEXT-6 | backlog |
| TEXT-23 | Link and hyperlink text | P2 | S | - | TEXT-17 | parking |
| TEXT-24 | Text on a path and special glyphs | P2 | M | - | TEXT-5 | parking |
| TEXT-25 | Font fallback and loading state | P1 | S | 3 | TEXT-5, TEXT-12 | WP-76 |

## Multiplayer, agents, comments (MULTI, AGENT, COMMENT)

Source: `domains/multiplayer-agents.md`.

| ID | Feature | P | Size | Wave | Depends on | Work package |
| --- | --- | --- | --- | --- | --- | --- |
| MULTI-1 | Live cursors with name and tool-state glyph | P0 | M | 1 | MULTI-3, AGENT-8, CANVAS tool model | WP-37 |
| MULTI-2 | Remote cursor smoothing and interpolation | P0 | M | 1 | MULTI-18, MULTI-16 | WP-37 |
| MULTI-3 | Per-user colour assignment | P0 | S | 1 | MULTI-5 | WP-37 |
| MULTI-4 | Avatar stack with overflow | P1 | S | 1 | MULTI-5, AGENT-8 | WP-38 |
| MULTI-5 | Presence list with status | P0 | M | 1 | AGENT-8, MULTI-3, MULTI-16 | WP-38 |
| MULTI-6 | Selection outlines in each user's colour | P0 | M | 1 | AGENT-1 (select command), SELECT domain | WP-38 |
| MULTI-7 | Editing lock outlines | P0 | S | 1 | AGENT-1, MULTI-8 | WP-38 |
| MULTI-8 | Soft lock: two actors cannot drag the same shape | P0 | M | 1 | MULTI-7, AGENT-2, AGENT-12 | WP-39 |
| MULTI-9 | Follow a user (same as CANVAS-27) | P1 | M | 3 | MULTI-24 (viewport broadcast), MULTI-2 | WP-71 |
| MULTI-10 | Spotlight (present to everyone) (overlaps CANVAS-27) | P2 | M | - | MULTI-9 | parking |
| MULTI-11 | Viewport rectangles on the minimap (part of CANVAS-24) | P1 | M | 3 | MULTI-24, CANVAS minimap | WP-70 |
| MULTI-12 | Idle and away fading | P1 | S | - | MULTI-18 | backlog |
| MULTI-13 | Cursor chat (type while holding /) | P1 | M | - | MULTI-18, MULTI-1 | backlog |
| MULTI-14 | Join and leave toasts | P1 | S | 1 | MULTI-18 | WP-38 |
| MULTI-15 | Observer mode | P1 | S | - | MULTI-18, AGENT-3 | backlog |
| MULTI-16 | Scale to 50+ cursors (and 200 agents) | P0 | L | 2 | MULTI-2, MULTI-22 | WP-53 |
| MULTI-17 | Offscreen cursor indicators (same as CANVAS-29) | P1 | M | 3 | AGENT-20, MULTI-1 | WP-69 |
| MULTI-18 | Ephemeral presence channel | P0 | M | 0 | none | WP-09 |
| MULTI-19 | Actor identity, naming and rename | P1 | S | - | MULTI-5 | backlog |
| MULTI-20 | Cursor reactions and quick emotes | P2 | S | - | MULTI-13 | parking |
| MULTI-21 | Pointer privacy and hide-my-cursor | P2 | S | - | MULTI-18 | parking |
| MULTI-22 | Cursor tag declutter | P1 | M | 2 | MULTI-16 | WP-53 |
| MULTI-23 | Multi-human collaboration over SpacetimeDB | P2 | L | - | AGENT-1, MULTI-18 | parking |
| MULTI-24 | Viewport broadcast | P1 | S | 3 | MULTI-18 | WP-71 |
| AGENT-1 | Command protocol (replaces ad-hoc window.board) | P0 | L | 0 | none (everything else builds on it) | WP-08 |
| AGENT-2 | Idempotent op ids and ordering (same as HISTORY-36) | P0 | M | 0 | AGENT-1 | WP-02 |
| AGENT-3 | Actor ids and capabilities | P0 | S | 0 | AGENT-1 | WP-09 |
| AGENT-4 | Batching and transactions | P1 | M | 0 | AGENT-1 | WP-08 |
| AGENT-5 | Event stream and subscriptions | P0 | M | 0 | AGENT-1, AGENT-2 | WP-09 |
| AGENT-6 | AgentDriver interface (scripted and LLM interchangeable) | P0 | L | 0 | AGENT-1, AGENT-5, AGENT-23 | WP-10 |
| AGENT-7 | Agent lifecycle (spawn, stop, remove, restart) | P0 | M | 1 | AGENT-6, AGENT-12 | WP-41 |
| AGENT-8 | Status state machine | P0 | M | 1 | AGENT-6 | WP-41 |
| AGENT-9 | Task and inbox queue (priority, cancel) | P0 | M | 1 | AGENT-5, AGENT-8 | WP-41 |
| AGENT-10 | Ask before destructive | P1 | M | - | AGENT-1, COMMENT-13 | backlog |
| AGENT-11 | Agent claims on regions and frames | P0 | L | 1 | AGENT-1, AGENT-5 | WP-40 |
| AGENT-12 | Soft locks as a protocol feature (same as MULTI-8) | P0 | M | 1 | AGENT-1, MULTI-8 | WP-39 |
| AGENT-13 | Conflict detection and coordinator view | P1 | L | 3 | AGENT-11, AGENT-12, COMMENT-12 | WP-68 |
| AGENT-14 | Coordinator view: who is working on what | P1 | M | - | AGENT-9, AGENT-11, MULTI-5 | backlog |
| AGENT-15 | Pause, resume, stop one or all; kill switch | P0 | S | 1 | AGENT-7, AGENT-8 | WP-41 |
| AGENT-16 | Speed control | P0 | S | 1 | AGENT-23 | WP-41 |
| AGENT-17 | Demo script mode (the stage run) | P0 | L | 3 | AGENT-1, AGENT-6, AGENT-15, AGENT-16 | WP-66 |
| AGENT-18 | Error states and degraded modes | P1 | M | - | AGENT-7, AGENT-8, COMMENT-12 | backlog |
| AGENT-19 | Observability: tokens, cost, latency | P1 | M | 3 | AGENT-6, packages/llm | WP-83 |
| AGENT-20 | Jump to agent and find-the-agent | P0 | S | 1 | MULTI-9, MULTI-17 | WP-38 |
| AGENT-21 | Agent perception API | P1 | M | 3 | AGENT-1 | WP-83 |
| AGENT-22 | Agent personas and roles | P1 | S | - | MULTI-19, COMMENT-9 | backlog |
| AGENT-23 | Choreographer (intent to cursor motion) | P0 | M | 0 | AGENT-1 | WP-10 |
| AGENT-24 | Per-actor undo needs from this domain (same as HISTORY-10/11) | P1 | M | 0 | AGENT-1, HISTORY | WP-04 |
| AGENT-25 | Agent-to-agent messaging and handoff | P1 | M | - | AGENT-5, COMMENT-1 | backlog |
| AGENT-26 | Replay and scrub of an agent's actions (overlaps HISTORY-43) | P2 | L | - | AGENT-1, AGENT-2 | parking |
| AGENT-27 | Headless protocol harness and tests | P1 | M | 0 | AGENT-1, AGENT-17 | WP-10 |
| AGENT-28 | LLM agent adapter via packages/llm | P1 | L | 3 | AGENT-6, AGENT-19, AGENT-21, AGENT-23 | WP-83 |
| AGENT-29 | Takeover and human override | P1 | S | 1 | MULTI-8, AGENT-15 | WP-39 |
| AGENT-30 | Agent capabilities and scope limits | P1 | S | - | AGENT-3, AGENT-10 | backlog |
| COMMENT-1 | Chat per agent plus general channel | P0 | M | 1 | AGENT-7, COMMENT-6 | WP-42 |
| COMMENT-2 | Comment pins anchored to layers | P0 | M | 1 | CANVAS shape transforms | WP-43 |
| COMMENT-3 | Comment pins on canvas points | P0 | S | 1 | COMMENT-2 | WP-43 |
| COMMENT-4 | Threads with replies; resolve and reopen | P0 | M | 1 | AGENT-5, COMMENT-2 | WP-43 |
| COMMENT-5 | Pins when the layer is deleted | P0 | S | 1 | COMMENT-2, AGENT-24 | WP-43 |
| COMMENT-6 | Unread badges | P0 | M | 2 | COMMENT-1 | WP-62 |
| COMMENT-7 | Comment list and sidebar with filters | P1 | M | 3 | COMMENT-4 | WP-80 |
| COMMENT-8 | Mentions routing (@Iris) | P0 | M | 2 | MULTI-19, AGENT-9 | WP-63 |
| COMMENT-9 | Routing policy (who gets a note without a mention) | P0 | M | 2 | AGENT-11, AGENT-22 | WP-63 |
| COMMENT-10 | Pins moving with layers; re-anchor | P1 | S | 3 | COMMENT-2 | WP-80 |
| COMMENT-11 | Message types | P0 | M | 1 | AGENT-1 | WP-42 |
| COMMENT-12 | Action cards with Undo | P0 | M | 2 | AGENT-1, AGENT-24, COMMENT-11 | WP-61 |
| COMMENT-13 | Proposals needing approval | P1 | M | - | COMMENT-11, AGENT-10 | backlog |
| COMMENT-14 | Rich context chips | P1 | M | - | COMMENT-11, SELECT | backlog |
| COMMENT-15 | Typing indicators | P1 | S | - | MULTI-18 | backlog |
| COMMENT-16 | Agent "thinking" placeholder and streaming | P0 | M | 2 | AGENT-8, AGENT-9, COMMENT-11 | WP-61 |
| COMMENT-17 | Keyboard focus flow between board and chat | P1 | M | - | COMMENT-14, SELECT | backlog |
| COMMENT-18 | Hover preview of comments | P1 | S | 3 | COMMENT-2 | WP-80 |
| COMMENT-19 | Pin clustering and decluttering | P1 | M | - | COMMENT-2, COMMENT-6 | backlog |
| COMMENT-20 | Persistence of threads and messages (persisted via HISTORY-30 extras) | P1 | M | 2 | AGENT-1 | WP-63 |
| COMMENT-21 | Composer behaviour | P1 | S | - | COMMENT-1, AGENT-15 | backlog |
| COMMENT-22 | Accessibility of the chat and pins | P1 | M | - | COMMENT-1, COMMENT-11 | backlog |
| COMMENT-23 | Reactions on messages and comments | P2 | S | - | COMMENT-11 | parking |
| COMMENT-24 | Message search | P2 | M | - | COMMENT-20 | parking |
| COMMENT-25 | Export transcript | P2 | S | - | COMMENT-20 | parking |
| COMMENT-26 | Agent attention requests (notify the human) | P1 | S | - | AGENT-8, COMMENT-13 | backlog |

## Keys, share, shell (KEYS, SHARE, SHELL)

Source: `domains/keys-share-shell.md`.

| ID | Feature | P | Size | Wave | Depends on | Work package |
| --- | --- | --- | --- | --- | --- | --- |
| KEYS-1 | Shortcut registry (single source of truth) | P0 | M | 0 | none. Everyone else depends on it | WP-07 |
| KEYS-2 | Global key dispatcher and focus-context guard | P0 | M | 0 | KEYS-1 | WP-07 |
| KEYS-3 | Tool shortcuts (full map) | P0 | S | 1 | KEYS-1, CANVAS tool set | WP-20 |
| KEYS-4 | Edit shortcuts | P0 | M | 1 | KEYS-1, KEYS-2, SELECT, HISTORY | WP-34 |
| KEYS-5 | View shortcuts (same as CANVAS-10/12) | P0 | S | 1 | KEYS-1, CANVAS camera API | WP-29 |
| KEYS-6 | Browser shortcut conflict prevention | P0 | S | 0 | KEYS-1, KEYS-2 | WP-07 |
| KEYS-7 | Momentary and sticky modifiers | P1 | M | - | KEYS-2, CANVAS pan, SELECT modifiers | backlog |
| KEYS-8 | Shortcut cheat sheet overlay | P1 | M | 3 | KEYS-1, SHELL-6 | WP-82 |
| KEYS-9 | Command palette | P0 | M | 1 | KEYS-1, KEYS-2 | WP-47 |
| KEYS-10 | Fuzzy search | P1 | S | 1 | KEYS-9 | WP-47 |
| KEYS-11 | Recents and frecency | P2 | S | - | KEYS-9, SHELL-29 | parking |
| KEYS-12 | Selection-aware palette actions | P1 | M | - | KEYS-9, SELECT, SHARE-4, MULTI comment routing | backlog |
| KEYS-13 | / quick actions menu | P1 | M | - | KEYS-9, SHELL-10 | backlog |
| KEYS-14 | Arrange and layer shortcuts (same as SELECT-29/32 shortcuts) | P1 | S | 1 | KEYS-1, SELECT | WP-19 |
| KEYS-15 | Agent and chat commands | P1 | S | - | KEYS-1, MULTI chat/agents | backlog |
| KEYS-16 | Keybinding overrides | P2 | M | - | KEYS-1, SHELL-14 | parking |
| KEYS-17 | Chorded shortcuts (G then ...) | P2 | S | - | KEYS-1, KEYS-2 | parking |
| KEYS-18 | Non-US layouts, IME and key repeat | P1 | S | 0 | KEYS-1 | WP-07 |
| SHARE-1 | Copy link with viewport and selection | P0 | M | 1 | SHARE-2, CANVAS camera, SELECT | WP-48 |
| SHARE-2 | Parse view state from URL | P0 | S | 1 | CANVAS camera | WP-48 |
| SHARE-3 | View-only mode | P1 | M | - | KEYS-1 (`needs`/`when` predicates), SHELL-24 | backlog |
| SHARE-4 | Export selection or frame as PNG | P0 | L | 1 | SELECT bounds, CANVAS shape model, SHARE-5 | WP-51 |
| SHARE-5 | Scale and format options (1x/2x/3x, devicePixelRatio aware) | P1 | S | 2 | SHARE-4 | WP-64 |
| SHARE-6 | Export as SVG | P1 | M | - | SHARE-4 (shared bounds helper), CANVAS shape model | backlog |
| SHARE-7 | Copy as PNG to clipboard | P1 | S | - | SHARE-4, KEYS-6 | backlog |
| SHARE-8 | Copy as SVG / copy as text | P2 | S | - | SHARE-6 | parking |
| SHARE-9 | Export whole board as JSON (same as HISTORY-32) | P1 | M | 3 | HISTORY serializer (open handoff), SHELL-2 | WP-79 |
| SHARE-10 | Import board JSON (same as HISTORY-32) | P1 | M | 3 | SHARE-9, HISTORY | WP-79 |
| SHARE-11 | Present mode | P1 | L | 3 | CANVAS camera animation, SHELL-4, SHELL-17 | WP-84 |
| SHARE-12 | Frame embed / pitch image | P1 | S | - | SHARE-3, SHARE-4, SHELL-12 | backlog |
| SHARE-13 | Print | P2 | S | - | SHARE-6 | parking |
| SHARE-14 | Share menu and dialog | P1 | M | - | SHARE-1, SHARE-3, SHELL-9 | backlog |
| SHARE-15 | Follow link to an agent or layer (same as CANVAS-36 follow param) | P2 | S | - | SHARE-2, MULTI cursor ids | parking |
| SHELL-1 | Top bar structure | P0 | M | 1 | SHELL-6, SHELL-11 | WP-44 |
| SHELL-2 | Editable file name | P1 | S | 1 | KEYS-2, SHELL-29 | WP-44 |
| SHELL-3 | Zoom menu (same as CANVAS-11) | P0 | S | 1 | KEYS-5, SHELL-10 | WP-30 |
| SHELL-4 | Collapsible panels (Cmd+\ and Cmd+.) | P0 | M | 1 | KEYS-1, SHELL-29, SHELL-5 | WP-44 |
| SHELL-5 | Resizable panel widths (persisted) | P1 | M | - | SHELL-29 | backlog |
| SHELL-6 | Theme tokens | P0 | M | 0 | none | WP-12 |
| SHELL-7 | Dark mode (decision: board chrome follows theme, canvas background follows theme, shapes unchanged) | P1 | M | - | SHELL-6, SHELL-14 | backlog |
| SHELL-8 | Responsive breakpoints | P1 | M | - | SHELL-4, SHELL-6 | backlog |
| SHELL-9 | Toasts and notifications pattern | P0 | M | 1 | SHELL-6 | WP-45 |
| SHELL-10 | Context menus pattern | P0 | M | 1 | KEYS-1, SHELL-6 | WP-46 |
| SHELL-11 | Tooltips with shortcut hints | P1 | S | 3 | KEYS-1, SHELL-6 | WP-82 |
| SHELL-12 | Empty states | P1 | S | - | SHELL-6 | backlog |
| SHELL-13 | First-run onboarding hints | P1 | M | - | SHELL-9, SHELL-29, SHELL-24 | backlog |
| SHELL-14 | Settings panel | P1 | M | - | SHELL-29, KEYS-1 | backlog |
| SHELL-15 | Keyboard-only operation | P1 | M | - | KEYS-2, SHELL-10, SELECT arrows | backlog |
| SHELL-16 | Screen-reader labels and a11y baseline | P1 | M | - | SHELL-6, SHELL-15 | backlog |
| SHELL-17 | Reduced motion (same as CANVAS-43) | P1 | S | 3 | SHELL-6, SHELL-14 | WP-82 |
| SHELL-18 | Error boundaries | P0 | M | 1 | SHELL-9, SHELL-21 | WP-45 |
| SHELL-19 | Performance budget and how to measure it | P0 | M | 1 | CANVAS render strategy (virtualize/cull shapes offscreen),… | WP-33 |
| SHELL-20 | FPS and perf HUD (same as CANVAS-44 HUD) | P1 | S | 1 | SHELL-14 | WP-33 |
| SHELL-21 | Telemetry hooks (ops per agent) | P1 | M | - | MULTI op bus, SHELL-14 | backlog |
| SHELL-22 | Unit test strategy (vitest, pure engine functions) | P0 | M | 0 | engine and geometry kept free of React imports | WP-01 |
| SHELL-23 | Browser smoke check (no Playwright) | P1 | M | - | SHELL-22, KEYS-9, SHARE-1 | backlog |
| SHELL-24 | Feature flags | P0 | S | 0 | SHELL-29 | WP-07 |
| SHELL-25 | Demo script and stage checklist | P0 | M | 3 | SHELL-26, SHARE-11, SHELL-21 | WP-67 |
| SHELL-26 | Demo mode, seed and reset | P1 | S | 3 | HISTORY format, SHELL-24 | WP-67 |
| SHELL-27 | Menus (File, Edit, View, Help) | P1 | M | - | KEYS-1, SHELL-10 | backlog |
| SHELL-28 | Confirm dialog and modal pattern | P1 | S | 1 | SHELL-6 | WP-46 |
| SHELL-29 | Prefs store (persisted settings) | P0 | S | 0 | none | WP-07 |
| SHELL-30 | Presence popover and avatar overflow (same as MULTI-4) | P2 | S | - | SHELL-10, MULTI cursors | parking |
| SHELL-31 | Comment shortcut in top bar and notifications | P2 | S | - | SHELL-9, MULTI comments | parking |

