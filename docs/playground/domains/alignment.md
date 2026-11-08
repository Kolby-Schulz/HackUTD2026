# Alignment, snapping, smart guides and layout

Scope: everything that makes shapes line up. Snapping of edges/centers while moving, resizing, creating and rotating; the pink/red smart guides and gap labels; snap to parent, pixel grid and ruler guides; distance measurement; the align/distribute/tidy/pack/grid commands; auto-layout, constraints and layout grids; integer rounding; and the spatial index that keeps all of it fast. It does NOT own the move/resize/marquee gesture mechanics (SELECT: this domain plugs a `snap()` call into those gestures), undo/redo (HISTORY: every command here must be one undo step), the property-panel UI chrome (INSPECTOR, if it exists; this domain only specifies which fields it needs), or text editing/typography (TEXT).

## Today

- No snapping of any kind. Move is a raw delta: `dx = p.x - d.px` applied to every grouped shape (`Playground.tsx:343-346`). Resize rebuilds the rect from the anchor corner and the raw pointer via `norm()` (`Playground.tsx:344-350`, `norm` at `:36`). Create uses the same `norm` (`:341`). No threshold, no modifier handling (shift, alt, cmd) in any of them.
- Positions are floats. World coordinates come from `toWorld()` and are stored unrounded (`Playground.tsx:341-346`); only the display rounds (`{Math.round(s.w)} × {Math.round(s.h)}`, `:636`). Scripted agents round selectively (`engine.ts:340`, `Math.round((CELL_W - tpl.w)/2)`).
- No parent/child relationship. `Shape` is flat: `id, kind, name, x, y, w, h, fill, ...` with no `parentId`, `rotation`, `layout` or `constraints` (`engine.ts:8-25`). "Inside a frame" is computed geometrically: `inside(a, b)` (`Playground.tsx:37`), and dragging a frame drags every shape geometrically inside it (`:314-317`). A shape dragged out of a frame silently stops belonging to it.
- Only 4 resize handles (corners `nw/ne/sw/se`, `:633`); no edge handles, no rotation, no multi-selection (`selected: string | null`, `:47`).
- The only grid is decorative: a CSS radial-gradient dot background, `DOT_GAP = 24` world units, thinned by doubling when `dot < 14px` (`Playground.tsx:22, 391-392, 453`; `playground.css:74-75`). It is not snappable and does not follow the 8/10 px grid a designer expects.
- Selection chrome uses `--pg-sel: #0d99ff` (`playground.css:9, 85-87`) and the world layer is a single CSS-transformed div (`Playground.tsx:460`), so overlay elements are sized `n / cam.z` to stay constant on screen (e.g. `:473-474`). The same trick works for guides.
- Agents place shapes programmatically (`addShape`, `patch`, `drag` at `engine.ts:281-288`) with computed coordinates and never consult each other's geometry, so agent output only lines up by template convention (`COLS`, `CELL_W`, `engine.ts:340`).
- There is no align toolbar, no distribute, no rulers, no guides, no layout grids, no auto-layout, no constraints, no measurement.

## Features

### ALIGN-1: Edge and center snapping while moving
- Priority: P0
- Size: L
- Interaction: While dragging one or more shapes, the moving selection's bounding box exposes 3 x-targets (left, center, right) and 3 y-targets (top, middle, bottom). Each is compared against the same 3+3 lines of every candidate (see ALIGN-9). If the smallest absolute difference on an axis is within the threshold (ALIGN-4), the whole selection is nudged by that difference so the lines coincide. Axes snap independently, so a shape can snap in x while moving freely in y. Ties go to the closest candidate; a persistent hysteresis of +2 screen px prevents flicker at the boundary (once snapped, you must pull 2 px past the threshold to release). Releasing the pointer commits the snapped position.
- Acceptance: Dragging a rect so its left edge is within 5 screen px of another rect's left edge makes the edges coincide exactly (differ by 0 world units). Center-to-center and edge-to-opposite-edge (left to right) also snap. Moving the pointer 1 px at a time across the boundary does not flicker. Snapping works in x and y independently.
- Edge cases: Zoomed to 10%, 5 screen px is 50 world units, still fine. Moving a frame together with its geometric children excludes those children as candidates. Ellipses snap on their bounding box, not the curve. Zero-size shapes mid-create must not become candidates.
- Depends on: ALIGN-4, ALIGN-9, SELECT move gesture.
- Multi-agent note: Another cursor's shape that is currently being dragged is still a candidate at its live position (it is just a shape), but see ALIGN-37 for the option to ignore in-flight shapes.

### ALIGN-2: Smart guide rendering (red/pink lines)
- Priority: P0
- Size: M
- Interaction: Each active snap draws a 1 px line in Figma red-pink `#F24822` (CSS var `--pg-guide`), constant on-screen width (`1 / cam.z` world units). The line spans from the minimum to the maximum extent of the moving box and all shapes that share that line, extended by 0 px (it ends exactly at the outermost edge, not the viewport). At each contributing point (corners of the snapped edges, or the center point for center-lines) a small 6 px `x` cross is drawn, as Figma does. Edge guides are solid; center guides are solid too (Figma distinguishes only by position). Guides appear on the first frame the snap engages, disappear on pointer-up or the instant the snap releases. Multiple simultaneous guides (x and y) all show. Guides render in a dedicated overlay layer inside `.pg-world` above shapes and below selection handles, `pointer-events: none`.
- Acceptance: While snapped, a red line connects the aligned edges with x marks at the endpoints. Line stays 1 px thick at 25% and 400% zoom. Lines vanish on pointer-up. Two axes snapping at once show two lines.
- Edge cases: Guide spanning two shapes far apart (thousands of units) must still render (clip to viewport with a 50 px margin for cost, but keep endpoints' x marks only if visible). Dark theme later: keep the same color on both themes.
- Depends on: ALIGN-1.
- Multi-agent note: Each cursor has its own transient guide set. Agent guides are shown to the human in that agent's cursor color (not red) at 60% opacity so the human can see "Iris is aligning" without confusion. Human guides are not broadcast.

### ALIGN-3: Snapping while resizing
- Priority: P0
- Size: M
- Interaction: While dragging a resize handle, only the edges that are moving are snap sources: a corner handle has one x-edge and one y-edge; an edge handle has one. Those edges snap to candidate left/center/right (x) or top/middle/bottom (y) lines. The anchor (opposite) edges never move. With Shift (aspect lock) held, snap the dominant axis and derive the other. With Alt/Option held (resize from center), both opposite edges move symmetrically and the center line itself is not a source. Smart guides (ALIGN-2) draw the same way. Dimension label (`w × h`, existing `.pg-dims`) updates with the snapped values.
- Acceptance: Dragging the east handle of a rect near another rect's right edge snaps and shows a guide; the west edge does not move. Shift-resize keeps ratio while one axis snaps. Alt-resize keeps the center fixed.
- Edge cases: Resizing past the anchor flips the shape (current `norm()` does this, `Playground.tsx:36`); snapping must work in the flipped state too. Minimum size 1 unit. Text shapes resize width only (TEXT).
- Depends on: ALIGN-1, ALIGN-4, SELECT resize gesture, ALIGN-5 (edge handles, currently only 4 corners exist at `Playground.tsx:633`).

### ALIGN-4: Snap threshold in screen pixels
- Priority: P0
- Size: S
- Interaction: Threshold is `SNAP_PX = 5` screen pixels (Figma uses about 4-5). World threshold `t = SNAP_PX / cam.z` is recomputed on every pointer-move from the live camera, never cached. A hold-to-disable modifier is ALIGN-6.
- Acceptance: At 100%, snapping engages within 5 px; at 500% within 1 world unit (still 5 screen px); at 10% within 50 world units. Zooming mid-drag (pinch/wheel) changes the threshold immediately.
- Edge cases: Hi-DPI: use CSS px, not device px. If threshold in world units would exceed half the smaller shape dimension, clamp to avoid sucking a tiny shape across a big one (clamp to `min(t, 0.25 * min(w,h))` only for center-line sources).
- Depends on: camera `cam.z` (`Playground.tsx:45`).

### ALIGN-5: Resize handles on edges (supporting)
- Priority: P1
- Size: S
- Interaction: Add the 4 edge midpoint handles (`n/e/s/w`) alongside corners, with `ns-resize`/`ew-resize` cursors. Hit zones extend 4 px beyond the visible 8 px handle (invisible padding) so they are easy to hit at low zoom.
- Acceptance: Dragging `e` changes only width. Handles stay 8 px on screen at every zoom.
- Edge cases: Shapes smaller than 3 handles wide: Figma hides midpoint handles under ~24 px; do the same.
- Depends on: SELECT. Listed here because ALIGN-3 and ALIGN-23 need edge handles.

### ALIGN-6: Snapping toggle: hold Cmd/Ctrl and a setting
- Priority: P0
- Size: S
- Interaction: Holding Cmd (macOS) / Ctrl (elsewhere) during a drag suspends all snapping (smart guides, grid, ruler guides); releasing re-enables it live without ending the drag. A global switch lives in the View menu / settings popover: "Snap to objects", "Snap to pixel grid", "Snap to guides", "Show spacing", each a checkbox; shortcut Cmd/Ctrl+Shift+; toggles all (Figma: Show/hide layout guides is Ctrl+G; Snap-related shortcut there is Cmd+Shift+;). State persists in `localStorage` key `pg.snap`.
- Acceptance: Holding Cmd mid-drag removes guides and the shape follows the pointer 1:1; releasing Cmd re-snaps. Unchecking "Snap to objects" disables guides for all drags until rechecked. Setting survives reload.
- Edge cases: Ctrl+click on macOS is a context click; use `metaKey` on mac, `ctrlKey` elsewhere. Key held before the drag starts also counts. Cmd held while Cmd+scroll zoom is unrelated.
- Depends on: ALIGN-1.

### ALIGN-7: Integer position rounding
- Priority: P0
- Size: S
- Interaction: Every committed `x, y, w, h` is rounded to integers at pointer-up (and during drag for display) unless the setting "Allow fractional positions" is on (default off). Shapes created by tools (frame/rect/ellipse/text) and agent commands also round. Snapping to another shape that has a fractional edge moves toward that edge but the result is rounded; the guide uses the rounded geometry. Resizing from the left/top keeps the right/bottom edge exactly fixed after rounding.
- Acceptance: After a drag with a mouse, inspector/layer data shows integer x, y, w, h. Rotation by non-90 degrees may produce fractional bounding boxes, but x/y/w/h themselves stay integers. Importing or agent creation rounds too.
- Edge cases: Zoomed in beyond 800% you may legitimately want 0.5 units: rounding step becomes `1 / floor(cam.z)`-ish only when the "fractional" setting is on. Never round during a drag in a way that makes the shape jitter against the pointer (round the committed value, keep an unrounded pointer offset).
- Depends on: ALIGN-1.
- Multi-agent note: Rounding happens in the shared `commit` helper (see architecture) so agents get it for free; `patch()` from raw agent code does not round unless it goes through `commit`.

### ALIGN-8: Snap to parent frame edges and center
- Priority: P0
- Size: M
- Interaction: When the dragged shape lies inside a frame (parent), the frame's own left/center/right and top/middle/bottom are candidates in addition to siblings. Additionally, "inside padding" targets: the frame's edge inset (`0`, and any frame padding from ALIGN-24) are shown. Guides to the parent draw with the same pink style; a parent-center guide spans the full frame height/width (Figma draws it to the frame edges).
- Acceptance: Drag a rect inside a frame near the frame's horizontal center: it snaps and a red vertical line spans the frame's full height. Near the frame's left edge: snaps flush (x = frame.x).
- Edge cases: With geometric containment (no `parentId` yet, see Today) the "parent" is the smallest frame fully containing the moving box at drag start; define explicitly in ALIGN-33. Nested frames: only the immediate parent plus siblings, not the grandparent. A shape larger than the frame has no parent.
- Depends on: ALIGN-1, ALIGN-33.

### ALIGN-9: Spatial index and candidate culling
- Priority: P0
- Size: M
- Interaction: Not user-visible. Maintain a uniform-grid (or sorted-array) index of shape edge/center lines, rebuilt incrementally on shape commit. A drag only queries candidates whose bounding box lies within the viewport expanded by one threshold, and within the moving box's own parent when inside an auto-layout frame. Cap at 2,000 considered candidates per query, nearest first. Per-pointermove budget: under 1 ms for 5,000 shapes.
- Acceptance: With 5,000 shapes on the board, a drag stays at 60 fps (verified by a dev perf counter). Snapping results are identical to a brute-force reference within the viewport. Shapes far outside the viewport never produce guides.
- Edge cases: Drag auto-pans (if SELECT adds edge-scroll): viewport changes each frame; refresh the query region. Shapes hidden/locked (LAYERS): hidden are excluded, locked stay as candidates.
- Depends on: ALIGN-1.

### ALIGN-10: Programmatic snapping API for agents
- Priority: P0
- Size: M
- Interaction: Expose pure functions in a new `snap.ts` (no React): `snapMove(box, shapes, opts) -> {dx, dy, guides}` and `snapResize(...)`. The engine's agent helpers (`drag`, `addShape`/`patch`, `build`, `engine.ts:281-325`) can call `snapMove` with a tight threshold (2 world units) so scripted agents' output lines up like a human's, and `window.board.align(ids, 'left')` etc. mirror the toolbar (ALIGN-11). Agents emit guides into their own cursor so humans see them.
- Acceptance: An agent that builds a card inside a frame ends with edges flush to the frame padding, no manual coordinates. `board.align([a,b],'top')` aligns tops identically to the toolbar.
- Edge cases: Agents have no screen pixels; they use world-unit thresholds and ignore zoom.
- Depends on: ALIGN-1, ALIGN-11, ALIGN-7.
- Multi-agent note: This is the core multi-agent value: agents produce aligned results by default.

### ALIGN-11: Align toolbar (left, center, right, top, middle, bottom)
- Priority: P0
- Size: M
- Interaction: A 6-icon group appears in the top of the properties panel (and as a floating contextual bar when 2+ shapes are selected) whenever one or more shapes are selected. Click aligns the selection. Targets: with 2+ shapes, align to the selection's bounding box (leftmost left edge, rightmost right edge, etc.); with exactly 1 shape, align to its parent frame (or the board if it has none, which is a no-op; button disabled with tooltip "Select 2+ layers or a layer inside a frame"). Shortcuts (Figma): Alt+A left, Alt+D right, Alt+W top, Alt+S bottom, Alt+H center horizontally, Alt+V center vertically. Each click is a single undo step and animates 120 ms ease-out (shapes glide), skipped under reduced-motion.
- Acceptance: Select three rects, click "Align left": all three have `x == min(x)`. Select one rect in a frame, click "Align horizontal center": it is centered in the frame. One undo step restores positions.
- Edge cases: Mixed frames and children: align only the top-level members of the selection (don't move a child that is also moving with its selected parent). Locked shapes are skipped. Rotated shapes align by rotated bounding box.
- Depends on: SELECT multi-selection, HISTORY.
- Multi-agent note: If another cursor holds a shape (`owner` set, `engine.ts:17`), skip it and toast "Iris is editing Card"; do not partially align.

### ALIGN-12: Align to selection vs align to parent vs key object
- Priority: P1
- Size: S
- Interaction: A small toggle in the align group: "Selection" (default for 2+) and "Parent". With "Parent", each selected shape aligns independently to its own parent's edges (Figma's behavior for a single selection). Holding Alt while clicking an align button aligns relative to the first-selected "key object" (Sketch/Adobe style) instead of the group bounds; the key object gets a bold outline during the hover.
- Acceptance: With 3 shapes in a frame and "Parent" mode, "Align right" puts all three flush to the frame's right edge.
- Edge cases: Mixed parents: each uses its own parent.
- Depends on: ALIGN-11, ALIGN-33.

### ALIGN-13: Distribute horizontally and vertically
- Priority: P1
- Size: M
- Interaction: With 3+ shapes selected, "Distribute horizontal spacing" and "Distribute vertical spacing" (Alt+Ctrl+H / Alt+Ctrl+V in Figma) make the gaps between consecutive shapes equal while the first and last stay put. Order is by x (or y) of centers. If shapes overlap, gaps may be negative; still equalize. Disabled with <3 shapes (tooltip). A second option "Distribute centers" spaces shape centers evenly.
- Acceptance: Three rects of different widths at x=0, 50, 400 become equal gaps between right edge of one and left edge of the next; outer two do not move.
- Edge cases: Shapes in different parents; do it in absolute coordinates only if same parent, otherwise toast "Select layers in the same frame".
- Depends on: ALIGN-11.

### ALIGN-14: Equal-spacing detection while dragging (smart spacing guides)
- Priority: P1
- Size: L
- Interaction: While moving, if the gap between the moving box and a neighbor equals an existing gap between two other shapes in the same row/column (within the threshold), snap so they match. Show the matching gaps as red/pink bars: a 1 px bracket (`|-|`) across each gap with end ticks, colored `--pg-guide`, and a label with the gap value centered on it (ALIGN-15). Both existing and the new gap are marked, so you see every equal pair. Works for the case "between" (moving box sits in the middle of A and B so gaps are equal) and "extend" (moving box continues an existing rhythm to the left/right/above/below). Only shapes whose perpendicular ranges overlap the moving box (within a tolerance of its height/width) count as neighbors.
- Acceptance: Three rects in a row with 24 gaps; drag a 4th near the right: it snaps to a 24 gap and brackets with "24" show on all three gaps. Dragging a rect between two others snaps to the exact midpoint with two equal "n" labels.
- Edge cases: Many shapes in a row (cap marking at 8 pairs to avoid noise). Gap is 0 (touching): show a pink bar of 0 width as a line, label "0". Negative gap (overlap) never snaps.
- Depends on: ALIGN-1, ALIGN-15.

### ALIGN-15: Gap and distance labels
- Priority: P1
- Size: S
- Interaction: A label is a small rounded rectangle, fill `#F24822`, white 10 px/600 tabular-nums text, 2 x 5 px padding, 3 px radius, constant on-screen size (`/ cam.z`), centered on the gap bar, offset 0. Text is the integer distance in world units, no unit suffix (`24`). Fractional values (only when sub-pixel mode is on) show 1 decimal. Labels hide when the gap is under 6 screen px wide (too cramped), in which case only the bar remains.
- Acceptance: A 40 unit gap shows `40`; zoom out to 10% and the label stays 10 px tall and is hidden when the bar becomes under 6 px.
- Edge cases: Overlapping labels: nudge vertically by 14 px.
- Depends on: ALIGN-2.

### ALIGN-16: Distance measurement on Alt/Option hover
- Priority: P1
- Size: M
- Interaction: With a selection active, holding Alt/Option and hovering another shape (or the frame/parent) draws red measurement lines between the selection and the hovered shape: an orthogonal line on each side where they do not overlap, from edge to edge, with end ticks, labelled with the distance (ALIGN-15 style). If the hovered shape contains the selection (parent), shows 4 distances to its edges. If they overlap, shows the inside distances (left, right, top, bottom offsets). The hovered shape gets a thin red `#F24822` outline. Releasing Alt removes everything. No mutation.
- Acceptance: Select A, hold Alt, hover B on the right: a horizontal red line of correct length and a label appear; moving to C updates instantly. Hovering the parent frame shows four edge distances.
- Edge cases: While also dragging, Alt means duplicate (SELECT); measurements must not show during an Alt-drag. Hover on nothing: nothing. Zoomed far out: labels hide per ALIGN-15.
- Depends on: ALIGN-15, hit-test (`Playground.tsx:269`).

### ALIGN-17: Pixel grid snapping
- Priority: P1
- Size: S
- Interaction: Setting "Snap to pixel grid" (default on) rounds the moving selection's top-left (x, y) to the nearest multiple of `gridStep` (default 1; options 1, 4, 8, 10, 16) when no object snap won. Object snaps win over grid snaps on the same axis (priority: ruler guide > object/parent > grid). No visual guide for grid snaps except the dimension label; when `gridStep >= 4` and zoom >= 400% the existing dot background aligns to the same step (see ALIGN-18).
- Acceptance: With step 8, a freely dragged rect always lands on multiples of 8 unless it snaps to an object. Disabling the setting allows any integer.
- Edge cases: Resize snaps the moving edge to the grid, not the origin. Step 1 is equivalent to integer rounding (ALIGN-7).
- Depends on: ALIGN-1, ALIGN-6.

### ALIGN-18: Visible pixel grid and dot-grid unification
- Priority: P2
- Size: S
- Interaction: At zoom >= 800%, draw a faint 1 px line grid at 1 world-unit spacing (Figma "pixel grid", toggled Shift+'). Below that the dotted background stays. The dot spacing becomes `gridStep` (ALIGN-17) instead of the hard-coded `DOT_GAP = 24` (`Playground.tsx:22`) so the dots show where you will snap; keep the doubling-thinning at `<14 px`.
- Acceptance: Zoom to 1000%: pixel lines visible; Shift+' toggles. Changing grid step to 8 changes the dots to 8 units.
- Edge cases: Dots must stay aligned to world origin, not to the camera offset.
- Depends on: ALIGN-17.

### ALIGN-19: Ruler guides: create by dragging from the rulers
- Priority: P1
- Size: M
- Interaction: Shift+R toggles rulers: a 20 px strip along the top and left of the board showing world coordinates (ticks adapt to zoom: 1/5/10/50/100... units; the label is the integer world coordinate). Dragging from a ruler creates a guide: here the guide is a 1 px line in `#F24822` spanning the whole board, with the live coordinate shown in a label near the pointer. Dropping it on the board commits; dropping it back on the ruler deletes it. Clicking a guide selects it (it turns selection blue); Delete removes it.
- Acceptance: Drag from the top ruler: a horizontal line follows the pointer, label shows y. Drop at y=100: guide persists through pan/zoom (anchored in world space). Dragging it back to the ruler removes it.
- Edge cases: Guides are board-level (or frame-level when dragged from a frame's own ruler, P2). Guides must not be selectable by marquee. Guides are not exported.
- Depends on: none.
- Multi-agent note: Guides are shared board state visible to all cursors; agents can read them via `board.guides` and snap to them (ALIGN-20).

### ALIGN-20: Snap to ruler guides
- Priority: P1
- Size: S
- Interaction: Ruler guides are candidates with the highest priority. Shape edges and centers snap to them within the same screen-pixel threshold; the guide line brightens (full opacity vs 60% idle) and an x mark appears on the snapping point. Moving a guide itself (drag) snaps to object edges (shape edges, not centers) within threshold.
- Acceptance: Drag a rect edge near a vertical guide: snaps flush, guide highlights. Cmd held disables.
- Edge cases: Guide through a locked shape still snaps. Hundreds of guides use the same index (ALIGN-9).
- Depends on: ALIGN-19, ALIGN-1.

### ALIGN-21: Make same width / same height (size matching)
- Priority: P1
- Size: S
- Interaction: With 2+ shapes selected, "Match width", "Match height", "Match size" in the align overflow menu and via the inspector's W/H multi-field. All selected adopt the dimension of the key object (first selected; fallback the largest). Resizing is from the shape's top-left (position preserved). Also: while resizing, snap the dragged edge so the resulting width/height equals a candidate's width/height; draw "equal size" markers: small `=` tick pairs on the matched dimension of both shapes in pink (Figma's size snapping).
- Acceptance: Select 3 rects, Match width: all `w` equal to the key rect's. Resize a rect until its width equals a neighbor's: snaps and shows `=` markers on both.
- Edge cases: Text shapes keep their height auto; ellipse circles stay circles only if "keep ratio" set.
- Depends on: ALIGN-11, ALIGN-3.

### ALIGN-22: Rotation snapping (15 degrees)
- Priority: P1
- Size: M
- Interaction: Rotating with the corner-outside rotate zone snaps to the nearest 15 degrees while Shift is held (Figma behaviour); without Shift it is free. A small angle label (`45°`, same pill style as ALIGN-15 but selection-blue `#0d99ff`) follows the pointer. At 0/90/180/270 a short pink tick line appears through the center. Also magnetically snap to 0/90/180/270 within 3 degrees even without Shift.
- Acceptance: Shift-rotate steps by 15 degrees; label updates; unrotated state snaps within 3 degrees.
- Edge cases: Needs a `rotation` field on `Shape` (not present, `engine.ts:8-25`). Snapping of rotated shapes' neighbors uses their rotated AABB (ALIGN-34). Resizing a rotated shape resizes in local axes; snapping then compares in world axes only for unrotated shapes (P2).
- Depends on: SELECT (rotation handle), ALIGN-34.

### ALIGN-23: Snap while creating shapes
- Priority: P1
- Size: S
- Interaction: While dragging with Frame/Rect/Ellipse/Text tools (`Playground.tsx:288-296, 341`), the starting point and the moving corner both snap to edges/centers/grid, with the same guides. Shift constrains to 1:1; Alt creates from center. Default-size click-create (`w:320,h:240` frames, `120x120` shapes, `:357`) places the shape so its top-left lands on the snapped click point.
- Acceptance: Drawing a rect from near another rect's bottom edge starts exactly on that edge; the far corner snaps to the same neighbor's right edge.
- Edge cases: First point has no moving box yet, so snap a zero-size point; once w/h > 0, snap the live corner.
- Depends on: ALIGN-1, ALIGN-3.

### ALIGN-24: Auto-layout creation and properties (direction, gap, padding)
- Priority: P1
- Size: L
- Interaction: Select a frame (or 2+ shapes: wraps them in a new frame) and press Shift+A (Figma) or the "+" in the inspector's Auto layout section. Frame gets `layout: { dir: 'row' | 'col', gap, padL, padR, padT, padB, align, justify }`. Children are positioned by the engine, not by their own `x/y`: row = laid out left to right in z/order, vertical center aligned by default. Inspector: direction toggle (right arrow / down arrow / wrap P2), gap field (scrub-able, default 10), padding (single or per-side, default 10), alignment 3x3 grid (9 dots) chooser, "Spacing mode: packed / space-between". On the canvas an auto-layout frame shows (when selected or hovered) thin pink padding handles (the padded area tinted `#F24822` at 10%) and gap handles (pink pill between children); dragging a gap/padding handle scrubs the value live with a `n` label.
- Acceptance: Add auto-layout to a frame holding 3 rects: they line up in a row with gap 10 and padding 10; changing gap to 24 updates positions live; switching to vertical re-lays out as a column; dragging the gap handle changes the gap.
- Edge cases: Empty auto-layout frame collapses to padding size (hug). Nested auto-layouts compute bottom-up (children sizes first). Changing a child's size triggers a relayout of the parent chain, throttled to one pass per animation frame.
- Depends on: ALIGN-33 (real parent/child), ALIGN-25.
- Multi-agent note: An agent may toggle auto-layout on the frame it works in; two cursors editing children of the same auto-layout frame must not fight: layout runs in one deterministic function `layout(frame, children)` so the result is order-independent.

### ALIGN-25: Sizing modes: hug, fill, fixed
- Priority: P1
- Size: M
- Interaction: Each axis of an auto-layout frame and each of its children carries a mode `fixed | hug | fill`. Hug on a frame: frame size follows the content plus padding. Fill on a child: shares leftover space with other fill siblings equally along the main axis (or stretches to the frame's cross size). Fixed: exact value. UI: two dropdown fields next to W and H ("Fixed", "Hug contents", "Fill container") shown as `1 ↔` icons. Resizing a hug frame by handle flips it to fixed. Text defaults to hug (auto width) in an auto-layout.
- Acceptance: A row frame with hug width grows when a child is added; two fill children split the remaining width equally; dragging a fixed child's handle changes only that child's size and relayouts.
- Edge cases: Fill inside hug creates a circular dependency: resolve as hug-wins and show a warning chip "Fill needs a fixed parent" (Figma disallows). Min/max sizes P2.
- Depends on: ALIGN-24.

### ALIGN-26: Reorder by drag inside auto-layout
- Priority: P1
- Size: L
- Interaction: Dragging a child of an auto-layout frame does not free-move it. As the pointer moves, the child stays under the cursor (floating at 90% opacity, lifted shadow), while an insertion indicator, a 2 px selection-blue line `#0d99ff` with round caps, appears between siblings at the nearest slot along the main axis; siblings animate (150 ms ease) to make a hole. Dropping reorders the children array (z/order) and relays out. Dragging the child out past the frame's edge by 24 px detaches it (reparent to the frame's parent, absolute position) and the frame relayouts without it. Dragging a free shape into an auto-layout frame inserts at the indicator. Holding Ctrl/Cmd while dragging a child (Figma: Ctrl) moves it as absolute positioned inside the frame (ALIGN-27).
- Acceptance: Drag the first of 3 children past the third: indicator lines show; on drop the order is 2,3,1. Drag a free rect into the row: it joins at the indicator and sizes per its mode.
- Edge cases: Wrapped layouts (P2) use a 2-D slot search. Frame grows (hug) as the guest enters: indicator must not jump.
- Depends on: ALIGN-24, ALIGN-33, SELECT drag, HISTORY (single undo step).
- Multi-agent note: If an agent is mid-reorder in the same frame, show its pending slot indicator in the agent's color; the last committed order wins.

### ALIGN-27: Absolute-positioned child inside auto-layout
- Priority: P2
- Size: S
- Interaction: Per-child toggle "Absolute position" (inspector icon). Such a child is ignored by the flow, keeps its own x/y relative to the frame, and may use constraints (ALIGN-28). It displays a small dashed outline `#F24822` corner glyph.
- Acceptance: Toggling removes the child from flow and the siblings reflow; it can then be dragged freely and snaps like a normal shape.
- Depends on: ALIGN-24, ALIGN-28.

### ALIGN-28: Constraints and pinning when a frame resizes
- Priority: P1
- Size: L
- Interaction: Each child (in a non-auto-layout frame) has `constraints: { h: 'left' | 'right' | 'leftright' | 'center' | 'scale', v: 'top' | 'bottom' | 'topbottom' | 'center' | 'scale' }`, default `left/top`. Inspector shows a small box widget with 4 pin lines and a center cross you click to toggle pins (blue when pinned). Resizing the parent by handle applies the delta: `left` keeps distance to the left edge, `right` keeps distance to the right edge, `leftright` stretches, `center` keeps the center offset, `scale` scales proportionally. Applies live during the parent resize drag (children visibly follow). Children's own constraint changes affect only future parent resizes.
- Acceptance: A frame with a button pinned bottom-right: enlarging the frame moves the button with the corner and keeps its size; a header pinned left+right stretches.
- Edge cases: Nested frames cascade. Resizing the parent from the left edge (anchor on the right) must use the delta of each edge, not the origin. Rounding via ALIGN-7 after the cascade. Snap guides while resizing the parent still work (ALIGN-3).
- Depends on: ALIGN-33.
- Multi-agent note: An agent resizing a frame gets the same behavior (resize goes through `resizeShape()` in the engine, not through `patch`).

### ALIGN-29: Tidy up
- Priority: P1
- Size: L
- Interaction: With 2+ shapes selected press Ctrl/Cmd+Alt+K (Figma's Tidy up) or the toolbar button. The algorithm detects whether the shapes form roughly a row, a column, or a grid, then re-spaces them with a uniform gap (the median existing gap, rounded to an integer, default 16) and aligns the other axis to the nearest shared line. Order follows reading order (rows by y with tolerance, then x). Positions animate 200 ms. Shapes don't overlap after tidy; an overall bounding box origin stays the same (top-left anchored).
- Acceptance: Six scattered same-size cards in a loose 3x2 become an exact 3x2 grid with equal gaps; selection top-left does not move; one undo step restores.
- Edge cases: Mixed sizes: rows use max row height, column uses max column width, items align to row top. Single shape: no-op. Very different sizes produce a toast "Nothing to tidy".
- Depends on: ALIGN-13, ALIGN-11.

### ALIGN-30: Pack
- Priority: P2
- Size: M
- Interaction: Command "Pack" removes empty space: shapes are re-placed left-to-right, wrapping rows to fit the selection's bounding box width, using the current gap (median or 16), sorted by original reading order. Result is a compact masonry-ish block. Single undo step.
- Acceptance: A scattered selection of 10 rects of mixed sizes ends within the original bbox width, no overlaps, gaps equal.
- Edge cases: One item wider than the bbox: placed alone on its row. Locked/owned shapes skipped.
- Depends on: ALIGN-29.

### ALIGN-31: Make grid
- Priority: P2
- Size: M
- Interaction: Dialog "Make grid": columns, rows (or auto), column gap, row gap, cell fit (none / stretch to cell). Places the selected shapes in reading order into cells. Preview ghost outlines in `#0d99ff` dashed while the dialog is open. Optionally creates an auto-layout wrap frame (ALIGN-24) around them when "Wrap in frame" is checked.
- Acceptance: Select 12 shapes, make grid 4 columns with 16 gap: 4x3, equal gaps, each cell aligned to its top-left.
- Edge cases: More shapes than cells: grid grows rows. Fewer: last row partial.
- Depends on: ALIGN-29.

### ALIGN-32: Layout grids on frames (columns, rows, grid)
- Priority: P2
- Size: L
- Interaction: Frame property "Layout grid" supports multiple entries: Grid (square cells, size), Columns (count, gutter, margin, type stretch/left/center/right, width), Rows. Overlay drawn on the frame in `#F24822` at 10% fill, columns shown as bands, toggled by Ctrl+G. Children snap to column edges/gutters and row lines within threshold (new candidate class, ALIGN-1), with the same pink guides. A hover tooltip on the column shows `Col 3 · 72`.
- Acceptance: A 12-column grid shows 12 bands; dragging a card snaps its left edge to a column start and its right edge to a column end.
- Edge cases: Stretch columns with fractional widths: snap to rounded edges (ALIGN-7). Grids on auto-layout frames only show.
- Depends on: ALIGN-1, ALIGN-33.

### ALIGN-33: Real parent/child relationship (`parentId`)
- Priority: P0
- Size: L
- Interaction: Replace geometric containment (`inside()`, `Playground.tsx:37, 314`) with an explicit `parentId`. A shape dropped inside a frame (pointer over frame at pointer-up, shape not larger than the frame) is reparented; the frame highlights with a 2 px selection-blue outline while it is the drop target. Moving a frame moves its children via the parent transform, not by iterating shapes. Child `x,y` are stored relative to the parent. Dragging out reparents to the nearest ancestor under the pointer, or root.
- Acceptance: Reparenting is visible in the layer list (indent). Child coordinates in the inspector are relative to the frame. Moving the frame leaves child x/y untouched.
- Edge cases: Back-compat for existing boards: migrate by assigning `parentId` to the smallest containing frame once. Cycles are impossible (a frame cannot become its own descendant). Exposed so that ALIGN-8, 11, 24, 28 work; coordinate with LAYERS and SELECT owners.
- Depends on: LAYERS, SELECT.
- Multi-agent note: Agents' `addShape` should accept `parentId` so agents build inside the frame they were assigned (`author`), keeping everything local to the frame.

### ALIGN-34: Rotated and nested bounding boxes for snapping
- Priority: P2
- Size: M
- Interaction: Snap candidate geometry is the world-space axis-aligned bounding box of each shape (rotation applied, stroke excluded), computed through the parent chain (`worldBox(shape)`). A rotated shape snaps via its AABB; a visual hint draws the AABB dashed on drag so the user sees what is snapping.
- Acceptance: Rotating a rect 45 degrees then aligning its box top with another's top works by AABB; the dashed box appears only during the drag.
- Edge cases: Strokes: add a setting "Snap to stroke bounds" (off by default).
- Depends on: ALIGN-22, ALIGN-33.

### ALIGN-35: Multi-selection snapping
- Priority: P1
- Size: M
- Interaction: A multi-selection snaps by its union bounding box edges/centers (plus, optionally, each member's own edges when "Snap each object" is on, off by default). Guides span from the union box. Align toolbar already works on the union (ALIGN-11).
- Acceptance: Dragging 3 selected shapes snaps their combined left edge to another shape's left edge.
- Edge cases: Selection includes a frame and its child: the child is not an independent source.
- Depends on: ALIGN-1, SELECT multi-selection.

### ALIGN-36: Keyboard nudge with snapping rules
- Priority: P1
- Size: S
- Interaction: Arrow keys move selection by 1 unit, Shift+Arrow by 10 (or `gridStep` if bigger; configurable "Big nudge", default 10). Nudge never object-snaps. If the selected shape is a child of an auto-layout frame, arrows reorder it (Figma: Ctrl+arrow? here Alt+Shift+arrows) and plain arrows are disabled.
- Acceptance: Right arrow changes x by exactly 1; Shift+Right by 10. Hold-to-repeat works without lag.
- Edge cases: Rounding fractional positions: first arrow rounds then moves.
- Depends on: SELECT.

### ALIGN-37: Snapping considers in-flight shapes of other cursors
- Priority: P2
- Size: S
- Interaction: Setting "Snap to shapes being edited by others" (default off, since snapping to a moving target feels erratic). When off, shapes with `owner` set (`engine.ts:17`) and not owned by the dragger are excluded from candidates. When on they are included at their live position.
- Acceptance: With default off, dragging next to an agent's half-drawn shape does not snap to it. Toggling on snaps.
- Depends on: ALIGN-9.
- Multi-agent note: Agents drawing their own shapes always include previously completed shapes (they are stable).

### ALIGN-38: Snap indicator on the cursor and tooltips
- Priority: P2
- Size: S
- Interaction: While snapped, a tiny x mark (6 px, `#F24822`) at the exact contact point, plus a status-bar text "Snapped: left edge to Card 2" visible 1.5 s after the first snap in the drag (accessibility: also exposed via `aria-live="polite"`).
- Acceptance: Screen reader announces the snap target once per engagement; the text disappears after pointer-up.
- Depends on: ALIGN-2.

### ALIGN-39: Magnetic text baseline alignment
- Priority: P2
- Size: M
- Interaction: For text shapes, additional candidate lines at first baseline and last baseline (and x-height / cap-height optionally). Dragging one text near another's baseline (or a rect's bottom edge or center) snaps baselines and shows a pink line labelled `baseline`. Two texts of different sizes can thereby sit on a shared baseline.
- Acceptance: Two texts of 12 px and 32 px align so the glyph bottoms sit on the same line; guide drawn along the baseline.
- Edge cases: Needs font metrics (TEXT); use `ascent`/`descent` from canvas `measureText`.
- Depends on: TEXT metrics, ALIGN-1.

### ALIGN-40: Grid-aware create-and-duplicate offset
- Priority: P2
- Size: S
- Interaction: Duplicating (Cmd+D) offsets by the previous offset if the user moved the duplicate, else by `gap` if duplicated inside auto-layout, else `+10,+10`. Duplicate + drag with Alt snaps the same way as a move. After a drag-duplicate, "repeat" (Cmd+D again) re-applies the same delta so rows/columns build quickly (Figma behavior).
- Acceptance: Alt-drag duplicate a card by 200 right, press Cmd+D twice: two more cards at +200 each.
- Depends on: SELECT, HISTORY.

### ALIGN-41: Multi-agent alignment review (stretch)
- Priority: P2
- Size: M
- Interaction: A "Fix alignment" command, human-invoked, that asks an agent (or runs deterministic heuristics) to nudge near-miss edges (< 3 units off) into line, and report the changes as a list (`Card 2: x 101 → 100`). Each change is highlighted for 2 s in pink and offered as one batch undo step.
- Acceptance: Three cards whose lefts are 100, 101, 99 all become 100; changes listed; one undo.
- Depends on: ALIGN-10, ALIGN-7.
- Multi-agent note: Acts like any other agent: its cursor visibly sweeps the changes.

## Data model and architecture implications

New file `dashboard/src/playground/snap.ts` (pure, no React), imported by `Playground.tsx` for the human and by `engine.ts` for agents. Types:

```ts
// Shape additions (all optional so existing boards still load)
type Shape = {
  /* existing */
  parentId?: string;            // ALIGN-33; x,y relative to parent when set
  rotation?: number;            // degrees, ALIGN-22
  layout?: AutoLayout;          // frame only, ALIGN-24
  sizingH?: 'fixed'|'hug'|'fill'; sizingV?: 'fixed'|'hug'|'fill'; // ALIGN-25
  constraints?: { h: 'left'|'right'|'leftright'|'center'|'scale'; v: 'top'|'bottom'|'topbottom'|'center'|'scale' };
  absolute?: boolean;           // ALIGN-27
  grids?: LayoutGrid[];         // ALIGN-32
};
type AutoLayout = { dir: 'row'|'col'; gap: number; pad: [number,number,number,number]; align: 'start'|'center'|'end'; justify: 'start'|'center'|'end'|'between'; wrap?: boolean };
type LayoutGrid = { kind: 'grid'|'cols'|'rows'; count?: number; size?: number; gutter?: number; margin?: number; align?: 'stretch'|'left'|'center'|'right' };

type Axis = 'x' | 'y';
type Line = { axis: Axis; v: number; kind: 'start'|'center'|'end'|'guide'|'grid'|'baseline'; from: number; to: number; srcId?: string }; // from/to: extent on the other axis, for drawing
type Guide = { id: string; axis: Axis; pos: number };        // ruler guides, board state
type SnapOpts = { thresholdWorld: number; grid?: number; guides?: Guide[]; ignore: Set<string>; exclude?: (s:Shape)=>boolean };
type SnapResult = { dx: number; dy: number; lines: Line[]; gaps: GapMark[]; measure?: Measure };
type GapMark = { axis: Axis; a: number; b: number; at: number; value: number }; // a..b along axis, at = perpendicular position
```

Board-level state: `guides: Guide[]`, `snapSettings: { objects, grid, guides, spacing, step, fractional }` (persisted, default object+spacing+grid on). Overlay state (`snapLines`, `gapMarks`, `measure`) is transient React state or a ref updated in rAF, never persisted nor sent to other clients.

Engine commands (so the human, agents and the console all share one path and HISTORY can record them): `engine.commit(patches)` rounds (ALIGN-7), runs auto-layout/constraint passes, then notifies; `align(ids, mode, to)`, `distribute(ids, axis)`, `tidy(ids)`, `matchSize(ids, dim)`, `resizeShape(id, box)`, `reparent(id, parentId, index)`, `relayout(frameId)`. `window.board` exposes the same.

Spatial index: a bucketed 1-D structure per axis is enough. Keep `Map<bucket, Line[]>` keyed by `floor(v / 256)`, plus shape AABB R-tree-lite as a uniform grid of 512-unit cells. `rebuild` on shape add/remove/commit only (not per pointermove). During a drag the moving set is excluded by id set, never removed from the index.

### Edge/center snap algorithm (per pointermove)

```
function snapMove(box, idx, o):                    // box = union AABB of moving selection, already offset by raw delta
  t = o.thresholdWorld
  region = viewport expanded by t, intersect with parent subtree if inside auto-layout
  cand = idx.query(region) minus o.ignore         // shapes, ruler guides, parent edges, layout-grid lines
  best = { x: null, y: null }
  for axis in [x, y]:
    src = [box.start, box.center, box.end]        // 3 source lines (resize: only moving edges)
    for s of src, for each candidate line c on axis (start/center/end of each shape, guides, grid):
      d = c.v - s
      if |d| <= t and (best[axis]==null or priority(c) beats best or |d| < |best.d|): best[axis] = {d, c}
      // priority: ruler guide > shape/parent line > pixel grid
  apply: box += (best.x?.d ?? 0, best.y?.d ?? 0)
  // after snapping, collect ALL candidate lines coincident with a source line (|c.v - s| < 0.01)
  // -> these form the red guides; extent = min..max of the moving box and every coincident candidate's span
  hysteresis: if previous frame snapped on axis to line L and |L.v - rawS| <= t + 2/cam.z, keep L
  return { dx, dy, lines, gaps: equalGaps(box, cand, t) }
```

### Equal-gap detection

```
function equalGaps(box, cand, t):
  for axis in [x, y]:                              // do x; y is symmetric
    row = cand shapes whose perpendicular range overlaps box (with 0 tolerance), sorted by start
    L = nearest shape fully left of box (gap gL = box.start - L.end), R = nearest fully right (gR = R.start - box.end)
    // 1. between: if L and R exist, target = (R.start - L.end - box.size)/2; if |gL - target| <= t: dx = target - gL; mark gL, gR
    // 2. extend-right: for each consecutive pair (a,b) in row left of box with gap g: if |gL - g| <= t: dx = g - gL; mark (a,b),(L,box)
    // 3. extend-left: symmetric using the pairs to the right of box
    // 4. pick the result with smallest |dx|; mark every pair in the row whose gap == snapped gap (cap 8)
    // spacing snap runs AFTER line snap only on the axis that did not line-snap, so line snaps win
```

Rendering: one `<svg class="pg-snap">` inside `.pg-world`, above shapes, below `.pg-sel`, `pointer-events:none`, sized `0` with `overflow:visible`; all strokes use `vector-effect: non-scaling-stroke` so width stays 1 px at every zoom (no manual `/ cam.z` needed for lines; labels are HTML pills scaled `1/cam.z` as in `Playground.tsx:473-474`). Colors as CSS vars in `playground.css`: `--pg-guide: #F24822`, `--pg-sel: #0d99ff` (existing, `:9`). Priority when snaps conflict on an axis: ruler guide, then object/parent, then spacing, then grid.

Layout pass: `layout(frame)` is a pure function over children (sizes bottom-up, positions top-down); `commit` calls it for every touched frame's ancestor chain, once per rAF. Constraints run at parent resize time. Both read/write only `x,y,w,h`, so rendering and agents need no knowledge of them.

Performance: guides computed on pointermove inside a single rAF; avoid `setShapes` allocation of full arrays at thousands of shapes (today `Playground.tsx:344-350` maps the whole array every move). Recommend a `Map<string, Shape>` plus a version counter, or at least short-circuit when the snapped result equals the previous one.

## Open questions

1. Real `parentId` now or later (ALIGN-33)? It touches LAYERS, SELECT, and the engine. Recommended default: yes, in the first milestone, with a one-time geometric migration.
2. Child coordinates relative to parent, or absolute with a `parentId` link? Recommended: relative (Figma model), converted through `worldBox()`.
3. Guide color: Figma red `#F24822` vs adopting the agent's cursor color on the board. Recommended: red for the human's own snaps, agent color at 60% for agent snaps.
4. Snap threshold 5 px vs 4 px (Figma is about 4-5). Recommended: 5, configurable in the snap menu.
5. Do agents snap by default (ALIGN-10)? Recommended: yes with a 2 unit threshold so demos look tidy.
6. Auto-layout wrap and per-side min/max sizes: in scope for the hackathon? Recommended: no, defer to P2.
7. Grid step default (1 vs 8). Recommended: 1 (integer rounding) with 8 offered in the menu.
8. Any new dependency for the spatial index (e.g. `rbush`)? Recommended: no; the bucketed grid sketched above suffices. Flagging as an open question per the rules.
9. Persist ruler guides and snap settings per board in shared state (multiplayer) vs `localStorage`. Recommended: guides shared, settings local.
