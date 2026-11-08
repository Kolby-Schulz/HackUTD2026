# Selection, transform and direct manipulation

Scope: how a cursor (human or agent) picks layers and changes them by direct manipulation: click/shift/cmd select, marquee, hover, the selection box and its handles, move/resize/rotate with modifiers, nudge, duplicate, delete, lock/hide, z-order, group/frame wrapping, flip, resize of frames with children and constraints, readouts, cancel, context menu, cursors, and the behaviour of the drawing tools at the moment of creation. It leaves snapping, guides, smart distribute and the alt-hover measurement overlay to ALIGN (SELECT only hands it the pointer state), undo/redo stacks to HISTORY, the layer tree panel and rename to LAYERS, and cross-cursor locking, conflict rules and presence to MULTI. Property panels (fill, stroke, typography) are not here. Modifier notation: Cmd = Cmd on macOS, Ctrl on Windows/Linux ("Mod"); Alt = Option on macOS.

## Today

- Single selection only: `selected: string | null` (`Playground.tsx:47`). There is no multi-select state, no marquee, no hover highlight outside the comment tool.
- Click select: `onPointerDown` hit-tests topmost shape by array order, pure AABB, ignoring hidden/locked/frame-vs-child depth (`hitTest`, `Playground.tsx:269-276`); the hit shape is selected and a move drag starts (`Playground.tsx:313-318`).
- Containment is geometric, not structural: a frame "owns" whatever `inside()` its box (`Playground.tsx:37`, `:316`, `:176`). `Shape` has no `parentId`, `z`, `locked`, `visible`, `rotation` (`engine.ts:8-24`). Z-order is array order only.
- Empty-space click clears selection and starts a pan (`Playground.tsx:318-322`); there is no rubber band.
- Handles: only the four corners `nw/ne/sw/se`, 8px, `data-handle` (`Playground.tsx:627-640`, `playground.css:86`). Resize anchors the opposite corner and uses `norm()` so dragging past it flips (`Playground.tsx:325-352`); no min size, no shift/alt modifiers, no edge handles, no rotation, children are not touched when a frame resizes.
- Move: drags the frame plus everything `inside()` it; no axis lock, no escape-cancel, no alt-duplicate (`Playground.tsx:314-317`, `:339-342`). Pointer capture is set on the view (`:280`).
- Readout: a `W x H` pill under the selection (`Playground.tsx:636-638`, `playground.css:87`); no x/y, no live distance, no angle.
- Keys: Backspace/Delete deletes selection plus geometric children (`Playground.tsx:174-179`); Escape clears selection and resets tool (`:181`); single-letter tool keys V F R O T C H (`:25-33`, `:185`); modifier combos are swallowed (`:184`). No arrows, cmd+D, cmd+A, cmd+G, [ ] , lock, hide, flip.
- Creation: frame/rect/ellipse drag creates via `norm()` (`:287-293`, `:326`), click without drag becomes 320x240 / 120x120 (`:357-359`), tool then snaps back to Select (`:360`). No shift-square, no alt-from-center, no live size pill, no auto-parenting. Text tool places a 200x24 box and enters edit (`:300-305`); double-click only edits text (`:363-367`); no drag-to-box for text, no auto-width.
- Not present: right-click menu, cursor-per-handle beyond the 4 corners' resize cursors (`:636`), lock/hide, context awareness for agents (agents call `addShape`/`patch` directly in `engine.ts:191-192`, never via the selection model).

## Features

### SELECT-1: Selection model (multi-id set, primary, focus scope)
- Priority: P0
- Size: M
- Interaction: Replace `selected: string | null` with `selection: { ids: string[]; scope: string | null }`. `ids` is ordered (last = primary, used for readouts and "key object" semantics); `scope` is the container the user is currently "inside" (null = page root; set by double-click-into). Selection is a pure React state owned by Playground and exposed to the console as `window.board.selection`. No visual change on its own.
- Acceptance: Existing single-click select still works; `selected` consumers (layers row highlight `Playground.tsx:443`, `Selection` render `:469`, `focusShape` `:258`) compile against the new model; selecting two shapes via the console renders two outlines.
- Edge cases: ids that disappear (deleted by an agent) are dropped on the next render; empty selection with scope still set; selection survives pan/zoom.
- Depends on: none (everything else builds on this); LAYERS-* must read the same set.
- Multi-agent note: this is the human's local selection only. Each agent keeps its own selection object in the engine (see SELECT-46); the human selection is never changed by agents.

### SELECT-2: Click select with proper hit testing
- Priority: P0
- Size: M
- Interaction: Click picks the topmost visible, unlocked shape under the pointer at the current scope level. Frames hit only on their title label, and on their fill when empty-area-click lands on a frame with no children under the point (Figma: clicking a frame's body selects top-level children first, the frame itself selects via title or when clicking its empty fill only if the frame is at root and has no fill-through; for this board: frame fill is hittable only when no child is under the pointer). Ellipses hit-test by the ellipse equation, rounded rects by radius; text by its box. Ties go to the higher z. Tolerance of 4 screen px around thin shapes (divide by zoom).
- Acceptance: A 2px-tall rect is selectable at 55% zoom; clicking an ellipse's corner outside the curve selects whatever is behind it; hidden and locked shapes are skipped.
- Edge cases: shapes overlapping at identical z (array order wins); shape fully covered by a transparent-fill frame; 500+ shapes (hit test must be O(n) per event with early exit, no allocation); rotated shapes (hit test in local space after inverse rotation).
- Depends on: SELECT-1, SELECT-27 (lock/hide flags), SELECT-24 (rotation) for rotated hit.
- Multi-agent note: shapes owned by another cursor remain selectable (read-only editing is MULTI's call).

### SELECT-3: Shift-click add/remove
- Priority: P0
- Size: S
- Interaction: Shift+click on an unselected shape adds it; on a selected shape removes it. Shift+click on empty canvas does nothing (does not clear). Selection from different parents is allowed and shown with a combined box.
- Acceptance: Click A, shift-click B -> both selected with one bounding box; shift-click A -> only B; shift-click empty keeps both.
- Edge cases: shift held during a drag-start on a selected shape does not deselect it (deselect-on-click only when pointer-up without movement); shift-click inside a different frame than the current scope.
- Depends on: SELECT-1, SELECT-2.

### SELECT-4: Cmd/Ctrl-click deep select
- Priority: P0
- Size: S
- Interaction: Mod+click selects the deepest shape under the pointer, ignoring the scope (so frame > group > child resolves to the leaf in one click). Mod+shift+click adds the deepest shape to the selection. While Mod is held (and Select tool active), hover highlight shows the deep candidate.
- Acceptance: With Profile card on the board, Mod+click on the "Follow" label selects the text, not the card; plain click selects the card.
- Edge cases: Ctrl+click on macOS is right-click (context menu), so mac uses Cmd only; on Windows Ctrl+click works; locked leaf is skipped to the next unlocked.
- Depends on: SELECT-2, SELECT-3.

### SELECT-5: Click-hierarchy rules (what a plain click picks)
- Priority: P0
- Size: M
- Interaction: Figma rule: at root, a plain click selects the top-level object (frame, group, or free shape), never a child. Once a container is selected or the user is "inside" it (SELECT-6), clicks select that container's direct children. Clicking a shape inside the current scope's sibling set selects it; clicking outside the scope climbs the scope to the nearest common ancestor. Because `Shape` has no `parentId` today, this requires SELECT-40.
- Acceptance: Click on Hero section's CTA selects "Hero section"; double-click then click selects the CTA button rect; clicking another card's child while inside the first card selects the other card, not its child.
- Edge cases: free shapes with no parent at root; frame inside a frame (nested frames count as children); a frame with `clip=false` that visually overflows.
- Depends on: SELECT-40, SELECT-2.

### SELECT-6: Double-click to enter a container or edit text
- Priority: P0
- Size: M
- Interaction: Double-click on a frame/group selects the child under the pointer (enters scope, SELECT-1 `scope = parentId`). Double-click on a text layer enters text edit with the caret at the click position (Today: edit only, no caret placement, `Playground.tsx:363-367`). Double-click on a rect/ellipse while the Select tool is active enters nothing in P0 (vector edit is P2, SELECT-48). Enter on a selected container selects its children; Shift+Enter selects the parent; Escape while editing text exits edit and keeps the layer selected.
- Acceptance: Double-click on a card's avatar ellipse selects the ellipse; double-click on "Ada Lovelace" shows an editable textarea; Enter on a selected frame selects all its direct children; Shift+Enter walks back up.
- Edge cases: double-click on a locked child (stays on parent); double-click on empty canvas with a text selected (no-op); trackpad double-tap timing (use the 300ms/4px click detector from SELECT-9 instead of the native `dblclick` so zoomed pointer drift is tolerated).
- Depends on: SELECT-5, SELECT-9.

### SELECT-7: Hover highlight
- Priority: P0
- Size: S
- Interaction: In Select tool, the shape that a click would select gets a 1px outline in `--pg-sel` (`playground.css:9`) with the layer name label above-left of frames (Figma style). Hover is suppressed during any drag, while panning, and for the already-selected shape (it already has the box). With Mod held the candidate is the deep target (SELECT-4). Today hover state exists only for the comment tool (`Playground.tsx:334-336`).
- Acceptance: Moving the mouse over shapes highlights exactly the one a click would select; the highlight disappears during marquee and move; updates within one frame, no layout thrash at 500 shapes.
- Edge cases: hovering a locked shape (no highlight, not selectable); overlapping cursor and handle regions (handle wins, no shape highlight); pointer leaves the view (`:457` already clears).
- Depends on: SELECT-2.
- Multi-agent note: other cursors' hover is not rendered (MULTI may add a thin colored hover for observed cursors).

### SELECT-8: Marquee (rubber-band) selection
- Priority: P0
- Size: M
- Interaction: Pointer-down on empty canvas (or on a frame's empty area at root only when the frame is not already selected and the user holds nothing) begins a marquee; drag draws a translucent rectangle (`--pg-sel` at 8% fill, 1px border). Shapes are selected live as the rect crosses them. Touching rule: shape is selected if the marquee **intersects** it (any overlap), except container shapes: a frame/group is selected only if the marquee fully encloses it or touches its title/edge, not merely overlaps its interior (otherwise marqueeing over a big frame to grab its children would pick the frame). Marquee that starts inside a frame selects that frame's direct children only (scope = that frame); marquee started at root selects top-level objects only. Today empty-click pans (`Playground.tsx:318-322`); panning moves to Space-drag, middle-button, Hand tool and two-finger scroll (already present, `:153-165`, `:283-286`).
- Acceptance: Dragging across three rects selects exactly those three; dragging across a card's interior at root selects nothing unless the marquee reaches the card edge; dragging from inside the card selects its children.
- Edge cases: marquee drag past the viewport edge auto-pans at 20px/frame up to 20 screen px outside; zoomed far out with thousands of shapes (spatial index, SELECT-47); marquee begun with Shift adds to the existing selection, Mod+marquee uses deep targets (every leaf touched), Alt+marquee is reserved for ALIGN's measure.
- Depends on: SELECT-1, SELECT-5, SELECT-47.

### SELECT-9: Click vs drag disambiguation and gesture pipeline
- Priority: P0
- Size: M
- Interaction: Introduce one pointer gesture state machine in the Select tool: `idle -> pressed -> (click | dragMove | dragMarquee | dragResize | dragRotate)`. Press records start point; movement beyond a 3 screen-px threshold converts to a drag; below it, pointer-up is a click. Double-click detected as two clicks within 300ms and 4px. Replaces the monolithic `dragRef` modes (`Playground.tsx:278-361`) while keeping the `create`, `pan` modes as sibling states.
- Acceptance: A 2px jitter while clicking does not move the shape; a 4px drag does; click-on-selected-with-no-move on a multi-selection narrows to that shape on pointer-up (Figma behavior), not on pointer-down.
- Edge cases: pointer leaves the window mid-drag (capture is set at `:280`, release on `pointercancel`); touch input and pen (pointer events, no hover); two simultaneous pointers (ignore second).
- Depends on: SELECT-1.

### SELECT-10: Escape ladder and click-away deselect
- Priority: P0
- Size: S
- Interaction: Escape resolves in order: cancel an in-progress drag (SELECT-26), close context menu/popover, exit text edit, exit scope (move scope up one level, selecting the container), clear selection, finally revert tool to Select. Today Escape does all of it at once (`Playground.tsx:181`). Clicking empty canvas clears selection (on pointer-up when no marquee developed).
- Acceptance: Mid-resize Escape restores the original box and ends the drag; Escape inside a card with a child selected selects the card; second Escape clears.
- Edge cases: Escape while the comment popover is open (closes it only); Escape in a textarea with IME composition active (ignored).
- Depends on: SELECT-9, SELECT-26.

### SELECT-11: Select all, select siblings, select same
- Priority: P1
- Size: S
- Interaction: Mod+A selects every top-level shape in the current scope (siblings); Mod+Shift+A would be Select none; Escape also clears. `Tab` / `Shift+Tab` select next/previous sibling in z-order; `Enter` / `Shift+Enter` go into/out of container (SELECT-6). "Select same" (right-click > Select all with same fill / stroke / type / font) selects across the whole page those matching the primary's property; exposed in the context menu (SELECT-45) and `window.board.selectSame('fill')`.
- Acceptance: Mod+A with a frame selected inside selects its siblings; right-click a rect, Select same fill, selects every shape with the identical `fill`; Tab cycles through siblings wrapping around.
- Edge cases: Mod+A inside a text textarea selects text, not layers (existing guard `:172`); Mod+A with 5,000 shapes; hidden/locked shapes excluded.
- Depends on: SELECT-1, SELECT-45.

### SELECT-12: Selection box (single and multi)
- Priority: P0
- Size: M
- Interaction: One 1px blue box around the union AABB of selected shapes; for a single rotated shape the box is the rotated rect (not the AABB). Multi-selection also draws a thin 1px outline around each member. Corner handles are 8x8 white squares with 1px blue border, centered on the box corners, constant on-screen size at any zoom (the current code does this with `8 / z`, `Playground.tsx:628`). Edge handles are invisible hit strips (SELECT-14). Box hides while dragging a marquee, hides for the shape being text-edited (existing `!editing`, `:469`), and hides when `tool === 'comment'` (existing). Shapes smaller than 16 screen px: handles move outward / hide inner handles so they do not overlap (Figma shows only corner handles at tiny sizes, 6px hit pad).
- Acceptance: Select two rects -> one union box plus two thin outlines; zoom 25% -> handle stays 8 screen px; a 3x3 px shape shows four outward corner handles.
- Edge cases: 0-size shapes mid-create; single line with h=0; a group with rotated children (union of rotated AABBs); huge selection (cull member outlines beyond 200).
- Depends on: SELECT-1.

### SELECT-13: Corner resize handles
- Priority: P0
- Size: M
- Interaction: Drag any of the four corner handles to resize; the opposite corner is the anchor. Flip past the anchor mirrors the shape (existing `norm()` behaviour, `Playground.tsx:36`, `:344-351`) and should flip the shape's `flipX/flipY` (SELECT-35) so text and children mirror. Multi-selection resizes as a block scaling each member proportionally about the anchor. Minimum 1x1 (no zero-size shapes). Rounded `radius` clamps to `min(w,h)/2`.
- Acceptance: Dragging `se` of a rect to larger works; dragging it left past `nw` mirrors the shape; multi-select of 3 rects scales all about the opposite corner.
- Edge cases: resizing a rotated shape (math in local space, anchor stays fixed in world space); resizing text (box resizes, font does not scale; with Mod it scales font, SELECT-14 note); zoom-dependent hit slop.
- Depends on: SELECT-12, SELECT-9.

### SELECT-14: Edge resize handles
- Priority: P0
- Size: S
- Interaction: A 6 screen-px invisible strip along each of the four edges (the whole edge minus the corner areas) drags that single edge; cursor `ew-resize` / `ns-resize`. Resizing from an edge changes one dimension only. For text, dragging a side edge sets fixed width (turns auto-width to fixed, SELECT-43); Mod while dragging text scales the font size instead.
- Acceptance: Dragging the right edge of a rect changes only width; hovering shows the horizontal-resize cursor; the corner still wins in the corner region.
- Edge cases: shapes smaller than the strip (strips shrink, SELECT-12); invisible strips must not eat pointer events when selection is hidden; at 800% zoom the strip stays 6 screen px.
- Depends on: SELECT-13.

### SELECT-15: Shift = proportional resize
- Priority: P0
- Size: S
- Interaction: Holding Shift during a corner drag locks the aspect ratio of the **original** box; the dominant pointer axis wins. Pressing/releasing Shift mid-drag updates live. For edge drags Shift does nothing except for scale ("K" tool, out of scope). Images and shapes with a "lock aspect ratio" flag (padlock in the properties panel, `Shape.lockRatio`) always resize proportionally without needing Shift.
- Acceptance: Shift+drag `se` on a 200x100 rect keeps 2:1; Shift toggled mid-drag snaps ratio then releases; multi-selection keeps the union ratio.
- Edge cases: ratio of a 0-height line (fall back to free); flipped drags keep ratio; Shift with Alt (center + proportional).
- Depends on: SELECT-13.

### SELECT-16: Alt/Option = resize from center
- Priority: P0
- Size: S
- Interaction: Holding Alt during any resize drag makes the center the anchor, both sides move symmetrically; the drag delta is doubled on the dragged axes. Combines with Shift. Releasing Alt mid-drag re-anchors to the opposite side without a jump (recompute from the current pointer, not from deltas). macOS Option and Windows Alt.
- Acceptance: Alt+drag `se` of a 100x100 rect centered at (0,0) by +20,+20 gives 140x140 still centered at (0,0); Alt+Shift keeps the ratio.
- Edge cases: Alt+click on a window-chrome on Windows (focus menu bar; call `preventDefault` on Alt keyup during an active drag); Alt while panning.
- Depends on: SELECT-13.

### SELECT-17: Cmd/Ctrl = ignore snapping during drag
- Priority: P1
- Size: S
- Interaction: While Mod is held during move/resize/rotate/draw, the gesture pipeline passes `snap: false` to ALIGN's snapping hook, so the pointer value passes through unmodified. Releasing Mod re-enables snapping on the next move. In Figma holding Cmd while dragging disables snapping; nudge-with-Cmd is not a thing.
- Acceptance: A move that normally snaps to a neighbour's edge doesn't while Mod is held; no snap guide lines render.
- Edge cases: Mod on macOS also triggers Cmd-click deep select at press time, so the flag is read live each pointer-move rather than at pointer-down.
- Depends on: ALIGN-* (snapping API), SELECT-9.

### SELECT-18: Rotation handles at corners
- Priority: P1
- Size: L
- Interaction: A rotation zone lies in a ~12 screen-px ring just outside each of the four corner handles; hovering it shows a rotate cursor (curved double arrow, its orientation follows the corner angle; see SELECT-39). Dragging rotates the shape about its **center** (Figma: about the center for single; about the selection center for multi). A live angle pill follows the pointer ("34°"). Adds `Shape.rotation` in degrees, CSS `rotate()` with `transform-origin: center`. Rotating a frame rotates its children with it (they stay in local coordinates, SELECT-40). Positive = clockwise to match CSS; display counterclockwise in the UI to match Figma (Figma shows positive as counter-clockwise: convert at the boundary).
- Acceptance: Dragging a corner ring rotates the rect about its center and the angle pill reads the current angle; the selection box rotates with the shape; a rotated shape still moves, resizes, and hit-tests correctly.
- Edge cases: resizing a rotated shape (handles rotate with the box); rotation for ellipses and text; group rotation with already-rotated children; angle wraps to -180..180.
- Depends on: SELECT-12, SELECT-2, SELECT-40.

### SELECT-19: Shift = 15 degree rotation steps
- Priority: P1
- Size: S
- Interaction: Shift during a rotation drag quantizes to 15 degree increments relative to 0 degree (absolute, not relative to start). The angle pill shows the quantized value.
- Acceptance: Shift+rotate lands on 0, 15, 30, ... 345 only; releasing Shift continues smoothly from the current pointer angle.
- Edge cases: starting rotation from 7 degree with Shift jumps to 0 or 15 immediately (Figma behaviour).
- Depends on: SELECT-18.

### SELECT-20: Move by dragging
- Priority: P0
- Size: M
- Interaction: Pointer-down on a selected shape's body (or on an unselected one, which selects it first) then drag past the threshold moves the whole selection by the pointer delta in world coordinates (divide by zoom). The move is applied to `Shape.x/y` of each moved top-level selected item; descendants follow via parent transforms once SELECT-40 lands (until then the current geometric group-move behaviour at `Playground.tsx:314-317` stays). Cursor is the default arrow during move (Figma). Dragging a child out of its frame reparents it to whatever frame is under the drop point (SELECT-37).
- Acceptance: Drag a shape 100 world px at 50% zoom with 200 screen px pointer travel; frame drags with its children; multi-selection moves as one.
- Edge cases: drag with shapes owned by another cursor (MULTI decides); dragging a hidden-child; moving beyond current viewport (auto-pan near edges 20px/frame); locked shapes cannot be dragged but can be marquee-selected.
- Depends on: SELECT-9, SELECT-1.
- Multi-agent note: the human can drag an agent's shape while the agent's script is mid-draw; the `patch` calls from `engine.ts:192` overwrite x/y, so the engine must stop re-asserting position after creation and treat the human move as authoritative.

### SELECT-21: Shift = axis lock while moving
- Priority: P0
- Size: S
- Interaction: Shift during a move constrains to the dominant axis (horizontal or vertical) relative to the **drag start**, re-evaluated live. For rotated shapes still world-axis locked. The readout pill (SELECT-30) shows only the changing axis.
- Acceptance: Shift+drag diagonally only moves along x (if |dx|>|dy|); toggling Shift mid-drag snaps back to free.
- Edge cases: Shift pressed after the drag started; equal dx and dy (prefer x); with snapping enabled (lock first, then ALIGN snaps along the remaining axis).
- Depends on: SELECT-20.

### SELECT-22: Arrow-key nudge
- Priority: P0
- Size: S
- Interaction: Arrow keys move the selection 1 world px; Shift+Arrow moves 10 px. Holding repeats with the OS key repeat. Mod+Arrow is reserved (z-order in some tools; not used here). Applies to all selected, in world coordinates even when rotated. A burst of nudges (< 300ms apart) coalesces into one history entry. Does nothing when focus is in an input/textarea (guard at `Playground.tsx:172`). Alt+Arrow (Figma: distance to nearest object) is ALIGN's.
- Acceptance: Select a rect at x=100 and press Right x3 -> x=103; Shift+Right -> 113; history shows a single entry for a quick burst.
- Edge cases: nudging text in edit mode (arrows move caret instead); nudging shapes owned by another cursor; fractional positions after rotation (keep float, round only on display).
- Depends on: SELECT-1; HISTORY-* for coalescing.

### SELECT-23: Duplicate with Mod+D
- Priority: P0
- Size: S
- Interaction: Mod+D duplicates the selection and selects the copies. Offset: Figma pastes in place with no offset for Cmd+D after a move; for first duplicate Figma places the copy at the same position. This board uses +16,+16 world px for the first duplicate to make the copy visible (open question Q3), and repeated Mod+D continues with the **same delta as the previous duplicate+move** (Figma "duplicate and repeat": if the user moves the copy, the next Mod+D applies the same offset again). Duplicates are inserted directly above the original in z-order inside the same parent, names get a numeric suffix ("Card 2"), ids are fresh via `uid()` (`engine.ts:49`). Preventing the browser's "bookmark page" default on Mod+D.
- Acceptance: Mod+D on a card duplicates the card and all children as one unit; move the copy 200px right then Mod+D again -> third copy appears 200px right of the second; the original is untouched.
- Edge cases: duplicating a frame at root puts the copy beside it (Figma auto-places frames to the right, no overlap); selection of unrelated parents (each copy stays in its own parent); component instances (out of scope).
- Depends on: SELECT-1, SELECT-40.
- Multi-agent note: agent-authored copies keep `author` of the human duplicator (the duplicator is the author of the copy); `owner` is cleared.

### SELECT-24: Alt/Option-drag duplicate
- Priority: P1
- Size: M
- Interaction: Alt+press on a selected (or about-to-be-selected) shape, then drag: a copy is left behind at the original position and the original (selection) moves; cursor shows the "+" duplicate arrow. Alt pressed after the drag has started converts it to a duplicating drag (Figma allows this) and releasing Alt before pointer-up cancels back to a plain move. With Alt held on release the copy persists. Combines with Shift (axis lock).
- Acceptance: Alt+drag of a rect leaves a clone at origin; Alt toggled off mid-drag removes the clone and ends as a plain move; the resulting selection is the moved one.
- Edge cases: Alt+drag a locked layer (no-op); Alt+drag within a frame keeps the copy in the same frame; Alt-drag with 100 selected shapes (batch).
- Depends on: SELECT-20, SELECT-23.

### SELECT-25: Delete and cut-delete
- Priority: P0
- Size: S
- Interaction: Backspace or Delete removes all selected layers and their descendants (replaces the geometric `inside()` removal, `Playground.tsx:174-179`); selection clears, or selects the parent when exited by Backspace from inside a scope (Figma keeps parent unselected; here: clear). Mod+X is cut (clipboard owned by HISTORY/clipboard feature). The engine must tell agents a shape disappeared (`handle()` already says "That layer is gone now", `engine.ts:391`).
- Acceptance: Delete on a multi-selection removes all; a deleted frame removes its children by id not geometry; Mod+Z restores it.
- Edge cases: deleting a locked layer (blocked with toast "Layer is locked"); deleting a shape that an agent owns (MULTI); deleting during a drag (ignored).
- Depends on: SELECT-1, SELECT-40, HISTORY-*.
- Multi-agent note: an agent mid-build whose frame was deleted should abort that build step gracefully (`engine.ts:290-323` adds children to a frame by position, so it would otherwise keep drawing into empty space).

### SELECT-26: Escape cancels a drag mid-way
- Priority: P0
- Size: S
- Interaction: Pressing Escape during move/resize/rotate/marquee/create restores the pre-drag state of every touched shape (stored at pointer-down as `orig`; the resize drag already stores `orig`, `Playground.tsx:310`) and ends the gesture; further pointer movement is ignored until pointer-up. During create, Escape deletes the half-drawn shape. Nothing is pushed to history.
- Acceptance: Start moving, press Escape -> shapes return and cursor continues without moving anything; releasing after cancel does not commit.
- Edge cases: Escape pressed in the same frame as pointer-up (pointer-up wins if it came first); Escape while holding Alt-duplicate (drops the copy too).
- Depends on: SELECT-9, SELECT-10.

### SELECT-27: Lock and unlock
- Priority: P1
- Size: S
- Interaction: Mod+Shift+L toggles lock on the selection (`Shape.locked`). Locked shapes are skipped by click, marquee and hover, cannot be moved, resized, or deleted from the canvas, but can be selected through the layer panel (LAYERS) and show a small padlock beside the name. Unlocking via layer row or Mod+Shift+L with the layer selected from the panel. Locked parent locks its descendants for canvas hit-testing.
- Acceptance: Lock a rect, click on it: nothing is selected; marquee over it: not selected; unlock from the context menu restores it.
- Edge cases: locking a selection that includes already-locked items (toggle sets all to locked if any unlocked); a locked frame whose children are unlocked (children still unreachable from canvas).
- Depends on: SELECT-40, LAYERS-*.
- Multi-agent note: agents may lock a layer they own to protect an in-progress edit; locks set by agents show their color on the padlock (MULTI owns conflict rules).

### SELECT-28: Hide and show
- Priority: P1
- Size: S
- Interaction: Mod+Shift+H toggles `Shape.visible`. Hidden shapes do not render, hit-test, or appear in marquee; they remain in the layer tree with a dimmed row. Hiding a container hides descendants without mutating their flags.
- Acceptance: Hide a rect and it vanishes from the canvas; the layer row stays; Mod+Shift+H again (after selecting from layers) shows it.
- Edge cases: hiding the only selection leaves an empty selection; exporting excludes hidden; hidden shapes still count in "select all" on the layers panel only.
- Depends on: SELECT-40, LAYERS-*.

### SELECT-29: Z-order shortcuts
- Priority: P0
- Size: S
- Interaction: Mod+] bring forward one step, Mod+[ send backward one step, Mod+Shift+] bring to front, Mod+Shift+[ send to back. "One step" is relative to **overlapping siblings** only (Figma skips non-overlapping neighbours so the action always visibly changes the order). Ordering is the sibling order in the parent (array order within `children`, SELECT-40); multi-select preserves relative order. Today z-order is the flat `shapes` array order (`Playground.tsx:462`, `hitTest` iterates reverse `:271`).
- Acceptance: Overlapping rects A (below) and B: select A, Mod+] puts it above B; Mod+Shift+[ on B goes behind everything in the same parent; the layers list reflects it.
- Edge cases: shapes already at the front (no-op, no history entry); selection spanning parents (each moves within its own parent); `[`/`]` keycodes on non-US layouts (match on `e.code` BracketLeft/Right).
- Depends on: SELECT-40.
- Multi-agent note: reordering must not reorder what other cursors' streams assume; shapes are addressed by id, never by array index.

### SELECT-30: Live size, position and distance readouts
- Priority: P0
- Size: M
- Interaction: While dragging: a small blue pill (`--pg-sel`, white text, 10px, as `pg-dims` at `playground.css:87`) is centered 8 screen px below the selection box. Move: shows `X: 120  Y: 80` of the primary relative to its parent (or "dx, dy" with Shift); Resize: `W x H`; Rotate: `34°`; Draw: `W x H`; Marquee: no pill. The pill also shows on mere selection (W x H, as today, `Playground.tsx:636`) and hides while moving to avoid clutter. Pill text uses integers (1 decimal when zoomed past 400%). The pill and box handles do not scale with zoom (existing `/ z` pattern).
- Acceptance: Resizing shows the live W x H; moving shows X,Y; both update every frame; at 25% zoom the pill is still readable and not larger than normal.
- Edge cases: pill would leave the viewport (clamp inside, flip above); very narrow shapes; rotated selection (pill under the unrotated AABB, not along the rotated edge); multi-select shows the union size.
- Depends on: SELECT-12.

### SELECT-31: Cursor shapes per handle and gesture
- Priority: P1
- Size: M
- Interaction: Cursor changes by hover target: body of selected = default arrow (no move cursor, Figma); corner handle = diagonal resize (`nwse-resize` / `nesw-resize`, matching rotated angle by snapping the rotation to the nearest 45 degree and swapping the cursor); edge handle = `ew-resize` / `ns-resize` (also rotated); rotation ring = custom rotate SVG cursor rotated to the corner angle; Hand tool/Space = `grab`/`grabbing`; drawing tools = crosshair; Text tool = I-beam; Alt held over a selected shape = duplicate arrow (`copy`). Cursors are set on `.pg-view` (not on handles only) so they persist during a drag with pointer capture (`Playground.tsx:280`). Today only the four corner resize cursors exist (`:636`).
- Acceptance: Cursor reflects the handle under the pointer within 1 frame; during a resize drag the cursor stays a resize cursor even when pointer leaves the handle; rotated shapes show angle-aware resize cursors.
- Edge cases: custom SVG cursors must provide a fallback keyword; cursors for touch/pen are n/a; high-DPI.
- Depends on: SELECT-13, SELECT-14, SELECT-18.

### SELECT-32: Group and ungroup
- Priority: P0
- Size: M
- Interaction: Mod+G wraps the selection in a `group` (new `Kind`, no fill, no clip, bounds = union of children, name "Group N"); the group takes the position in z-order of the topmost member and is selected. Mod+Shift+G ungroups: children are re-parented to the group's parent in the same z position and become the selection. Ungroup also works on a frame (frames are removed, children keep their world position). Grouping preserves world coordinates of every child (local coords are recomputed, SELECT-40). Groups have no constraints or clipping and resize by scaling children.
- Acceptance: Select 3 rects, Mod+G -> one box with "Group 1" in the layers; clicking any of them selects the group; double-click enters and selects the one; Mod+Shift+G restores the 3 selected.
- Edge cases: grouping items from different parents (Figma groups into the parent of the topmost); grouping a single item; grouping locked items; grouping an item with its own ancestor selected; nested groups.
- Depends on: SELECT-40, SELECT-5.

### SELECT-33: Frame selection (wrap in frame)
- Priority: P1
- Size: M
- Interaction: Mod+Alt+G wraps the selection in a new frame sized to the union with no padding (Figma "Frame selection"), clip on, white fill (the board default is `#ffffff`, `Playground.tsx:292`). Also available while the Frame tool is active by dragging a frame over existing shapes: those fully enclosed are re-parented into it (Figma's auto-nest-on-draw behaviour is only for single-frame draws over shapes: they move in).
- Acceptance: Select 2 rects, Mod+Alt+G -> a frame appears exactly bounding them, contains them, selected.
- Edge cases: Frame selection of a single frame (Figma wraps it in a parent frame; allow); at least one shape with a negative-size flip; selection that includes a locked child.
- Depends on: SELECT-32, SELECT-40.

### SELECT-34: Reparent by drag in/out of frames
- Priority: P0
- Size: M
- Interaction: While moving a shape/group, the deepest unlocked frame under the **pointer** (not shape center) is the drop target; frame outline highlights in `--pg-sel` as the target while hovering. On drop the shape is re-parented to the target and its world position is preserved (local coords recomputed). Dropping outside any frame moves it to the page root. Holding Mod while dropping prevents reparenting (Figma: "Cmd to not reparent"). Only frames receive children by drop (groups are not drop targets). This replaces the geometric `inside()` membership (`Playground.tsx:37`) with real structure.
- Acceptance: Drag a loose rect into a card -> the card now owns it and moves it; drag a child of the card out to empty canvas -> becomes root; Mod+drag over a frame leaves the shape un-parented.
- Edge cases: dropping a frame into itself or its own descendant (rejected); frame with `clip=true` hides content moved partially out; dragging a multi-selection from different parents into one frame.
- Depends on: SELECT-40, SELECT-20.
- Multi-agent note: when an agent draws on top of a frame, the agent's shape is parented to the frame under the drawing start point (see SELECT-46).

### SELECT-35: Flip horizontal / vertical
- Priority: P1
- Size: S
- Interaction: Shift+H flips the selection horizontally, Shift+V vertically, about the **selection's** center (multi-select mirrors positions, too). Stored as `flipX/flipY` plus x,y adjustments; applied as `scale(-1, 1)` in render; text mirrors visually, as in Figma. Flipping a rotated shape negates its rotation.
- Acceptance: Shift+H on a shape with a gradient/ellipse notch flips visibly; flipping twice returns to start; multi-select mirrors layout around the union center.
- Edge cases: Shift+H collides with the Hand tool "H" (tool key is bare `H`, this is shifted) and `Shift+V` with Select tool (bare `V`); dragging a handle past the anchor sets flip implicitly (SELECT-13).
- Depends on: SELECT-13, SELECT-18.

### SELECT-36: Resizing frames with children (clip vs grow)
- Priority: P1
- Size: M
- Interaction: Default for frames: resizing a frame **does not scale its children**; children keep size and position per their constraints (SELECT-37), and content that falls outside is **clipped** when `clipContent` is true (default true for frames, Figma). Holding **K** (Scale tool, P2) scales children; with the `scaleChildren` flag the frame behaves like a group. Groups always scale children. A "hug contents" mode (auto-layout) is out of scope here and owned by a later layout domain; if present the frame grows to fit instead of clipping. Setting `clipContent=false` lets children overflow visibly, and overflow still hit-tests.
- Acceptance: Narrowing a card from 320 to 200 wide keeps the avatar at left and the "Follow" button inside until its constraint makes it move; shrinking height clips the bottom rows when clip is on; with clip off they overflow.
- Edge cases: frames resized by an agent via `patch` (engine.ts:192) must run the same constraint pass (see Data model); resizing during flip; nested frames with their own constraints resolve parent-first.
- Depends on: SELECT-37, SELECT-40, SELECT-13.

### SELECT-37: Constraints when the parent resizes
- Priority: P1
- Size: L
- Interaction: Each child has `constraintX: 'left'|'right'|'center'|'left-right'|'scale'` and `constraintY: 'top'|'bottom'|'center'|'top-bottom'|'scale'`, default left/top. Resizing the parent by (dw, dh) updates children: left/top = unchanged; right/bottom = shift by dw/dh; center = shift by dw/2; left-right (stretch) = grow width by dw; scale = proportional to the parent's ratio. Computed from original child rect and original parent size at drag start (not accumulated), so the result is order-independent and exactly reversible by Escape. Constraints are only edited in the properties panel (out of scope) but the data lives here; agents may set them at creation.
- Acceptance: A button with constraint right-bottom stays pinned to the bottom-right while the card resizes; a bar with left-right stretches; scale scales; Escape mid-resize restores positions.
- Edge cases: constraints ignored for children of groups; rotated children (constraints apply to their bounding box); resizing with Alt (center): each side gets dw/2; flipped frames.
- Depends on: SELECT-36, SELECT-40.

### SELECT-38: Draw tools: click for default size, drag for sized
- Priority: P0
- Size: S
- Interaction: With Frame/Rect/Ellipse tool active: press-drag draws from the press point to the pointer with live size pill; a plain click (< 3px movement) drops a default-size shape with its top-left at the click (Figma uses 100x100); this board keeps its existing 320x240 frame and 120x120 shapes (`Playground.tsx:357`) as the demo's feel. The new shape is selected, tool reverts to Select (existing `:360`) unless the tool is locked (double-press the tool key or Shift+tool key, "tool lock", P1). Name is `Kind N` (existing, `:289-291`).
- Acceptance: Click once with Rect tool -> 120x120 rect at the click, selected, tool back to Select; drag -> exact dragged size; the tool-lock gesture keeps drawing.
- Edge cases: drawing while zoomed out (default size in world px, so tiny on screen; Figma uses the same); drag with 0 width or height gets 1 px minimum; drawing over a frame parents the shape to the frame under the **press point** (SELECT-34).
- Depends on: SELECT-9, SELECT-34.

### SELECT-39: Draw tool modifiers (Shift square, Alt from center)
- Priority: P0
- Size: S
- Interaction: Shift while drawing constrains to a 1:1 box (square or circle), using the larger axis; Alt draws from the press point as center (both directions); both combine. Modifiers are read live. Today `norm()` only handles a free corner-to-corner (`Playground.tsx:36`, `:336`). Press Space during drawing to reposition the shape (move the origin) without changing size (Figma).
- Acceptance: Shift+drag with Ellipse gives a circle; Alt+drag grows both sides of the press point; Shift+Alt gives a centered circle; Space mid-draw moves it.
- Edge cases: drag direction up-left under Shift keeps the quadrant; the live size pill (SELECT-30) shows the final size.
- Depends on: SELECT-38.

### SELECT-40: Hierarchy in the document model (parentId + local coordinates)
- Priority: P0
- Size: L
- Interaction: This is the structural prerequisite for groups, constraints, deep select, reparent, rotation of frames, and clip. Add `parentId?: string` and per-parent child ordering; positions of children become **relative to the parent's origin**. Rendering nests DOM (`.pg-shape` inside its parent) so the browser composes transforms and clipping, or flattens with a computed world matrix (decision in Data model). Engine helpers: `childrenOf(id)`, `worldBox(id)`, `ancestors(id)`, `hitDeep(x,y)`. Agents continue to receive world coordinates through a helper to keep their scripts simple (`build()` positions in `engine.ts:296-317`).
- Acceptance: Moving a frame moves children with no `inside()` computation; deleting a frame deletes by `parentId`; a child can sit partially outside its frame and remain a child; moving a child out changes `parentId`.
- Edge cases: migration of the existing flat `Shape[]` (derive `parentId` from the smallest enclosing frame on load); cycles are impossible (reject); orphan children after parent delete (cascade); thousands of siblings.
- Depends on: none (blocks 2, 5, 18, 23, 25, 29, 32, 33, 34, 36, 37).
- Multi-agent note: all agent writes carry `parentId` so concurrent agents can't accidentally re-parent each other's shapes by overlapping geometry.

### SELECT-41: Text tool: click to place (auto width)
- Priority: P0
- Size: S
- Interaction: Click with the Text tool creates an **auto-width** text layer at the click baseline and enters edit mode (existing behaviour with fixed 200x24 box, `Playground.tsx:300-305`). The box grows with typed content (no wrapping) until the user resizes the width, which flips it to fixed-width. Empty text layers are deleted on blur or Escape (Figma). Clicking existing text with the Text tool edits that text rather than creating a new one. Enter inserts a newline (Shift+Enter too); Escape or click-away commits.
- Acceptance: Click, type "Hello", the box fits; Escape keeps it; clicking away on an empty one removes it; clicking on existing text edits it.
- Edge cases: IME composition; click on a locked text; text created inside a frame (parented to the frame under the click); zoomed out (font size in world px, selection chrome constant).
- Depends on: SELECT-6, SELECT-34.

### SELECT-42: Text tool: drag to create a fixed-width box
- Priority: P1
- Size: S
- Interaction: Press-drag with the Text tool draws a text box with fixed width and auto height (text wraps within the width; height grows with content). Shape is in edit mode as soon as the drag ends. A drag shorter than 3 px acts as a click (SELECT-41).
- Acceptance: Dragging a 200px-wide box and typing a long sentence wraps inside the width and grows downward.
- Edge cases: shift/alt behave as for rectangles (SELECT-39) for the box; resizing the box later retains wrap mode.
- Depends on: SELECT-41, SELECT-39.

### SELECT-43: Text resize modes
- Priority: P1
- Size: S
- Interaction: `textMode: 'auto-w' | 'auto-h' | 'fixed'`. Dragging a side/corner handle on auto-w text converts to auto-h (width fixed, height flows); dragging a bottom edge converts to fixed. Double-clicking the right/bottom handle resets to auto. Corner drag with Mod scales the font size proportionally (Figma Scale-text behaviour).
- Acceptance: Resizing the width of "Ada Lovelace" wraps it and keeps font size; Mod+corner drag changes fontSize.
- Edge cases: font not loaded yet; line height rounding; text with explicit newlines.
- Depends on: SELECT-41, SELECT-14.

### SELECT-44: Line, arrow and pen tools
- Priority: P2
- Size: L
- Interaction: `L` draws a line (drag from p1 to p2; Shift snaps to 15 degree steps; a line is a shape with height 0 and a stroke), Shift+L an arrow with an end cap. `P` is the pen: click for corner points, click-drag for bezier handles, click the start point to close, Enter or Escape to finish; Alt-click changes a point type. Lines have two endpoint handles instead of the 8-handle box. Needs `stroke`, `Kind: 'line' | 'path'`.
- Acceptance: Dragging with L draws a straight line with two end handles; Shift snaps to 15 degrees; pen closes a triangle.
- Edge cases: hit-testing a thin line needs the 4 px tolerance in SELECT-2; flips for line direction; agents drawing lines (needs a `path` field).
- Depends on: SELECT-40, SELECT-12 (variant), SELECT-18.

### SELECT-45: Right-click context menu
- Priority: P1
- Size: M
- Interaction: Right-click on a shape selects it first (unless it is already part of the selection) and opens a menu at the pointer: Copy, Cut, Paste here, Duplicate (Mod+D), Delete, Bring to front / Send to back, Group, Ungroup, Frame selection, Flip horizontal / vertical, Lock / Unlock, Hide / Show, Select layer > (list of all layers under the pointer, top to bottom, Figma), Select all with same > (fill, type, font), Copy as CSS/Text (P2), and at the bottom "Ask <author> about this" (routes to the author's chat like the comment tool, `routeFor`, `Playground.tsx:195`). Right-click on empty canvas: Paste here, Select all, Show/Hide pins. Keyboard shortcuts displayed right-aligned with mac/win glyphs. Escape or click-outside closes. Uses `onContextMenu` with `preventDefault`, bound on `.pg-view`; the existing `.pg-pop` hit guard (`:279`) must include the menu.
- Acceptance: Right-click on a rect shows the menu and selects the rect; "Select layer" lists overlapping layers and selects the chosen one; actions behave as their shortcuts; menu stays on screen near viewport edges.
- Edge cases: Ctrl+click on macOS must also open it; touch long-press; menu open while an agent deletes the target (menu closes); menu over the toolbar.
- Depends on: SELECT-11, SELECT-27, SELECT-28, SELECT-29, SELECT-32, SELECT-35.

### SELECT-46: Agent selection and command API (same operations for agents and the human)
- Priority: P0
- Size: L
- Interaction: Define a transform command layer in the engine so the human gesture pipeline and scripted agents call the same functions: `select(cursorId, ids, mode)`, `move(ids, dx, dy)`, `resize(id, box, {anchor, lockRatio, fromCenter})`, `rotate(ids, deg)`, `duplicate(ids)`, `group(ids)`, `ungroup(id)`, `reorder(ids, op)`, `setLocked`, `setVisible`, `flip`, `delete`. Agents are shown manipulating: their cursor glides to the shape, a selection box in the agent's color with a name tag appears (the owner outline already exists as `Shape.owner`, `engine.ts:22`), then handles are "dragged" via `moveTo` (`engine.ts:222`) calling `resize` per frame. Agents never write raw `patch()` for geometry after this exists. The human's drag must run the same `resize` so constraints (SELECT-37) apply.
- Acceptance: `window.board.cmd.move(['a1'], 40, 0)` moves the shape and every connected subsystem (history, remote cursors) sees one command; an agent resize of a card applies the same constraint behaviour as a human one; the agent's selection box is visible in its color while it works.
- Edge cases: command on a missing id (no-op, resolved result `false`); two agents resizing the same frame (MULTI arbitration); commands must be serializable (SpacetimeDB reducer mirror).
- Depends on: SELECT-1, SELECT-40, HISTORY-*, MULTI-*.
- Multi-agent note: each command carries `by: cursorId`; remote selection boxes render thin and translucent; remote selection never changes the local one.

### SELECT-47: Spatial index and render culling for hit tests
- Priority: P1
- Size: M
- Interaction: Maintain a uniform grid or R-tree over world boxes (rebuilt incrementally on shape patch) so hover, click and marquee are sub-millisecond with 5,000 shapes (`hitTest` is currently a linear scan from the end of the array per event, `Playground.tsx:269-276`). Selection chrome renders only for visible members. Optional: no new npm dependency; a small hand-rolled grid (open question Q5).
- Acceptance: Hover over 5,000 shapes stays under 1 ms per move in the performance panel; marquee over the same board never drops below 50 fps.
- Edge cases: shapes with huge bounds; rotation (index the AABB); agents mutating 60 shapes per second (batched update).
- Depends on: SELECT-40.

### SELECT-48: Vector point-edit on double-click
- Priority: P2
- Size: L
- Interaction: Enter on a selected rect/ellipse/path or double-click enters point-edit: corner radius handles on rects (drag inner circles), anchor points on paths, Escape to exit. Corner radius drag handle appears at 4 inner positions for rects (Figma: drag to round all corners, Alt for single, Shift for ... ), showing a live `radius` pill.
- Acceptance: Dragging the inner circle on a rect changes `radius` live; Escape exits.
- Edge cases: radius clamp to half the min side; rotated rects.
- Depends on: SELECT-44, SELECT-6.

### SELECT-49: Image placement and drop
- Priority: P2
- Size: M
- Interaction: Dropping an image file on the canvas (or Mod+V with an image on the clipboard, or Mod+Shift+K to pick a file) creates an image layer at the drop point at natural size (capped at 800 px, preserving ratio, `lockRatio=true`) parented to the frame under the drop. Multiple files are laid out in a row with 24 px gaps. Images show a thumbnail while loading. Objects URLs revoke on delete.
- Acceptance: Dragging a PNG into the board creates a selected image layer at the pointer; resizing it keeps ratio without Shift.
- Edge cases: huge files (> 10 MB: reject with toast); EXIF rotation; multiplayer needs blob upload (out of scope: local-only flagged); a new `Kind: 'image'` and no new npm dependency.
- Depends on: SELECT-40, SELECT-15.

### SELECT-50: Measurement on Alt-hover (handoff to ALIGN)
- Priority: P1
- Size: S
- Interaction: While a shape is selected and the user holds Alt (no drag), hovering another shape asks ALIGN to draw red distance lines between the two. SELECT only supplies `{ selectionIds, hoverId, altDown }` through a shared `PointerContext`; it must not itself render guides. Alt press must not trigger browser focus on Windows (`preventDefault` on bare Alt keydown/up while the board has focus).
- Acceptance: The `PointerContext` is available to ALIGN's overlay with these three fields, updated each pointer move; with nothing selected `altDown` is still reported.
- Edge cases: Alt-hover on a child while the parent is selected; Alt+drag is duplicate (SELECT-24) and takes precedence once the pointer moves.
- Depends on: SELECT-7, SELECT-24; ALIGN-* consumes.

### SELECT-51: Selection persistence across commands and reload
- Priority: P2
- Size: S
- Interaction: Selection is restored after undo/redo to the set that the command acted on (HISTORY stores `selectionBefore/After` with each entry). The selection is not persisted across reloads (each tab is its own cursor; selection is presence info, optionally broadcast as a colored outline to others, MULTI).
- Acceptance: Delete, Mod+Z: the restored shape is selected; Mod+Shift+Z deselects it again.
- Edge cases: ids that no longer exist after a remote delete are filtered; selection changes are not themselves history entries.
- Depends on: SELECT-1, HISTORY-*, MULTI-*.

## Data model and architecture implications

Current `Shape` (`engine.ts:8-24`) is flat and world-positioned with no hierarchy or state flags. Everything above needs this superset (all new fields optional so the agent templates in `engine.ts:60-115` keep compiling):

```ts
export type Kind = 'frame' | 'group' | 'rect' | 'ellipse' | 'text' | 'line' | 'path' | 'image';

export type Shape = {
  // existing: id, kind, name, w, h, fill, color, text, fontSize, weight, radius, owner, author
  x: number; y: number;          // relative to parent origin once parentId is set; world for root
  parentId?: string;             // undefined = page root
  rotation?: number;             // degrees, CSS direction, about center
  flipX?: boolean; flipY?: boolean;
  locked?: boolean; visible?: boolean;   // visible undefined = true
  clip?: boolean;                // frames; default true
  constraintX?: 'left' | 'right' | 'center' | 'stretch' | 'scale';
  constraintY?: 'top' | 'bottom' | 'center' | 'stretch' | 'scale';
  lockRatio?: boolean;
  textMode?: 'auto-w' | 'auto-h' | 'fixed';
};
// Sibling order: keep one flat array but add `z: number` fractional index per parent
// (fractional indexing so concurrent reorders from several cursors do not collide).
// Alternative: Map<parentId, id[]>. Recommended: fractional `order: string`.

type Selection = { ids: string[]; scope: string | null };
type Gesture =
  | { mode: 'idle' }
  | { mode: 'pressed'; sx: number; sy: number; hit: string | null; shift: boolean }
  | { mode: 'move' | 'resize' | 'rotate' | 'marquee' | 'create' | 'pan'; orig: Map<string, Shape>; handle?: Handle; start: Pt; mods: Mods };
type Mods = { shift: boolean; alt: boolean; mod: boolean; space: boolean }; // read live from the latest event
type Handle = 'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'|{ rot: 'ne'|'nw'|'se'|'sw' };
```

Architecture notes:

- **Commands, not setState.** Introduce `engine.cmd.*` (SELECT-46). Each command takes `(by: string, ...)`, produces a `Patch[]` (`{ id, before, after }`), and hands it to a single `apply(patches)` which updates React state, notifies HISTORY, and (later) the SpacetimeDB mirror. Dragging calls `cmd.resize` per frame with the **original** snapshot (`orig`) so results are pure functions of `(orig, pointer, mods)` and Escape just re-applies `orig`.
- **Pure geometry module** `dashboard/src/playground/geometry.ts` (no React): `worldBox`, `rotatePoint`, `resizeBox(orig, handle, pointer, {lockRatio, fromCenter, rotation})`, `applyConstraints(child, oldParent, newParent)`, `union(boxes)`, `boxesIntersect`, `hitShape(shape, pt)`. Unit-test it with vitest (already a dashboard dev dependency? flagged in Q6). The Playground component stays a thin renderer.
- **Rendering.** Nest DOM by parent for transform and clip composition (`<div class="pg-shape">` children inside parents) rather than flat-with-matrix; clip is then `overflow: hidden` on frames. Selection chrome is rendered outside the world transform in screen space (positions computed via `cam`) so handle size, pill and rotation ring never scale with zoom (today they use `/ z`, `Playground.tsx:628`; both approaches work, but rotated chrome is simpler in screen space).
- **Hit testing** lives in the geometry module and honours scope, lock, visibility, rotation and ellipse/radius shape; backed by SELECT-47's grid.
- **Pointer context** `{ cursorId, selection, hoverId, mods, gesture }` is a ref exposed to ALIGN, MULTI and the engine so measurement, snapping and remote presence do not reach into `Playground` state.
- **Agents** receive world-coordinate helpers (`toLocal(parentId, x, y)`) so templates stay authored in frame-relative offsets (`engine.ts:296-317` already computes `ox + el.x`); `drag()` (`engine.ts:281-288`) must call `cmd.create`/`cmd.resize` instead of `addShape`/`patch`.
- **Keyboard** handling moves to one `keymap.ts` table `(chord, handler, guards)` using `e.code` for punctuation (brackets) and platform-aware `Mod`; the existing guard for input/textarea targets (`Playground.tsx:172`) and the swallowing of modifier combos (`:184`) must be replaced so Mod shortcuts work.
- **Perf.** `setShapes(map)` on every pointermove copies the whole array (`Playground.tsx:339-352`); with many agents this must batch per animation frame and use `memo` keys (already memoized `ShapeView`, `:602`).

## Open questions

1. **Hierarchy storage (SELECT-40).** Flat `Shape[]` plus `parentId` and fractional `order` vs a nested tree. Recommended: flat with `parentId` + fractional `order` (simpler diffing, maps 1:1 to SpacetimeDB rows).
2. **Local vs world coordinates for children.** Recommended: local (relative to parent), with `worldBox()` helper; agents keep a world-coordinate shim.
3. **Duplicate offset (SELECT-23).** Figma duplicates in place (offset 0 for a first Mod+D, then repeats the last move delta). Recommended: +16,+16 for the first duplicate so the copy is visible in a demo.
4. **Empty-canvas drag: marquee or pan?** Today it pans (`Playground.tsx:318-322`). Figma marquees and pans with Space/trackpad. Recommended: marquee (SELECT-8); pan stays on Space-drag, middle button, Hand tool, scroll.
5. **Spatial index dependency (SELECT-47).** Hand-rolled grid (no dependency) or `rbush`. Recommended: hand-rolled grid; revisit only if profiling demands it.
6. **Unit tests.** The dashboard may not have vitest configured; adding it is a new dev dependency. Recommended: yes, `vitest` as dev dependency only, for `geometry.ts` (needs human approval).
7. **Frame default clip and child scaling (SELECT-36).** Recommended: clip on, children do not scale; Scale tool (K) is P2.
8. **Rotation sign convention.** Figma displays counterclockwise-positive. Recommended: store CSS clockwise-positive, display Figma-style at the UI boundary.
9. **Who wins when the human drags a shape an agent is currently drawing?** Recommended: the human wins, the agent's step aborts gracefully and re-plans (MULTI to confirm).
10. **Tool lock (draw repeatedly).** Recommended: double-tap the tool key, P1, small.
