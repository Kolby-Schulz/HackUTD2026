# Layers panel, properties inspector, text and styling

Scope: the left layers tree (`LAYERS-*`), the right properties inspector with all styling (`PROPS-*`), and text layers, editing and typography (`TEXT-*`). It also covers shared styles and tokens, export settings (settings only) and component/instance basics. It leaves canvas gesture mechanics (marquee, drag, resize handles, selection store) to SELECT, undo/redo and history entries to HISTORY, agent chat and presence to MULTI, the export pipeline to SHARE, and scene/document storage to SCENE. Figma behaviour is the bar; where Figma differs from Penpot or Claude Design the Figma behaviour is chosen.

## Today
- Document model is a flat array of `Shape` with absolute coordinates and no `parentId`, no z-index field, no lock/hide flags (`engine.ts:7-24`). Kinds are only `frame | rect | ellipse | text` (`engine.ts:6`).
- Styling fields are `fill` (string), `color` (text only), `fontSize`, `weight`, `radius` (single number). No stroke, effects, opacity, rotation, alignment, line height, font family (`engine.ts:13-18`). Templates author agents' designs as frames plus flat children (`engine.ts:55-114`); `'A'`/`'a'` are accent placeholders resolved at write time.
- Layers panel is a flat list, reversed array order, capped at 400 rows, no nesting, no expand/collapse, no drag, no rename, no search (`Playground.tsx:440-446`). Row = icon, name (text content for text layers), owner dot (`Playground.tsx:642-650`; styles `playground.css:40-47`). Clicking a row selects; there is no multi-select and no scroll-into-view.
- There is no properties inspector at all; the left panel switches between chat and layers (`Playground.tsx:434-446`). Selection UI shows only a 4-corner handle box and a W x H label (`Playground.tsx:626-641`).
- Text: the T tool creates a 200x24 text with empty content and starts editing (`Playground.tsx:303-304`); double-click on a text layer enters edit (`Playground.tsx:363-366`). Editing is a `<textarea>` over the layer committed on blur; Enter (without Shift) and Esc both commit (`Playground.tsx:613-616`), so Enter cannot insert a newline. Text renders with `white-space: pre-wrap`, line-height 1.2 hard-coded, height `auto` with `minHeight` (`playground.css:80-81`, `Playground.tsx:609`). No autosize modes: agents guess `h` in templates, so boxes do not fit content.
- Frame names render as a label above the frame scaled by 1/zoom (`Playground.tsx:611`); owner outline is drawn by `.pg-owned` (`Playground.tsx:617-621`).
- Agents edit through `patch` and `addShape` on the engine (`engine.ts:191,460`), and a tiny intent parser maps chat text to fill, size, radius, weight, text patches (`engine.ts:122+`).

## Features

Priority legend as in the template. IDs are stable; split large features rather than renumbering.

### LAYERS-1: Nested layer tree
- Priority: P0
- Size: L
- Interaction: Left panel lists the document as a tree, topmost z-order first (Figma order: last child of a parent = top row). Frames and groups are parents; children indent 16px per depth level with a 12px chevron gutter. Rows are 28px high, 12px text, icon 16px.
- Acceptance: Children of a frame render under it, indented. A shape moved into a frame appears under that frame. Z-order in the tree matches canvas stacking.
- Edge cases: Orphaned parentId (parent deleted by another agent) is re-parented to the page root. Cycles are rejected. Depth >12 clamps indent at 12 levels.
- Depends on: SCENE-* (parentId in the document), LAYERS-3

### LAYERS-2: Per-kind icons
- Priority: P0
- Size: S
- Interaction: Icon by kind at 16px: frame (hash), group (folder-ish square), rect, ellipse, text (T), image, component (diamond, purple), instance (hollow diamond), vector. Icon tints with the layer's accent when selected. Frame with auto-layout shows the layout glyph (P2).
- Acceptance: Each Kind has a distinct icon. Component and instance icons are purple. Replaces the glyph map KIND_ICON used at Playground.tsx:644.
- Edge cases: Unknown kind falls back to a generic square.
- Depends on: LAYERS-1

### LAYERS-3: Expand and collapse
- Priority: P0
- Size: S
- Interaction: Chevron click toggles one parent; Alt+click toggles it and all descendants; Shift+Cmd+L is not used. Selecting a layer on the canvas auto-expands its ancestors (LAYERS-9). Expanded state is per-viewer UI state, not synced. Default: top-level frames expanded one level.
- Acceptance: Chevron toggles children. Alt+click expands the subtree. Collapsed parent hides rows but keeps its own selected highlight if a hidden descendant is selected (parent row shows a lighter tint).
- Edge cases: Collapsing a parent whose child is selected keeps the selection. 1000-child frame collapses without a long frame.
- Depends on: LAYERS-1

### LAYERS-4: Click and range select in tree
- Priority: P0
- Size: M
- Interaction: Click selects one (replaces). Cmd/Ctrl+click toggles. Shift+click selects the visible range between the anchor row and the clicked row. Click on empty panel space clears the selection. Selection is the same set the canvas uses.
- Acceptance: Shift-click selects a contiguous range of visible rows. Cmd-click adds/removes. Canvas selection handles show for the whole set.
- Edge cases: Range across collapsed parents selects the collapsed parent only, not hidden children (Figma behaviour).
- Depends on: SELECT-* (selection store), LAYERS-1

### LAYERS-5: Canvas to tree selection sync
- Priority: P0
- Size: S
- Interaction: When selection changes on the canvas, the tree expands ancestors, highlights rows (blue #e5f4ff band; descendants of a selected frame get a lighter tint) and scrolls the first selected row into view with minimal movement (no centering unless off-screen).
- Acceptance: Click a deep shape on the canvas: its row is highlighted and visible without manual scrolling.
- Edge cases: Selection driven by an agent does not scroll the human's panel (see LAYERS-30). Multi-select scrolls to the topmost row.
- Depends on: LAYERS-3, SELECT-*

### LAYERS-6: Tree to canvas selection sync
- Priority: P0
- Size: S
- Interaction: Selecting in the tree selects on the canvas; double-click on a row's icon zooms the camera to fit the layer (Shift+2 equivalent). Hovering a row draws a 1px hover outline on the canvas shape.
- Acceptance: Hover over a row outlines the shape on the canvas. Clicking a row of a layer deep in a frame selects it directly (no double-click drilling).
- Edge cases: Hidden layers can be selected in the tree but have no canvas outline; show a dashed bounding box instead.
- Depends on: LAYERS-4

### LAYERS-7: Rename by double-click
- Priority: P0
- Size: S
- Interaction: Double-click on the name (or F2, or Enter with one layer selected) turns the label into an input with all text selected. Enter commits, Esc reverts, blur commits. Empty commit reverts to the previous name. Names are plain text, max 256 chars.
- Acceptance: Rename updates the row and any canvas frame title. Text layers default their name to their content until renamed (Figma auto-name), after which the name sticks.
- Edge cases: Rename while an agent changes the same name: last-writer-wins, the input shows a toast 'renamed by Iris'. Pressing Tab commits and renames the next sibling (P2).
- Depends on: LAYERS-4
- Multi-agent note: Agents rename via the same command; owner chip is unaffected.

### LAYERS-8: Lock and hide toggles
- Priority: P0
- Size: M
- Interaction: On row hover (or always when active) two 16px icon buttons appear at the right: lock (Shift+Cmd+L) and eye (Shift+Cmd+H). Locked/hidden state always stays visible once set, even without hover. Alt+click an eye solos it (hides all siblings). Locking a parent locks descendants visually (dimmed, not individually flagged). Hidden layers render at 0 and are excluded from hit-testing; locked layers are excluded from canvas click and marquee but selectable in the tree.
- Acceptance: Click eye: shape disappears from the canvas and the icon stays. Locked shapes cannot be dragged. Cmd+Shift+H toggles on selection.
- Edge cases: Hiding a parent hides children without altering their own flag. Drag-drag across eye icons sets many (Figma drag-to-toggle, P1).
- Depends on: LAYERS-1, SELECT-*
- Multi-agent note: Agents must refuse to edit locked layers and report in chat; human lock is the way to fence off a region from agents.

### LAYERS-9: Scroll-into-view and reveal
- Priority: P0
- Size: S
- Interaction: API revealLayer(id): expand ancestors, scroll the row into view, flash the row background once (600ms). Used by canvas selection, chat 'show layer' links (see focusShape) and search results.
- Acceptance: Calling reveal on a collapsed deep layer shows it. Flash is visible once.
- Edge cases: Row inside a virtualised window not rendered yet: scroll offset computed from the flattened visible list index.
- Depends on: LAYERS-3, LAYERS-20

### LAYERS-10: Drag to reorder
- Priority: P0
- Size: L
- Interaction: Mouse down + 4px move starts a drag with a ghost row (60% opacity) under the cursor. A 2px blue insertion line shows between rows at the pointer's half-row split; indentation of the line shows the target depth. Dropping commits a z-order change. Esc cancels. Autoscroll at 32px from panel top/bottom edges (up to 16px/frame).
- Acceptance: Dragging a row between two siblings moves it on the canvas stacking. Insertion line renders at the right indent.
- Edge cases: Cannot drop a layer into itself or its descendants (no-drop cursor, no line). Dragging a multi-selection moves all in their current relative order. Drop onto locked parent is refused.
- Depends on: LAYERS-1, HISTORY-*
- Multi-agent note: Concurrent reorder by an agent: the drop is resolved by parentId + index at commit time, using the latest sibling list.

### LAYERS-11: Drag to reparent
- Priority: P0
- Size: M
- Interaction: Dropping on the middle third of a frame/group row (blue outline round the row, not a line) makes it the last child (top of z). Dropping on the top/bottom third inserts before/after. Hovering a collapsed parent for 600ms auto-expands it. Reparenting preserves the visual position: x/y are converted between parent coordinate spaces.
- Acceptance: Dragging a rect onto a frame row nests it and it does not jump on the canvas. Dropping on empty panel space moves it to page root top.
- Edge cases: Dropping into a clip-content frame can visually clip it; show a one-line toast the first time. Rotated parents (P2) need matrix conversion.
- Depends on: LAYERS-10, SCENE-* (coordinate conversion)

### LAYERS-12: Reorder shortcuts
- Priority: P0
- Size: S
- Interaction: Cmd+] bring forward, Cmd+[ send backward, Cmd+Alt+] to front, Cmd+Alt+[ to back. Operates among siblings. Works on multi-selection preserving relative order.
- Acceptance: After Cmd+Alt+] the row is the first in its parent group and the canvas shows it on top.
- Edge cases: Already-top: no-op, no history entry.
- Depends on: LAYERS-10

### LAYERS-13: Group, ungroup, frame wrap
- Priority: P0
- Size: M
- Interaction: Cmd+G wraps selection in a group at the selection bounding box (named 'Group N'); Shift+Cmd+G ungroups, children take the group's index; Cmd+Alt+G wraps in a frame ('Frame N'). New group sits at the top-most selected item's index and selects itself.
- Acceptance: Select 3 shapes, Cmd+G: one group row appears and the 3 rows are nested under it. Ungroup restores them.
- Edge cases: Mixed parents: group created under the common ancestor, items re-parented with coordinate conversion. Single text layer + Cmd+Alt+G makes a hug-size frame.
- Depends on: LAYERS-1, HISTORY-*

### LAYERS-14: Search and filter
- Priority: P1
- Size: M
- Interaction: Cmd+F (when panel focused) or a search field at the top of the panel. Typing filters live (100ms debounce) by name substring, case-insensitive; matches also search a text layer's content. Result rows are shown flat with the ancestor breadcrumb in muted text. Chips: kind (frame/text/image...), owner agent, locked, hidden. Esc clears.
- Acceptance: Typing 'button' shows only matching rows; clearing restores the tree and expansion state.
- Edge cases: 1000 matches: still virtualised. Zero matches: 'No layers match'.
- Depends on: LAYERS-1, LAYERS-20

### LAYERS-15: Context menu on rows
- Priority: P1
- Size: M
- Interaction: Right-click opens a menu (also on canvas). Items: Copy, Paste here, Duplicate (Cmd+D), Rename (Enter), Group, Ungroup, Frame selection, Bring/Send, Hide, Lock, Show/hide only this, Copy/Paste properties (Cmd+Alt+C / V), Use as mask (P2), Create component (P2), Ask <agent> about this layer (opens chat with shape pinned), Delete.
- Acceptance: Right-click on an unselected row selects it first. Each item shows its shortcut, disabled items are greyed.
- Edge cases: Right-click on a multi-selection acts on all. Menu flips to stay inside the viewport.
- Depends on: LAYERS-4, MULTI-*

### LAYERS-16: Owner and editing indicators
- Priority: P0
- Size: M
- Interaction: A row shows a coloured 7px dot of the agent that is editing it (as the engine's owner field does today) and a name chip on hover. Row of an ancestor shows a hollow ring when a descendant is being edited so activity is visible while collapsed. Dot pulses while the agent has the pointer down.
- Acceptance: When Iris drags a rect, its row shows Iris's colour. Collapsed ancestors show the hollow ring.
- Edge cases: Two agents editing the same layer: stacked dots, max 3 then '+n'. Dot disappears 1s after the last edit.
- Depends on: LAYERS-1, MULTI-*
- Multi-agent note: Core multi-agent feature: the panel is the activity feed in spatial form.

### LAYERS-17: Author badge and recent activity
- Priority: P1
- Size: S
- Interaction: Tooltip on a row shows 'Created by Juno · edited by Nova 12s ago'. Optional sort mode 'Recently edited' for flat list.
- Acceptance: Hover shows author and last editor with relative time.
- Edge cases: Author cursor no longer exists: show the stored name with grey dot.
- Depends on: LAYERS-16

### LAYERS-18: Row inline preview and thumbnails
- Priority: P2
- Size: M
- Interaction: For frames, hover shows a 160px thumbnail popover after 400ms. Components show their thumbnail instead of the icon.
- Acceptance: Hover on a frame row shows a rendered preview.
- Edge cases: Huge frames: thumbnail is rasterised lazily and cached by version.
- Depends on: LAYERS-1

### LAYERS-19: Text layer rows show content
- Priority: P0
- Size: S
- Interaction: Text layers show their content (first line, 40 chars) as the label unless explicitly renamed (as LayerRow does at Playground.tsx:645, but with auto-name flag so a rename sticks). Empty text shows 'Text' in muted italics.
- Acceptance: Edit the text, the row updates live. After a rename it no longer follows the text.
- Edge cases: Newlines collapse to a space in the row.
- Depends on: LAYERS-7, TEXT-1

### LAYERS-20: Virtualised list
- Priority: P0
- Size: M
- Interaction: Flatten the visible tree into an array, render only rows in the viewport plus 10 overscan, absolute positioned in a spacer of rowCount*28px. No new dependency (hand-rolled windowing); if react-window is wanted, flag it. Replaces the current slice(0,400) cap (Playground.tsx:442).
- Acceptance: 10,000 layers scroll at 60fps; expanding a 5000-child frame does not hang; rows >400 are reachable.
- Edge cases: Variable row heights are not allowed (fixed 28px). Rename input stays mounted when scrolled out (blur commits).
- Depends on: LAYERS-1

### LAYERS-21: Keyboard navigation
- Priority: P1
- Size: S
- Interaction: With the panel focused: Up/Down moves selection, Shift+Up/Down extends, Left collapses or goes to parent, Right expands or goes to first child, Enter renames, Delete deletes, Cmd+A selects siblings. Tab/Shift+Tab on canvas select next/previous sibling.
- Acceptance: Arrow keys walk the tree and the canvas selection follows.
- Edge cases: Hidden rows during filter are skipped.
- Depends on: LAYERS-4

### LAYERS-22: Multi-select drag and bulk toggles
- Priority: P1
- Size: S
- Interaction: Lock/hide/rename acts on all selected when the toggled row is in the selection. Dragging one selected row drags all.
- Acceptance: Hide with 3 selected hides 3.
- Edge cases: Mixed state eyes: shows the icon for the clicked row's state.
- Depends on: LAYERS-8

### LAYERS-23: Empty and loading states
- Priority: P1
- Size: S
- Interaction: Empty page shows 'Nothing here yet. Press R, O, T or ask an agent.' Panel shows skeleton rows while the first sync loads. Replaces 'Agents are warming up…' (Playground.tsx:445).
- Acceptance: Empty board shows the hint and the keys.
- Edge cases: Offline: banner 'Offline, changes queued'.
- Depends on: LAYERS-1

### LAYERS-24: Pages
- Priority: P2
- Size: L
- Interaction: Top of the panel shows a collapsible Pages section: list, add, rename, delete, drag to reorder. Switching a page swaps the document root and camera (camera is remembered per page per viewer).
- Acceptance: Add page 'Page 2', it starts empty. Selection is cleared on switch.
- Edge cases: Deleting the current page switches to neighbour. Agents work on a specific page, show page chip on their cursor label.
- Depends on: SCENE-*, MULTI-*

### LAYERS-25: Layer panel resize and collapse
- Priority: P2
- Size: S
- Interaction: Panel width draggable 220-420px, persisted locally. Cmd+\ toggles all panels.
- Acceptance: Dragging the right edge resizes.
- Edge cases: Narrow width: the toggles overlay the name.
- Depends on: LAYERS-1

### LAYERS-26: Layer count and selection summary
- Priority: P1
- Size: S
- Interaction: Footer shows '12 layers · 3 selected'. Clicking the count opens flat mode (all layers, ignoring nesting).
- Acceptance: Footer updates on selection.
- Edge cases: With filter active shows 'n of m'.
- Depends on: LAYERS-14

### LAYERS-27: Mask and clip indicators
- Priority: P2
- Size: M
- Interaction: Rows of frames with clip content show a small clip glyph; mask layers show a mask glyph, masked siblings indent under it.
- Acceptance: Clip glyph appears if clipsContent is true.
- Edge cases: Nested clips.
- Depends on: PROPS-18

### LAYERS-28: Duplicate and paste in tree
- Priority: P1
- Size: S
- Interaction: Cmd+D duplicates in place offset +10,+10 at index above the original; Cmd+V pastes into the selected frame (centre of view if page root). Pasted names get ' copy' suffix only for Duplicate in Penpot mode; Figma keeps the name. Choose Figma.
- Acceptance: Duplicate creates a row directly above with the same name.
- Edge cases: Duplicate of a frame duplicates descendants with new ids.
- Depends on: LAYERS-1, HISTORY-*

### LAYERS-29: Drag layer out to chat
- Priority: P2
- Size: S
- Interaction: Dragging a row onto the chat panel attaches the layer as a pinned context chip (same as shapeId on a chat message).
- Acceptance: Drop creates a chip 'Hero / Headline'.
- Edge cases: Layer deleted before send: chip shows strikethrough.
- Depends on: MULTI-*

### LAYERS-30: Agent selection does not hijack the panel
- Priority: P0
- Size: S
- Interaction: Only the human's own selection drives tree highlight, expansion and scroll. Agent-selected layers show only the agent-coloured dot (LAYERS-16). Optional 'Follow Iris' mode (click an avatar) mirrors that agent's selection and viewport.
- Acceptance: While an agent selects things, the human's scroll position and expansion never change.
- Edge cases: Follow mode stops on any manual scroll.
- Depends on: LAYERS-16
- Multi-agent note: Defines the human-vs-agent boundary for all panel state.

### LAYERS-31: Component and instance rows
- Priority: P2
- Size: M
- Interaction: Components show a purple diamond; instances hollow diamond and their children are non-renameable greyed until overridden. 'Go to main component' in the context menu.
- Acceptance: Instance rows indent nested layers read-only.
- Edge cases: Missing main component: row shows a broken-link icon and Detach.
- Depends on: PROPS-25

### PROPS-1: Right inspector panel shell
- Priority: P0
- Size: M
- Interaction: Right panel 240px, sections stacked with 12px headers and dividers: Design tab (Alignment, Layer, Position, Appearance, Fill, Stroke, Effects, Export). Section header + / - buttons add/remove entries. Panel content is driven by the selection; with nothing selected shows page background colour and shared styles.
- Acceptance: Selecting a layer fills the inspector; deselect shows the page section. Sections with no value show a + only.
- Edge cases: Selection of 0, 1, many, mixed kinds. Text layers add a Typography section above Fill.
- Depends on: LAYERS-4

### PROPS-2: Position X/Y
- Priority: P0
- Size: S
- Interaction: Numeric fields X and Y relative to the parent frame (absolute for page-root layers) with the unit hidden, 1 decimal max shown (10.5), up to 2 decimals stored displayed trimmed. Arrow Up/Down in the field steps 1, Shift 10, Alt 0.1. Updates live on the canvas.
- Acceptance: Typing 120 in X moves the layer. Moving the layer on the canvas updates the field live.
- Edge cases: Nested in a frame: values are relative to the frame origin. Rotated: shows the bounding box top-left.
- Depends on: PROPS-8

### PROPS-3: Size W/H with lock ratio
- Priority: P0
- Size: M
- Interaction: W and H fields plus a chain-link toggle between them. When locked, editing one scales the other by the current ratio; the lock state is a persisted layer flag (aspect). Shift while resizing on canvas locks temporarily. Minimum size 0.01. Text layers: editing W sets fixed-width mode, H sets fixed box (see TEXT-4).
- Acceptance: Lock then set W=200 on a 100x50 layer gives H=100. Unlock gives free resize.
- Edge cases: Zero or negative: clamps to 0.01. Children of a frame without constraints keep absolute size (constraint scaling is P2).
- Depends on: PROPS-8

### PROPS-4: Rotation field
- Priority: P1
- Size: S
- Interaction: Angle in degrees, range -180..180 (entry wraps, 270 becomes -90), counter-clockwise positive like Figma. Rotates around the centre. Includes a 'flip horizontal / vertical' button pair (Shift+H, Shift+V).
- Acceptance: Rotation 45 rotates the layer around its centre; X/Y report the bounding box.
- Edge cases: Rotated frames with children: children rotate with it. Text stays editable in rotated state.
- Depends on: PROPS-8, SELECT-* (rotate handle)

### PROPS-5: Corner radius
- Priority: P0
- Size: S
- Interaction: Single radius field with a corner icon, applies to rect and frame. Value is clamped to min(w,h)/2 on render but kept as typed. Shape renders with the border-radius used today (Playground.tsx:604-608), ellipses ignore it.
- Acceptance: Radius 16 rounds the rect. Dragging the on-canvas radius handle updates the field.
- Edge cases: Mixed selection of different radii shows 'Mixed'.
- Depends on: PROPS-8

### PROPS-6: Independent corner radius
- Priority: P1
- Size: M
- Interaction: Toggle button next to radius expands to four fields (TL, TR, BR, BL). Collapsing with differing values keeps them until a single value is typed. Stored as radii: [tl,tr,br,bl].
- Acceptance: Setting TL=0 and others 24 renders a tab shape.
- Edge cases: Rect resized smaller than radii: proportional clamp as in CSS.
- Depends on: PROPS-5

### PROPS-7: Number field engine
- Priority: P0
- Size: M
- Interaction: One shared <NumberField> component: Enter or blur commits, Esc reverts and blurs, Tab commits and moves to the next field, ArrowUp/Down step (1, Shift 10, Alt 0.1), Cmd+A selects all, click selects all text. Invalid input reverts silently with a brief red flash. Optional unit suffixes (px, deg, %). Live preview: the canvas updates on each valid keystroke (debounced to a frame), committing one history entry on Enter/blur.
- Acceptance: Typing '24' updates the canvas as '2' then '24' and creates one undo step. Esc restores the original value on canvas.
- Edge cases: IME input; paste of '1,5' (locale comma) reads as 1.5; huge values clamp to +-1e6.
- Depends on: HISTORY-*

### PROPS-8: Arithmetic and units in number fields
- Priority: P0
- Size: S
- Interaction: Fields evaluate expressions on commit: '100+20' -> 120, '2*50', '(10+5)/3', '50%' -> 50% of the current value (relative), '+10' and '-10' relative adds, 'w/2' not supported (P2). Safe hand-written parser (no eval). Result rounds to 2 decimals. Unit text 'px' is stripped.
- Acceptance: '100+20' commits 120. '50%' on 200 gives 100. Garbage reverts.
- Edge cases: Division by zero reverts. In multi-select, '+10' applies to each layer's own value.
- Depends on: PROPS-7

### PROPS-9: Scrub value by dragging the label
- Priority: P1
- Size: M
- Interaction: Pointer down on a field's icon/label (cursor changes to ew-resize) and drag horizontally: 1 unit per 1px, Shift x10, Alt x0.1; pointer lock so the cursor wraps at the screen edge. Release commits one history entry. Works for opacity, rotation, radius, X/Y, W/H, font size.
- Acceptance: Dragging the W label right widens the layer live.
- Edge cases: Touch devices: not available. Cursor visible during drag.
- Depends on: PROPS-7

### PROPS-10: Mixed values on multi-select
- Priority: P0
- Size: M
- Interaction: With >1 layer, a field shows the common value or the word 'Mixed' as a placeholder; typing replaces all. For X/Y/W/H on a multi-selection the values are of the selection bounding box (moving moves the group). Colours show a 'Mixed' swatch with a diagonal split and a count; clicking opens the list of distinct values (P2).
- Acceptance: Select two rects of differing radius: field reads 'Mixed'; type 8: both become 8.
- Edge cases: Mixed kinds: hide inapplicable sections (e.g. typography only when all are text, with a partial section when at least one is).
- Depends on: PROPS-1

### PROPS-11: Fill: solid colour
- Priority: P0
- Size: M
- Interaction: Fill row: 16px swatch (opens picker), hex input (6-digit, accepts 3-digit, with or without #, uppercase display), opacity % input, eye toggle, minus to remove. Multiple fills stack (top first, P1); MVP supports one. Replaces the single fill string (engine.ts:13).
- Acceptance: Typing 'f24e1e' sets the fill. Opacity 50% makes the fill translucent without changing layer opacity.
- Edge cases: Hex with alpha (8 digits) is split into colour+opacity. Fill 'transparent' shows a checkerboard swatch.
- Depends on: PROPS-7, PROPS-12

### PROPS-12: Colour picker popover
- Priority: P0
- Size: L
- Interaction: Popover anchored left of the panel: saturation/brightness square, hue slider, alpha slider, mode select (Hex, RGB, HSL, HSB), numeric fields, recent colours row, document colours row, style swatches. Dragging updates live; Esc closes and keeps; popover is draggable by its header.
- Acceptance: Dragging in the square changes the layer live. Reopen shows the same colour at the right spot.
- Edge cases: Greys (s=0) keep hue when moved; colours outside sRGB not supported. Picker open while an agent changes the fill: field updates, no jump of the knob during drag.
- Depends on: PROPS-11

### PROPS-13: Recent and document colours
- Priority: P1
- Size: S
- Interaction: Recent colours (last 10, per viewer, localStorage) updated on picker close. 'Document colours' lists the distinct colours in the doc by use count, first 16.
- Acceptance: Used colours appear first in the recent row.
- Edge cases: Agent colours count in document colours but not in recents.
- Depends on: PROPS-12

### PROPS-14: Eyedropper
- Priority: P2
- Size: M
- Interaction: Eyedropper button uses the browser EyeDropper API (Chromium) with fallback of sampling a canvas colour (hidden when unsupported). Press I to activate. Click samples the pixel under the pointer including other layers.
- Acceptance: Click on a swatch on the canvas sets the fill.
- Edge cases: Unsupported browser: button hidden. Open question whether canvas is DOM or bitmap.
- Depends on: PROPS-12

### PROPS-15: Gradient fills
- Priority: P2
- Size: L
- Interaction: Fill type dropdown: Solid, Linear, Radial, Angular, Image. Linear editor with stops (add by click on bar, drag, delete by dragging off), per-stop colour and opacity, angle handle on canvas. Maps to CSS gradients for DOM rendering.
- Acceptance: Two-stop linear gradient renders on a rect.
- Edge cases: Stop positions crossing; ellipses; text with gradient (background-clip).
- Depends on: PROPS-12

### PROPS-16: Stroke
- Priority: P0
- Size: M
- Interaction: Stroke row: colour swatch, hex, opacity, weight field (default 1), align Inside / Center / Outside (3 toggle icons), eye, minus. Rendering by align: inside = inset box-shadow or SVG clip, outside = outline, center = border straddling. Strokes affect layout bounds only in P2 (Figma ignores them for bounds).
- Acceptance: Add stroke -> 1px #000 inside. Weight 4 and Outside draws outside the box.
- Edge cases: Ellipse and rounded corner strokes follow the radius. Zoomed-out hairlines stay >=1 device px.
- Depends on: PROPS-11

### PROPS-17: Stroke dashes, caps, joins
- Priority: P2
- Size: M
- Interaction: Advanced stroke popover: dash and gap lengths, cap (none/round/square), join (miter/bevel/round), per-side weights for rects (top/right/bottom/left).
- Acceptance: Dash 4/4 shows a dashed outline.
- Edge cases: Per-side weights with radius.
- Depends on: PROPS-16

### PROPS-18: Clip content (frames)
- Priority: P0
- Size: S
- Interaction: Frames have a 'Clip content' checkbox, on by default. Off lets children overflow the frame. Maps to overflow hidden.
- Acceptance: Toggling the checkbox shows/hides overflowing children.
- Edge cases: Nested clipped frames; selection handles of clipped children still show.
- Depends on: LAYERS-1

### PROPS-19: Layer opacity
- Priority: P0
- Size: S
- Interaction: Opacity % field in the Layer section (also number keys: 1 = 10% up to 9 = 90%, 0 = 100%). Multiplies fill alpha, affects children.
- Acceptance: Pressing 5 sets 50%. Field accepts arithmetic.
- Edge cases: Opacity 0 stays selectable. Group opacity is composite not per-child.
- Depends on: PROPS-7

### PROPS-20: Blend mode
- Priority: P2
- Size: S
- Interaction: Dropdown of Normal, Darken, Multiply, Colour burn, Lighten, Screen, Overlay, Soft light, Difference, Hue, Saturation, Colour, Luminosity... Maps to mix-blend-mode. Pass through for groups.
- Acceptance: Multiply darkens against the layer below.
- Edge cases: Blend inside isolated frames.
- Depends on: PROPS-19

### PROPS-21: Drop shadow and inner shadow
- Priority: P0
- Size: M
- Interaction: Effects section + adds Drop shadow (x0,y4,blur 4,spread 0, #000 25%). Settings popover: X, Y, Blur, Spread, colour, opacity. Multiple effects stacked, each toggle-able. Renders as box-shadow (inset for inner). Text layers use filter: drop-shadow.
- Acceptance: Adding a drop shadow shows it under the layer; changing blur updates live.
- Edge cases: Shadow on a clipped frame's children; shadow on 50% opacity layer.
- Depends on: PROPS-12

### PROPS-22: Layer blur and background blur
- Priority: P1
- Size: M
- Interaction: Effects: Layer blur (filter: blur(px)) and Background blur (backdrop-filter). Value in px, 0-250.
- Acceptance: Blur 8 softens the layer.
- Edge cases: Performance when many layers have blur: warn above 20.
- Depends on: PROPS-21

### PROPS-23: Export settings per layer
- Priority: P1
- Size: M
- Interaction: Export section: + adds a row with scale (0.5x, 1x, 2x, 3x, 4x, custom 512w/512h), suffix, format (PNG, JPG, SVG, PDF, WebP). 'Export <layer>' button runs the export. The per-layer settings are stored on the layer; the pipeline itself belongs to SHARE.
- Acceptance: Add 2x PNG row and the settings persist on reload.
- Edge cases: Zero-size layer; export of hidden layer exports it visible (Figma).
- Depends on: SHARE-*

### PROPS-24: Shared colour and text styles
- Priority: P1
- Size: L
- Interaction: Style library in the document: colour styles (name, paints) and text styles (font settings). Fill/text sections show a four-dot style button; picking a style links the layer (shows the style name instead of the hex). Editing a style updates all linked layers. Detach with the unlink button. Rename with slashes creates groups ('Brand/Primary').
- Acceptance: Create a style from a fill, link a second layer, edit style: both change.
- Edge cases: Deleted style: layers keep resolved values. Agent may reference styles by name.
- Depends on: PROPS-11, TEXT-8
- Multi-agent note: Agents are told the style list in their context so they reuse tokens instead of raw hex.

### PROPS-25: Components and instances
- Priority: P2
- Size: L
- Interaction: Cmd+Alt+K make component (layer becomes component, same id retained as main). Instances are created from the assets panel or Alt-drag; they follow the main for non-overridden properties. Overrides: fill, text, size, visibility. Detach instance (Cmd+Alt+B), reset overrides, go to main.
- Acceptance: Edit main fill: instances update. Override an instance text: stays on edit of main fill.
- Edge cases: Nested instances, deleting main.
- Depends on: LAYERS-31

### PROPS-26: Tab order and focus
- Priority: P0
- Size: S
- Interaction: Tab order in the panel follows visual order (X, Y, W, H, rotation, radius, opacity, fill hex, fill opacity, stroke...). Tab commits the current field and focuses next with text selected. Escape in a field blurs and returns focus to the canvas. Canvas shortcuts are disabled while an input has focus (see the input check at Playground.tsx:172).
- Acceptance: Tab walks all fields in order.
- Edge cases: Hidden sections are skipped.
- Depends on: PROPS-7

### PROPS-27: Constraints and alignment
- Priority: P1
- Size: M
- Interaction: Alignment row of 6 buttons (left, centre, right, top, middle, bottom) aligning selection to the selection bounds or, for a single layer, to its parent frame. Distribute spacing appears with 3+ layers. Constraints widget (left/right/top/bottom/scale) P2.
- Acceptance: Select two rects, click align left: x equal.
- Edge cases: Single layer on page root aligns to nothing (disabled).
- Depends on: PROPS-2, HISTORY-*

### PROPS-28: Live agent edits update inspector
- Priority: P0
- Size: S
- Interaction: Inspector subscribes to the selected layer; if an agent patches a property the field updates immediately and flashes its background in the agent's colour for 600ms. A field being edited by the human is not overwritten; a small agent-colour dot appears on the field and Enter wins.
- Acceptance: Agent turns the fill blue while the layer is selected: swatch updates and flashes.
- Edge cases: Both edit the same field in the same frame: human commit wins, agent diff shown as a toast.
- Depends on: PROPS-7, MULTI-*
- Multi-agent note: Core to the demo: the human watches the numbers change as agents work.

### PROPS-29: Read-only inspection of locked layers
- Priority: P1
- Size: S
- Interaction: Locked layers show their values in the inspector with disabled fields and a 'Locked' banner with unlock button.
- Acceptance: Fields are disabled on a locked layer.
- Edge cases: Mixed locked/unlocked selection: fields editable, locked layers skipped, count shown.
- Depends on: LAYERS-8

### PROPS-30: Copy and paste properties
- Priority: P2
- Size: S
- Interaction: Cmd+Alt+C copies appearance (fill, stroke, effects, radius, text style) of the selection; Cmd+Alt+V applies it to the selection.
- Acceptance: Pasted fill matches.
- Edge cases: Copy from a text layer to a rect applies only common properties.
- Depends on: PROPS-11

### PROPS-31: Inspect (dev) view
- Priority: P2
- Size: M
- Interaction: Toggle to read-only CSS output for the layer (position, size, colours as CSS vars, fonts), copy buttons.
- Acceptance: CSS for a rect shows width, height, border-radius, background.
- Edge cases: Mixed values.
- Depends on: SHARE-*

### PROPS-32: Auto layout section basics
- Priority: P2
- Size: L
- Interaction: Add auto layout (Shift+A): direction, gap, padding, alignment, hug/fill/fixed sizing. Rows in the inspector under Layout. Left to a future AUTOLAYOUT domain; this is the inspector slot only.
- Acceptance: Section renders when layout is set.
- Edge cases: Absolute children inside auto layout.
- Depends on: SCENE-*

### TEXT-1: Create text with T tool
- Priority: P0
- Size: S
- Interaction: T then click creates an auto-width text layer at the click with caret, empty content; click-drag creates a fixed-width box. Esc or click elsewhere with empty content deletes the layer. Today: creation at Playground.tsx:303-304.
- Acceptance: Click makes an editable empty text; typing shows glyphs; clicking away keeps it.
- Edge cases: Empty text left behind is removed automatically (no empty ghost layers).
- Depends on: SELECT-*

### TEXT-2: Inline editing on double click
- Priority: P0
- Size: M
- Interaction: Double-click a text layer (or Enter with it selected) enters edit mode: the DOM element becomes contentEditable (or textarea) at the same pixel size, selection handles hide, caret at the click point. Double-click selects a word, triple-click a paragraph, Cmd+A all. Esc or click outside exits and commits. Today: textarea + onBlur (Playground.tsx:613-616).
- Acceptance: Double-click puts the caret where clicked. Esc exits and the layer remains selected.
- Edge cases: Zoomed in at 400% and out at 10%: font stays crisp and the caret scales. Nested in rotated frames: editing box rotates. Enter inserts a newline (today it commits; change that, Cmd+Enter commits).
- Depends on: LAYERS-1

### TEXT-3: Caret and selection behaviour
- Priority: P0
- Size: M
- Interaction: Native text editing: arrows, Shift-select, Alt/Cmd word and line jumps, Home/End, Cmd+B/I/U on selection (P2 rich), drag-select, double-click drag extends by word. Selection highlight uses the accent colour. Pointer events inside the editor do not pan or move the layer.
- Acceptance: Drag inside the text selects text instead of moving the shape.
- Edge cases: Dragging out of the box continues selecting. Wheel inside zooms the canvas (Cmd) or pans, never scrolls the editor.
- Depends on: TEXT-2

### TEXT-4: Resize modes: auto width, auto height, fixed
- Priority: P0
- Size: M
- Interaction: Three icons in the Typography section. Auto width: box grows with the text, one line unless newline. Auto height: width fixed, height follows wrapping. Fixed: both fixed, overflow clipped by default. Dragging a side handle on canvas switches to auto height; dragging a corner to fixed; double-clicking the handle resets to auto width. Mode stored as textMode.
- Acceptance: Changing to auto width collapses a wrapped paragraph to one line. Dragging the right handle sets auto height.
- Edge cases: Min width one em. Empty text in auto width keeps a 2px caret box.
- Depends on: PROPS-3

### TEXT-5: Font family
- Priority: P0
- Size: M
- Interaction: Font dropdown with a search field, shows each name in its own face. Initial list: system UI stack, Inter, Roboto, Georgia, Times, Menlo/monospace, plus a few web fonts (Inter, DM Sans, Playfair Display, JetBrains Mono, Space Grotesk) loaded from a local /fonts or Google Fonts link (open question). Missing font shows a warning triangle and falls back to the system stack.
- Acceptance: Choosing Georgia re-renders the text and the box re-measures.
- Edge cases: Font not loaded yet: use document.fonts.load and re-measure on completion to avoid wrong autosize.
- Depends on: TEXT-4

### TEXT-6: Font size and weight
- Priority: P0
- Size: S
- Interaction: Size combobox (type a value or choose 8,10,12,14,16,18,24,32,48,64,96) with arithmetic. Weight select Thin 100 to Black 900 (names), available weights depend on the family. Cmd+Shift+. / , increases/decreases size by 1 (Shift 10). Existing fields fontSize and weight (engine.ts:16-17).
- Acceptance: Size 32 resizes the text; weight 700 is bold.
- Edge cases: Fractional sizes allowed up to 1 decimal. Weight unsupported by font snaps to nearest and shows the name.
- Depends on: TEXT-5

### TEXT-7: Line height and letter spacing
- Priority: P0
- Size: S
- Interaction: Line height field: Auto (font default, 1.2 today in playground.css:80) or px, or %. Letter spacing: px or %, range -100..100%. Both live-previewed. Auto shown as a placeholder 'Auto'.
- Acceptance: Line height 150% increases line gaps. Letter spacing 5% spreads glyphs.
- Edge cases: Line height smaller than font size clips ascenders in fixed boxes.
- Depends on: TEXT-6

### TEXT-8: Alignment horizontal and vertical
- Priority: P0
- Size: S
- Interaction: Horizontal icons: left, centre, right, justify. Vertical: top, middle, bottom (matters in fixed height). Shortcuts Cmd+Alt+L/T/R/J.
- Acceptance: Centre aligns lines in the box. Middle centres the block vertically in a fixed box.
- Edge cases: Justify last line left-aligned. RTL scripts flip default alignment.
- Depends on: TEXT-4

### TEXT-9: Text colour
- Priority: P0
- Size: S
- Interaction: Text layers use the fill section as the text colour (Figma). Today it is a separate color field (engine.ts:14); unify: fill drives text colour and `color` becomes legacy-read-only. Selecting text inside editing mode applies to the selection (P2 rich).
- Acceptance: Changing fill changes the glyph colour. Fill opacity works.
- Edge cases: Templates that use color: 'A' (agent accent) resolve at write time.
- Depends on: PROPS-11

### TEXT-10: Text decoration and case
- Priority: P1
- Size: S
- Interaction: Underline (Cmd+U), strikethrough (Cmd+Shift+X), case (original, UPPER, lower, Title). Decoration style/thickness is P2.
- Acceptance: Underline renders under glyphs.
- Edge cases: Underline with descenders skipping (text-decoration-skip-ink).
- Depends on: TEXT-6

### TEXT-11: Placeholder for empty text
- Priority: P0
- Size: S
- Interaction: An empty text layer in edit mode shows a muted 'Type something' hint that is not content. On exit empty layers are deleted (TEXT-1). The layer row shows 'Text' in italics.
- Acceptance: Placeholder disappears on first character.
- Edge cases: Placeholder not exported, not measured.
- Depends on: TEXT-1

### TEXT-12: Wrapping and measurement at any zoom
- Priority: P0
- Size: L
- Interaction: Layout is computed at zoom 1 in CSS pixels and scaled by the camera transform, never by changing font-size per zoom, so line breaks never change when zooming. Auto-width/height uses a shared measurer (offscreen DOM or canvas measureText) that is called on content, font or width change; box size is written back to the document so agents and exports see it. The same measurer is used by agents when they create text (they currently guess h).
- Acceptance: Zooming 10%-800% does not change wrapping. Auto height box matches rendered height within 1px. Agent-made text boxes fit their content.
- Edge cases: Fonts loading late, emoji, CJK, very long unbroken strings (overflow-wrap anywhere), 5000-char paragraphs. Subpixel rounding at fractional zoom.
- Depends on: TEXT-4, TEXT-5
- Multi-agent note: The measurer must run in the browser, so agents' text boxes are fixed up on the human client or on whoever hosts the board; see open questions.

### TEXT-13: IME composition
- Priority: P1
- Size: S
- Interaction: While composing (CJK, accents) onCompositionStart/End are respected: do not commit on Enter, do not intercept shortcuts, no re-render of the editor value mid-composition, the candidate window anchors at the caret.
- Acceptance: Typing Japanese via IME does not duplicate or lose characters.
- Edge cases: Remote update arriving mid-composition is queued until compositionend.
- Depends on: TEXT-2

### TEXT-14: Paste as plain text
- Priority: P0
- Size: S
- Interaction: Pasting into the editor inserts text only (strip HTML, normalise newlines). Cmd+V on canvas with plain text on the clipboard creates a text layer at the view centre or pointer. Cmd+Shift+V is the same.
- Acceptance: Pasted web content has no styles.
- Edge cases: Very large paste (1MB) is truncated at 100k chars with a toast.
- Depends on: TEXT-2

### TEXT-15: Human edits of agent text
- Priority: P0
- Size: S
- Interaction: Agent-created text is a normal text layer: the human can double-click to edit it at any time. If an agent is currently typing into it (owner set), the editor opens read-write but shows the agent's chip; the human's first keystroke interrupts the agent (agent receives an abort and the human's content wins). Edit is committed as one atomic text replace.
- Acceptance: Double-click on an agent's Headline lets the human fix a typo; the agent's cursor stops there.
- Edge cases: Agent write in the same frame as the human's commit: human wins, agent's change is rebased or dropped with a chat notice.
- Depends on: TEXT-2, MULTI-*
- Multi-agent note: Agents should treat a text with a human-edited flag as pinned unless told otherwise.

### TEXT-16: Agent typing animation
- Priority: P1
- Size: M
- Interaction: When an agent writes text it types it character by character at ~30 cps into the layer (engine already creates the box then fills text). The layer's owner outline remains until done. Re-measure each tick (batched).
- Acceptance: Watching an agent write a headline shows it grow letter by letter.
- Edge cases: Fast-forward at demo speed 4x. Cancel mid-type leaves partial text.
- Depends on: TEXT-12

### TEXT-17: Rich text runs
- Priority: P2
- Size: L
- Interaction: Selecting a range in edit mode and changing weight, colour, size, underline, or link applies to a run. Data: runs: {start,end,style}[]. Mixed values in the typography section show 'Mixed' (PROPS-10). Cmd+B / I / U toggle.
- Acceptance: Bold one word inside a sentence.
- Edge cases: Runs shift on edits; merge adjacent identical runs; agents write via a markdown-lite string or runs.
- Depends on: TEXT-3

### TEXT-18: Lists
- Priority: P2
- Size: M
- Interaction: Typography menu offers bullet and numbered lists; Cmd+Shift+7 / 8. Indent with Tab, outdent Shift+Tab; marker gap 0.5em.
- Acceptance: Numbered list renumbers when items are added.
- Edge cases: Lists inside runs.
- Depends on: TEXT-17

### TEXT-19: Text styles
- Priority: P1
- Size: M
- Interaction: Create style from the current typography, apply from the dropdown (links, see PROPS-24), shows a style name in the section header.
- Acceptance: Editing the style updates all linked text.
- Edge cases: Detached style.
- Depends on: PROPS-24

### TEXT-20: Truncate and max lines
- Priority: P2
- Size: S
- Interaction: Option 'Truncate text' with max lines (ellipsis) in fixed boxes.
- Acceptance: Long text ends with ... after N lines.
- Edge cases: Auto-width ignores.
- Depends on: TEXT-4

### TEXT-21: Text overflow handling and fit
- Priority: P1
- Size: S
- Interaction: Fixed text overflowing its box shows a small red overflow bracket at the bottom right while selected; double-click the bracket switches to auto height.
- Acceptance: Overflow marker shows only when overflowing.
- Edge cases: Clipped by frame vs by its own box.
- Depends on: TEXT-4

### TEXT-22: Typography keyboard shortcuts
- Priority: P1
- Size: S
- Interaction: Cmd+B, Cmd+I, Cmd+U apply to the whole text layer when not editing; Cmd+Alt+arrows adjust size and line height.
- Acceptance: Select a text layer, Cmd+B toggles weight 700.
- Edge cases: Different weights available.
- Depends on: TEXT-6

### TEXT-23: Link and hyperlink text
- Priority: P2
- Size: S
- Interaction: Cmd+K in the editor sets a URL for the selection. Links render underlined, clickable in present/share mode only.
- Acceptance: Link persists.
- Edge cases: Invalid URL.
- Depends on: TEXT-17

### TEXT-24: Text on a path and special glyphs
- Priority: P2
- Size: M
- Interaction: Out of scope for now; listed so IDs are reserved. Includes OpenType features (ligatures, tabular numbers), variable font axes.
- Acceptance: n/a
- Edge cases: n/a
- Depends on: TEXT-5

### TEXT-25: Font fallback and loading state
- Priority: P1
- Size: S
- Interaction: Text with a font not yet loaded renders with the fallback and re-measures when document.fonts resolves. Documents declare fonts used so every client preloads them.
- Acceptance: No layout jump after fonts load for autosize text.
- Edge cases: Offline: warns with triangle.
- Depends on: TEXT-5, TEXT-12

## Data model and architecture implications

```ts
type Paint =
  | { type: 'solid'; color: string; opacity: number; visible: boolean; styleId?: string }
  | { type: 'linear' | 'radial' | 'angular'; stops: { pos: number; color: string; opacity: number }[]; transform: number[]; opacity: number; visible: boolean };
type Stroke = { paint: Paint; weight: number; align: 'inside' | 'center' | 'outside'; dash?: number[]; cap?: string; join?: string; sides?: [number, number, number, number] };
type Effect = { type: 'drop' | 'inner' | 'layerBlur' | 'bgBlur'; x?: number; y?: number; blur: number; spread?: number; color?: string; opacity?: number; visible: boolean };

type Shape = {            // additions to engine.ts Shape; old fields kept as read-fallbacks
  id: string; kind: 'frame' | 'group' | 'rect' | 'ellipse' | 'text' | 'image' | 'component' | 'instance';
  parentId: string | null; // null = page root
  index: string;            // fractional index string (sibling order), avoids array position conflicts
  pageId: string;
  name: string; nameAuto?: boolean;   // text layers follow content until renamed
  x: number; y: number; w: number; h: number; rotation?: number; lockRatio?: boolean;  // x,y relative to parent
  locked?: boolean; hidden?: boolean; clipsContent?: boolean;
  opacity?: number; blend?: string; radius?: number | [number, number, number, number];
  fills?: Paint[]; strokes?: Stroke[]; effects?: Effect[]; exports?: { scale: number; suffix: string; format: string }[];
  fillStyleId?: string; textStyleId?: string; componentId?: string; overrides?: Record<string, unknown>;
  text?: { content: string; font: string; size: number; weight: number; lineHeight: number | 'auto'; letterSpacing: number; align: 'left'|'center'|'right'|'justify'; valign: 'top'|'middle'|'bottom'; mode: 'autoW'|'autoH'|'fixed'; decoration?: string; case?: string; runs?: { start: number; end: number; style: Partial<unknown> }[]; humanEdited?: boolean };
  owner?: string; author?: string; lastEditor?: string; editedAt?: number;
};
type Style = { id: string; kind: 'color' | 'text'; name: string; paints?: Paint[]; text?: Shape['text'] };
```

- Move from a flat array to a normalized store `Map<id, Shape>` plus per-parent ordered child lists; derive the flattened visible tree for the panel with a memoised selector (needed for LAYERS-20).
- All edits go through named commands (`setProps(ids, patch)`, `reparent(ids, parentId, index)`, `group`, `ungroup`, `rename`, `setText`) so HISTORY can batch them, agents call the same API as the UI, and MULTI can tag `lastEditor`. Number scrubbing and live typing use a transient preview patch, committed once.
- Reparenting needs a coordinate conversion helper (parent-relative x/y) shared with SCENE.
- A single `measureText(text, style, width)` helper (DOM or canvas based) shared by the editor, agents and export, run in a browser (TEXT-12).
- Panel state (expanded set, search, recents, popover state) is per-viewer and never in the shared document; selection of agents is separate from the human's (LAYERS-30).
- Hand-written arithmetic parser (PROPS-8) and hand-written list windowing (LAYERS-20) avoid new dependencies. Colour picker: build in-house (HSV math is small).
- Legacy fields `fill`, `color`, `fontSize`, `weight` should be migrated by a one-time adapter so the existing templates and `parseEdit` keep working.

## Open questions

1. Parent/child model: add `parentId` now (recommended: yes, before any other feature, it blocks LAYERS-1/10/11/13 and SCENE) versus keep flat and infer frame membership from geometry.
2. Web fonts: bundle 4-5 woff2 files in `dashboard/public/fonts` (recommended, offline demo safe) versus Google Fonts link.
3. Where does text measurement run for agent-created text when no browser is the author? Recommended: agents create text with approximate sizes and the human/host client re-measures and writes back.
4. Enter in the text editor: newline with Cmd+Enter or Esc to commit (Figma, recommended) versus the current Enter-commits.
5. Strokes: unify `fill`/`color` into `fills[]` now (recommended) or keep legacy fields until after the demo.
6. Is the canvas rendered as DOM (current) or canvas/WebGL later? It decides the eyedropper (PROPS-14), blend modes and blur cost; recommended: stay DOM for the hackathon.
7. Fractional index library (e.g. `fractional-indexing`) is a small new dependency; recommended to hand-roll a string-midpoint helper instead.
8. Should humans be able to lock a region against agents (LAYERS-8)? Recommended yes, enforced in the shared command API.
