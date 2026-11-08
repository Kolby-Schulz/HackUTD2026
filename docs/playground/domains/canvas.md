# Canvas, viewport and navigation

Scope: the infinite board and everything about looking at it: camera model, pan, zoom, zoom-dependent rendering, rulers, pixel grid, minimap, scroll bars, "go to" navigation (layer, cursor, comment pin), viewport persistence, keyboard viewport control, HiDPI, performance and culling, the rendering-backend decision, touch/trackpad gestures, cursor styles per tool, and hit-testing accuracy. Selection and transform handles belong to SELECT, snapping and guides to ALIGN, the layers panel to LAYERS, presence/sync to MULTI. Where those domains need viewport math (screen/world conversion, visible rect) they consume the API defined here.

## Today
- Camera is `type Cam = { x, y, z }` in React state (`Playground.tsx:15`, `:45`), mirrored into `camRef` every render (`:70`). Initial `{x:60,y:90,z:0.55}`. Every pan/zoom event calls `setCam`, so each wheel tick re-renders the whole `Playground` tree.
- World is one DOM div with `transform: translate(x,y) scale(z)` (`:460`); each shape is an absolutely positioned div (`ShapeView`, `:602`, memoized, but all shapes always mounted). No culling, no layer promotion strategy.
- Wheel handler (`:151-166`): `ctrlKey || metaKey` zooms with `exp(-deltaY*0.01)`, clamped 0.08..4, anchored at pointer (correct math); otherwise pans by `deltaX/deltaY`. Pinch works only because browsers synthesize ctrlKey wheel events. No mouse-wheel-vs-trackpad discrimination, no deltaMode handling (Firefox line mode), no momentum of our own, no Shift+wheel horizontal pan.
- Pan: Space held (`:174`, `spaceRef`), middle button or Hand tool (`:283-287`), and plain drag on empty space (`:318-321`, deliberately pans instead of marquee). Pointer capture on the view. `touch-action: none` (`playground.css:73`), so no native touch scroll; no multi-touch handling at all.
- Zoom commands: `Shift+1` fit-all (`:122-131`, `:179`, clamps z to 1.5, 60px margin, empty board resets to default), `Cmd/Ctrl+0` sets z=1 around the top-left origin (`:180`, wrong anchor, should be viewport center), zoom pill shows `%` and acts as fit (`:422`). No `+`/`-`, no Shift+2 (selection), no zoom menu, no 50%/200% presets, no animated transitions (all jumps).
- `focusShape` (`:254-260`): select a layer, center it with z = max(current, 0.8), instant jump. This is the only "go to" in the app. No follow-cursor, no jump-to-pin animation.
- Dot grid: CSS `radial-gradient` on `.pg-view` with `backgroundSize`/`backgroundPosition` driven by cam (`:391-392`, `:453`, `playground.css:75`); gap 24px, doubled until >=14px on screen. Dots are fixed 1.2px, so no fade or size change by zoom. No rulers, pixel grid, minimap, scroll bars.
- Counter-scaled chrome: selection border, name label, hover target and owner badges divide by `z` (`:473-476`, `:620`, `:630`) so they stay constant-size on screen. Good idea, but done per component with scattered `/ z`; shape strokes and text are not LOD'd.
- Cursors are painted in a rAF loop that writes `transform` directly to DOM nodes, bypassing React (`:90-107`); agent cursors use `p.x*z+x`, the human cursor uses raw screen coords (`:97-98`). Cursor layer is `overflow:hidden`, so cursors outside the viewport vanish with no off-screen indicator. The loop runs `engine.tick` every frame forever, even when idle and when the tab is hidden.
- Hit testing (`:269-276`): linear scan, last-in-array wins, plain AABB in world space. No tolerance in screen px, ignores ellipse shape, text glyph bounds, frame-vs-children preference, rotation (not in the data model yet), and is O(n) per pointer move in comment mode.
- Cursor style: `.pg-view { cursor: none }` (`playground.css:73`, `:179`) because the app draws its own human cursor; Hand tool toggles class `panning`. No per-tool system cursors (crosshair for draw, text I-beam, resize arrows, grab/grabbing), so tool state is only visible through the toolbar.
- Persistence: none. Reloading resets the camera. `share()` copies `location.href`, which contains no viewport.
- Tests: none for camera math.

## Features

### CANVAS-1: Camera store and rAF-coalesced updates
- Priority: P0
- Size: M
- Interaction: Move the camera out of React state into a small module `camera.ts` (`getCam()`, `setCam(next, {animate?})`, `subscribe(fn)`), with `Cam = {x, y, z}` kept in a mutable ref. Wheel/pointer handlers mutate the ref and mark dirty; a single rAF flush writes the world `transform`, the dot-grid background and any subscribed overlays (rulers, minimap, scroll bars, zoom pill) once per frame. Only the zoom % label and zoom-bucket-dependent React props re-render, and only when the rounded value or LOD bucket changes.
- Acceptance: Wheel-scrolling with 500 shapes causes zero `Playground` re-renders per tick (React Profiler); world transform and grid update in the same frame (no grid lag vs. shapes); `window.board.cam` returns the live camera; two setCam calls in one frame produce one DOM write.
- Edge cases: setCam from inside a React effect during mount; camera changes while a text editor textarea is focused; hidden tab (no rAF) then return; React StrictMode double-mount must not double-subscribe.
- Depends on: none
- Multi-agent note: agents never write the human's camera. Agent "view" (what an agent is looking at) is a separate read-only record, see CANVAS-27.

### CANVAS-2: Coordinate API (screen/world, visible rect)
- Priority: P0
- Size: S
- Interaction: Export pure functions `screenToWorld(p, cam, rect)`, `worldToScreen`, `visibleWorldRect(cam, viewSize)`, `zoomAt(cam, screenPt, factor)`, `fitRect(rect, viewSize, margin, maxZoom)` with unit tests (vitest). Replace ad hoc math at `Playground.tsx:112-120`, `:157-159`, `:259-260`, `:503`, `:491`. All other domains import these.
- Acceptance: Round trip screenToWorld(worldToScreen(p)) equals p within 1e-9 at z from 0.02 to 256; zoomAt keeps the world point under the pointer fixed (test); fitRect of a rect larger than the viewport yields z<1.
- Edge cases: view rect with devicePixelRatio fractional offsets; sidebars changing the view's bounding rect (must read rect from the view element, never `window`); zero-size rect.
- Depends on: CANVAS-1
- Multi-agent note: agent cursor positions are stored in world coordinates only; conversion happens in the render loop per viewer.

### CANVAS-3: Wheel input classification (mouse wheel vs trackpad vs pinch)
- Priority: P0
- Size: M
- Interaction: Figma behavior: trackpad two-finger scroll pans; pinch (ctrlKey wheel on Chrome/Firefox, `gesturechange` on Safari) zooms; mouse wheel scrolls vertically (Shift+wheel horizontally); Cmd+wheel (mac) / Ctrl+wheel (Windows) zooms. Heuristic: events with fractional or small `deltaY`, nonzero `deltaX`, or `deltaMode===0` with |deltaY|<50 are trackpad; integer multiples of 100/120 or `deltaMode===1` are a notched wheel. Normalize `deltaMode` (lines x 16px, pages x viewport height). Add setting "Mouse wheel: scroll | zoom" (Figma pref "Zoom with mouse wheel"); default scroll. On Safari listen for `gesturestart/gesturechange/gestureend` and `preventDefault` to stop page zoom.
- Acceptance: Two-finger swipe pans smoothly in Chrome, Safari, Firefox; pinch zooms about the fingers without the browser page zooming; Shift+wheel pans horizontally; Firefox line-mode wheel moves a sane distance (about 50px/notch); Cmd/Ctrl+wheel zoom factor per notch ~ 1.1-1.25 for notched wheels, continuous for trackpads.
- Edge cases: ctrlKey pinch deltas are tiny and numerous, notched ctrl+wheel deltas are huge (clamp |delta| to 100 before exp); macOS Cmd+wheel on a mouse; inertia tail from a pan leaking into a zoom when the user presses Cmd mid-swipe; Windows precision touchpads report like trackpads.
- Depends on: CANVAS-1
- Multi-agent note: n/a

### CANVAS-4: Zoom around pointer with clamp and smooth exponent
- Priority: P0
- Size: S
- Interaction: Keep today's pointer-anchored math but go through `zoomAt` (CANVAS-2). Clamp z to [0.02, 256] (Figma: 2%..25600%); today's [0.08, 4] (`:158`) is too tight for pixel work and for 5k-shape overview. Snap-through at exactly 100% for 120ms when crossing it with a notched wheel only (Figma does not, tldraw does a mild one; make it optional, off).
- Acceptance: Zooming 20 ticks in then 20 out returns to the same camera within 0.01px; the point under the pointer moves < 0.5px at all zooms; hitting the clamp stops cleanly with no drift of x/y.
- Edge cases: pointer outside the view when keyboard zooming (use view center); clamping must still adjust x/y consistently (compute from clamped z); float drift at z=256 (round z to 6 significant digits).
- Depends on: CANVAS-2, CANVAS-3
- Multi-agent note: n/a

### CANVAS-5: Space-drag, middle-mouse and Hand tool panning
- Priority: P0
- Size: S
- Interaction: Hold Space to pan with left drag (cursor grab; grabbing while dragging); middle mouse drag pans in any tool; Hand tool is `H`; releasing Space returns to the previous tool and must not fire if Space was used inside a text editor (already guarded by the `input, textarea` check, `:172`). Also Cmd/Ctrl+drag does NOT pan (reserved for SELECT deep-select). Space while dragging a shape continues the drag and pans nothing (Figma moves the shape's origin; out of scope here, flagged to SELECT).
- Acceptance: Space+drag pans 1:1 with no lag; releasing the mouse before Space keeps grab cursor until Space up; middle-click drag works while Rectangle tool is active; switching windows with Space held does not leave pan mode stuck (clear on blur).
- Edge cases: Space keyup lost on window blur or iframe focus (clear on `blur` and `visibilitychange`); key repeat of Space; pan starting over a toolbar or popover must not start (existing `closest` guard `:278`); middle-click autoscroll icon on Windows (preventDefault on `mousedown` button 1).
- Depends on: CANVAS-1
- Multi-agent note: n/a

### CANVAS-6: Plain-drag-on-empty-space policy
- Priority: P1
- Size: S
- Interaction: Today dragging empty space with Move tool pans (`:318-321`) because there is no marquee. Once SELECT ships marquee (drag on empty = marquee, Figma behavior) this must move to Space/Hand/middle only. Provide a setting "Drag empty canvas to pan" (default on until marquee exists, then off), so the demo stays usable on trackpads.
- Acceptance: With setting on, empty drag pans; off, it hands off to SELECT marquee; setting persists in localStorage.
- Edge cases: touch input (one-finger drag on empty space should always pan, see CANVAS-30).
- Depends on: CANVAS-5, SELECT marquee
- Multi-agent note: n/a

### CANVAS-7: Pan momentum (inertia) for drag-release and wheel
- Priority: P2
- Size: M
- Interaction: Releasing a Hand/Space drag while moving faster than 300 px/s continues with exponential decay (friction ~0.92/frame at 60fps, stop under 5 px/s), cancelled by any new pointer down or wheel. Native trackpad inertia already arrives as wheel events, so do not add our own for wheel. Respect `prefers-reduced-motion` (disable).
- Acceptance: Flick-release glides about 300-600ms; touching the board stops it instantly; reduced-motion users get no glide.
- Edge cases: glide must be frame-rate independent (dt-based); glide into a clamped boundary (see CANVAS-9).
- Depends on: CANVAS-1, CANVAS-5
- Multi-agent note: n/a

### CANVAS-8: Keyboard viewport navigation
- Priority: P1
- Size: S
- Interaction: Arrow keys with nothing selected pan 50px (Shift: 200px) once SELECT owns arrows for nudging selection; hold Space+arrows is not needed. `Cmd/Ctrl+Arrow` none. `Home` = fit all. `Page Up/Down` pan one viewport height. Pan steps ease over 120ms; held key repeats continuously (rAF-driven velocity, not keydown repeat).
- Acceptance: With empty selection arrows pan; with a selection arrows go to SELECT (documented hand-off); steps are screen px, not world px.
- Edge cases: focus inside text input; IME composition; reduced motion = instant.
- Depends on: CANVAS-1, SELECT nudge
- Multi-agent note: n/a

### CANVAS-9: Soft pan bounds
- Priority: P2
- Size: S
- Interaction: The canvas is unbounded, but if the camera drifts so that no shape is within 4 viewport widths, show a toast "Content is far away - press Shift+1" with a one-click Fit button (Figma has no hard limit; this is a rescue affordance). Hard numeric limit at |x|,|y| < 1e7 world units to keep float precision.
- Acceptance: Panning 5 screens away from all content shows the toast once, dismissible; Shift+1 recovers.
- Edge cases: empty board never shows it.
- Depends on: CANVAS-10
- Multi-agent note: n/a

### CANVAS-10: Zoom-to-fit family (Shift+1 / Shift+2 / Shift+0)
- Priority: P0
- Size: S
- Interaction: Match Figma: `Shift+1` zoom to fit all content; `Shift+2` zoom to selection (no-op with toast if empty); `Shift+0` zoom to 100% centered on the view center (Figma binds Cmd/Ctrl+0 to 100% too; keep both, since Cmd+0 exists today at `:180` but anchors wrongly). Fit uses 80px margin (matching today's 120 total) and caps at z=2 for fit-all, no cap for selection beyond 256. Animates 220ms ease-out (CANVAS-13). Zoom pill click = fit (today's behavior) and caret opens the menu (CANVAS-11).
- Acceptance: Shift+1 on 200 shapes shows all with margin; Shift+2 on one 10px rect zooms until it fills about 70% of the shorter view axis; Cmd+0 keeps the view center fixed; Shift+1 on an empty board returns to default camera.
- Edge cases: shapes of zero size (1 point, use a 200x200 box around it); selection including a very large frame; rect partially covered by the right panel (use the visible canvas rect, not the window).
- Depends on: CANVAS-2, CANVAS-13
- Multi-agent note: "Fit all" ignores agent cursors, only shapes.

### CANVAS-11: Zoom menu and percent field
- Priority: P0
- Size: M
- Interaction: The zoom pill (`:422`) opens a dropdown like Figma: Zoom in (`Cmd/Ctrl +`), Zoom out (`Cmd/Ctrl -`), Zoom to fit (`Shift+1`), Zoom to selection (`Shift+2`), Zoom to 50% / 100% (`Shift+0`) / 200%, plus toggles for Pixel grid, Rulers, Minimap (CANVAS-20/17/24), Snap to pixel (CANVAS-40). The pill label is an editable field: type `150` or `150%`, Enter applies around view center, Esc cancels, Up/Down arrows step presets. Shows `<1%` style label only below 1%.
- Acceptance: Every menu item shows its shortcut for the current OS (⌘ vs Ctrl); typing 250 + Enter sets exactly 250%; pill never exceeds 6 chars width and does not jitter (tabular numbers, already set at `playground.css:30`).
- Edge cases: invalid input reverts; value outside clamp is clamped and shown clamped; menu keyboard navigable, closes on Esc and outside click.
- Depends on: CANVAS-4, CANVAS-10
- Multi-agent note: n/a

### CANVAS-12: Keyboard zoom (+ / - and presets)
- Priority: P0
- Size: S
- Interaction: `Cmd/Ctrl + =`/`+` zoom in, `Cmd/Ctrl + -` zoom out (also bare `+`/`-` when nothing text-focused, like Figma). Steps follow a preset ladder: 2, 3, 5, 6, 12, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600 %; step to the next preset in direction around the pointer if inside the view else view center. Intercept browser zoom with `preventDefault` (Cmd+=, Cmd+-, Cmd+0 must not zoom the page). Numpad +/- supported. `Shift+3`? not used.
- Acceptance: Page never browser-zooms inside the board; repeated Cmd+= walks the preset ladder; works with non-US layouts (use `e.key` plus `e.code === 'Equal'/'Minus'/'NumpadAdd'`).
- Edge cases: Cmd held with Shift (Cmd+Shift+= on US layout is `+`); key repeat accelerates; focus in chat input (ignored, as at `:172`).
- Depends on: CANVAS-4
- Multi-agent note: n/a

### CANVAS-13: Animated camera moves (tweens)
- Priority: P0
- Size: M
- Interaction: `setCam(target, {animate:'fit'|'goto'|number ms})` tweens x/y/z. For big jumps use "van Wijk" smooth zoom-pan (zoom out then in) so the user keeps spatial context; for small moves a 180-250ms ease-out. Any user input (wheel, drag, key) cancels the tween immediately and keeps the current interpolated state. One active tween at a time; new tween starts from the current interpolated camera.
- Acceptance: Fit/go-to never teleports; interrupting mid-tween with a wheel tick does not snap back; tween frame times stay under 16ms with 1k shapes; `prefers-reduced-motion` makes all moves instant.
- Edge cases: tween target changes (followed cursor moves, see CANVAS-27) each frame; tween while a drag is in progress; zero-distance tween.
- Depends on: CANVAS-1, CANVAS-2
- Multi-agent note: when an agent triggers "show me" (CANVAS-26) the tween is the same primitive but requires user consent.

### CANVAS-14: Zoom-aware dot grid
- Priority: P0
- Size: M
- Interaction: Replace the single CSS gradient with a level-of-detail grid: base gap 24 world units at z=1; at each zoom pick the power-of-two gap so on-screen spacing stays within 14-28px (today doubles only, `:391-392`); cross-fade between two adjacent levels by opacity as spacing crosses the band so dots never pop. Dot radius constant ~1.2 CSS px but alpha fades to 0 below 8px spacing. Always aligned to world origin (backgroundPosition = camera mod gap, today `:453`). Two layers of background-image for the cross-fade, or a canvas overlay (CANVAS-33).
- Acceptance: Zooming from 5% to 2000% never shows moire or sudden density jumps; dots sit exactly on multiples of the gap in world units (verify with a shape at x=48, y=48); no more than two dot layers visible.
- Edge cases: HiDPI fractional offsets cause shimmering (round position to device pixels); extremely small gap (z>16) hands over to the pixel grid (CANVAS-19) and hides dots.
- Depends on: CANVAS-1
- Multi-agent note: n/a

### CANVAS-15: Counter-scaled UI helper (constant-screen-size chrome)
- Priority: P1
- Size: S
- Interaction: Introduce one convention instead of scattered `/ z` (`:473-476`, `:620`, `:630`): overlay elements are positioned in world space but sized via CSS variable `--inv: calc(1 / var(--z))` set on `.pg-world`, or are rendered in a separate screen-space overlay layer whose positions are computed with `worldToScreen` (preferred: crisp text, no sub-pixel scaling blur). Covers selection outlines, name tags, dimension pills, owner badges, hover targets, resize handles, pins.
- Acceptance: 1px outlines stay 1 device-pixel crisp at all zoom levels; labels have identical on-screen font size at 10% and 800%; no blurry text in overlays.
- Edge cases: Chrome rasterizes scaled text at the transform scale at the time of last paint, so heavy zoom leaves blurry text (use `will-change: transform` sparingly; see CANVAS-31).
- Depends on: CANVAS-1, CANVAS-2
- Multi-agent note: other domains (SELECT, MULTI) use this layer for their overlays.

### CANVAS-16: Stroke, text and label level of detail
- Priority: P1
- Size: M
- Interaction: Below set thresholds draw cheaper approximations: at z < 0.25 text shapes render as gray bars sized to their box (Figma "text as placeholders" when too small to read); below 6px on-screen height nothing renders for that shape except its fill; frame name labels (the title above each frame) hide under 8px effective font, clamp to a max size (Figma clamps frame titles so they stay readable when zoomed out up to a point); strokes thinner than 0.5 device px render at 0.5px with reduced alpha rather than aliasing. Zoom in beyond 800% renders vector edges at native precision (no CSS rounding).
- Acceptance: At 10% a 5k-shape board has no text nodes in the DOM; at 100% text renders normally; label sizes at 25%, 50%, 100% follow the clamp table; toggling zoom across a threshold does not flash.
- Edge cases: text being edited always renders full detail; selected text always renders full detail; thresholds hysteresis (10%) to avoid flicker at the boundary.
- Depends on: CANVAS-1, CANVAS-18
- Multi-agent note: shapes owned by active agents render at normal detail so people see work happening, up to a budget of 20.

### CANVAS-17: Rulers
- Priority: P1
- Size: M
- Interaction: `Shift+R` toggles rulers (Figma). 20px top and left strips showing world coordinates with tick spacing picked from 1-2-5 series so labels are 60-120px apart; selection extent highlighted as a shaded span with start/end numbers; red cursor-position tick follows the pointer. Dragging from a ruler creates a guide (guide data and snapping belong to ALIGN; this feature only exposes the drag gesture and the ruler render). Rulers are canvas elements redrawn from camera subscription in the rAF flush.
- Acceptance: Tick labels match world coordinates (shape at x=240 has its left edge on the 240 tick); labels never overlap at any zoom; toggling does not shift the board (rulers overlay the view edge, view origin stays at the ruler corner like Figma); setting persists.
- Edge cases: negative coordinates; zoom > 1000% shows fractional labels with correct decimals; vertical labels rotated -90deg; ruler vs left panel width changes.
- Depends on: CANVAS-1, CANVAS-2, ALIGN guides
- Multi-agent note: agent selection extents can appear as colored spans in the ruler (P2).

### CANVAS-18: Viewport culling of shapes
- Priority: P0
- Size: M
- Interaction: Only mount `ShapeView` for shapes whose world AABB (expanded by 64px screen margin / z) intersects `visibleWorldRect`. Keep selected, editing and agent-owned shapes mounted regardless. Recompute at most once per frame and only when the visible rect crosses into a new cell of a spatial index (CANVAS-19) or the shape set changes. Use stable keys so React reuses nodes while scrolling.
- Acceptance: With 5,000 rect shapes, DOM node count while viewing a 1000x700 region is < 600; scrolling at 60fps on a mid laptop; a shape partially visible at an edge is mounted; panning back remounts without layout flash.
- Edge cases: shapes with huge shadows or blur (expand AABB by effect bounds, see DESIGN domain); children of a culled frame; selection outlines of a culled selected shape (still drawn, off-screen so invisible); text editing shape scrolled off-screen stays mounted; culling must not break `Cmd+A`, layers panel counts or export.
- Depends on: CANVAS-2, CANVAS-19
- Multi-agent note: agents operating off-screen continue to mutate shapes normally; culling is purely a render concern, never data.

### CANVAS-19: Spatial index
- Priority: P0
- Size: M
- Interaction: A grid hash or rbush-style R-tree over shape AABBs, maintained incrementally on shape add/move/resize/delete, exposing `queryRect(rect)` and `queryPoint(pt, tolerance)`. Used by culling (CANVAS-18), hit testing (CANVAS-21), marquee (SELECT), snap candidate search (ALIGN), minimap. Prefer a ~60-line uniform grid (cell 512 world units) over adding `rbush` (new dependency, flag in Open questions).
- Acceptance: Query for a 1000x700 rect over 5k shapes < 0.5ms; index rebuild after a bulk agent insert of 500 shapes < 10ms; results equal a brute-force scan (property test with random rects).
- Edge cases: shapes spanning many cells; moves during drag (update per frame cheaply, or re-index at drag end and fall back to scan of the dragged set); shapes with NaN or negative size (normalize).
- Depends on: none
- Multi-agent note: index updates arrive from remote patches too; must be driven by the same shape-change stream as local edits.

### CANVAS-20: Pixel grid
- Priority: P1
- Size: S
- Interaction: At z >= 800% (Figma threshold) draw a 1-world-unit grid in light gray lines over the content; toggle `Shift+'` (Figma: "Pixel grid", `Cmd/Ctrl+'`). Lines are 1 device px, drawn on the overlay canvas, fade in between 600% and 800%. Alpha 0.15.
- Acceptance: Grid is invisible below 600%; at 1600% each cell is 16 CSS px and aligned with integer world coordinates; shapes at integer coordinates align exactly with grid lines.
- Edge cases: HiDPI; very high zoom with a huge viewport (draw only visible lines, max 2000); conflicts with dot grid (dots hidden when pixel grid visible).
- Depends on: CANVAS-14, CANVAS-35
- Multi-agent note: n/a

### CANVAS-21: Hit testing: screen-space tolerance, topmost, shape-aware
- Priority: P0
- Size: M
- Interaction: One `hitTest(worldPt, {tolerancePx, deep?})` exported from the canvas module and used by every domain. Tolerance is `4 / z` world units (strokes and thin shapes stay clickable when zoomed out; Figma behaves this way for lines). Shape-aware: ellipse uses the ellipse equation, rounded rect uses the corner radius, text uses its box, lines/paths use distance-to-segment. Order: topmost by z-order; frames are only hit on their title label or their empty area when they have no fill-only click-through rule (Figma: clicking a frame's body selects the child under the pointer, or the frame if empty). With `Cmd/Ctrl` held return the deepest descendant; default returns the top-level container child (Figma). Results resolved via spatial index (CANVAS-19), not a full scan (today `:269-276`).
- Acceptance: Clicking outside the circle but inside its bounding box of an ellipse misses it; a 1px line is selectable at 25% zoom; transparent-fill rect is hit only on its edge area (stroke) unless it has a fill; hit test of 5k shapes under 0.2ms.
- Edge cases: overlapping siblings with equal bounds; shapes rotated (inverse-transform point into shape space once rotation exists); zero-size shape being created; locked layers skipped by default (LAYERS), hidden layers never hit; comment pins and cursors are not shapes.
- Depends on: CANVAS-19
- Multi-agent note: agent cursors "click" using the same function so agent hits and human hits agree.

### CANVAS-22: Cursor styles per tool and state
- Priority: P0
- Size: M
- Interaction: Stop using `cursor: none` for the whole board (`playground.css:73`). Use native system cursors for the human: default arrow (Move), crosshair (Frame, Rectangle, Ellipse, and Line/Pen later), I-beam over text-editing and `text` cursor with a "+" for the Text tool, grab/grabbing (Hand, Space), `zoom-in`/`zoom-out` while Z held (CANVAS-23), resize cursors (`ns-resize`, `ew-resize`, `nwse-resize`, `nesw-resize`, rotated for rotated shapes) on handles, `move` while dragging a selection, `copy` when Alt-dragging (duplicate), `not-allowed` over locked layers, comment cursor (custom bubble, SVG data URL with hotspot). Remote cursors still use the drawn arrows. Keep a cursor-state function `cursorFor(tool, hover, modifiers)` so tools set it declaratively. Hide the native cursor only when the app draws a human cursor for presence mirroring (MULTI) and then only if the drawn one is zero-latency (same-frame); default is native.
- Acceptance: Each tool shows its documented cursor within one frame of selection; resize cursor direction matches the handle; the cursor never flashes to default while crossing overlays; custom SVG cursors are crisp on HiDPI (use `image-set` 2x).
- Edge cases: cursor over the toolbar and panels is normal; pointer capture during drag keeps the drag cursor outside the view; Windows high-contrast cursors; touch devices have none.
- Depends on: SELECT handles
- Multi-agent note: other people's cursors always show their own color arrow; their active tool is shown as a small glyph next to the name tag (MULTI), not by changing the pointer shape.

### CANVAS-23: Zoom tool and Z-drag marquee zoom
- Priority: P2
- Size: S
- Interaction: Hold `Z` for temporary zoom tool (Figma): click zooms in at the point, Alt/Option+click zooms out, drag a rectangle zooms to fit it, `Esc` cancels. Cursor `zoom-in` / `zoom-out`. Release `Z` returns to the previous tool.
- Acceptance: Z+drag rect fills the view with that rect (animated); Alt+Z-click zooms out one preset step; Z does nothing while typing in text.
- Edge cases: Z while dragging a shape; tiny drag (<4px) treated as click.
- Depends on: CANVAS-12, CANVAS-13
- Multi-agent note: n/a

### CANVAS-24: Minimap / navigator
- Priority: P1
- Size: L
- Interaction: Toggleable (`Shift+M`, also in zoom menu) 180x120 map bottom-right above the zoom controls. Draws all frames/top-level shapes as flat colored rects (no text), the viewport as a draggable rectangle (drag to pan, click elsewhere to center), and each cursor as a colored dot in its color. Scales to fit the union of content bounds plus current viewport. Renders on a small canvas, redrawn on camera change (cheap) and on shape changes throttled to 10Hz. Collapses to nothing when content fits the view.
- Acceptance: Viewport rect tracks panning in the same frame; dragging the viewport rect pans the board 1:1 relative to the minimap scale; 5k shapes render in < 3ms (draw top-level only above 1000 shapes); agent cursors are visible as moving dots.
- Edge cases: empty board; one tiny shape far from the others (content bounds huge, cap the map extent and show an off-map arrow); minimap hidden below 900px window width; panels overlapping it.
- Depends on: CANVAS-1, CANVAS-2, CANVAS-19
- Multi-agent note: agent cursors off-screen are exactly what the minimap is for; clicking an agent dot offers "go to" (CANVAS-26).

### CANVAS-25: Scroll bars
- Priority: P2
- Size: S
- Interaction: Thin overlay scroll bars on the right and bottom edges (Figma shows none; Penpot/Sketch do), appear during pan/zoom and fade after 800ms idle; thumb size = visible / (content bounds + one viewport margin); dragging the thumb pans; wheel over them passes through. Default off, toggle in Settings.
- Acceptance: Thumb proportional to visible fraction; dragging moves the board consistently; invisible when idle; does not intercept shape clicks along the edge.
- Edge cases: content smaller than view (hide); content bounds changing during agent work (thumb animates smoothly, no jumps).
- Depends on: CANVAS-1
- Multi-agent note: n/a

### CANVAS-26: Go to layer / comment pin / cursor (jump)
- Priority: P0
- Size: M
- Interaction: One function `goTo(target, opts)` where target is `{shapeId}`, `{rect}`, `{pinId}`, `{cursorId}` or `{point}`. Replaces `focusShape` (`:254-260`). Behaviors: double-click a layer row (LAYERS) zooms to it (Figma: double-click icon / `Shift+2`); clicking a comment pin or a chat message that references a layer jumps there (already used by chat `onShowShape`, `:437`); clicking a cursor avatar in the top bar or cursor list (`:403`, `:555`) pans to that cursor's position (not follow). Animated (CANVAS-13), keeps the current zoom if the target fits comfortably, otherwise zooms out to fit; never zooms past 200% for a point target; briefly pulses the target (400ms ring in the cursor color) so the eye finds it.
- Acceptance: Clicking an avatar centers that cursor within 300ms and pulses it; jumping to a pin selects nothing but opens its thread; jumping to an off-screen layer from the layers panel shows the pulse; the target is never hidden behind the left/right panels (center in the visible canvas rect).
- Edge cases: target deleted mid-tween (abort); target already in view (no camera move, still pulse); cursor belongs to a disconnected user.
- Depends on: CANVAS-13, CANVAS-2
- Multi-agent note: agents can request "look here" (CANVAS-28), but the human's camera moves only by their own action.

### CANVAS-27: Follow cursor (spotlight / observe)
- Priority: P1
- Size: M
- Interaction: Click a participant avatar's "Follow" (or `Cmd/Ctrl+Shift+click` avatar) to lock your camera to theirs (Figma "Follow"): you see exactly their viewport; if their zoom differs, match it. A banner "Following Iris - click or press Esc to stop" tinted in their color; any manual pan/zoom/wheel stops following (Figma behavior). For agents (who have no camera), "follow" means keep their cursor within the inner 60% of your view with eased tracking (critically damped, ~250ms), without changing zoom. While following, the viewport tween is replaced by per-frame easing toward the target.
- Acceptance: Following an agent keeps its cursor on screen as it drives across a 5-frame board; wheel input immediately stops following and clears the banner; following a human mirrors their pan/zoom within 150ms; follow state is local only (not broadcast).
- Edge cases: followed cursor leaves the board or disconnects (banner "Iris left", stop); two followers of the same user; following while in presentation mode; rapid agent teleports (limit speed to avoid motion sickness: cap camera speed to 3000 px/s then ease).
- Depends on: CANVAS-13, CANVAS-26, MULTI viewport broadcast
- Multi-agent note: agents publish a `focus` rect (what they are working on) instead of a viewport; follow tracks that rect.

### CANVAS-28: Agent "show me" request with consent
- Priority: P2
- Size: S
- Interaction: An agent can post a `view` suggestion `{rect, reason}` rendered as a chip in chat and a dashed rectangle on the board; the human clicks the chip (or presses `Enter` on the toast) to animate there. Never auto-moves the human camera.
- Acceptance: Suggestion appears as chip + dashed rect in agent color; clicking animates to the rect; ignored suggestions expire after 30s; at most one pending suggestion per agent.
- Edge cases: rect already in view (suggestion suppressed); 10 agents suggesting at once (queue, collapse into "3 suggestions").
- Depends on: CANVAS-26
- Multi-agent note: central rule: only the owner of a viewport moves it.

### CANVAS-29: Off-screen cursor and activity indicators
- Priority: P1
- Size: M
- Interaction: When a cursor is outside the viewport, show a small arrow chip with the cursor's initial on the nearest view edge (clamped inset 12px, pointing toward it), in the cursor's color; hover shows name and status; click = go to (CANVAS-26). Group indicators within 24px into a count chip ("+3"). Today cursors outside the view silently clip (`playground.css:90`). Off-screen shape changes by agents show a brief edge glow on that side.
- Acceptance: Panning away from an active agent immediately shows its chip on the correct edge; chips for 50 cursors collapse into at most 8 chips per edge; chips are drawn in the rAF loop without React renders.
- Edge cases: cursors under panels (inset by panel bounds, use the visible canvas rect); chips overlapping the minimap/zoom controls (avoid by inset).
- Depends on: CANVAS-2, CANVAS-26
- Multi-agent note: central feature for 50+ agents: attention routing.

### CANVAS-30: Touch gestures (iPad / phone)
- Priority: P2
- Size: M
- Interaction: Two-finger drag pans; two-finger pinch zooms around the midpoint (Pointer Events with a tracked pointer map, since `touch-action: none` is set, `playground.css:73`); one-finger drag on empty canvas pans (Move tool) or draws (draw tools); two-finger tap = undo, three-finger tap = redo (Figma iPad); long-press opens context menu; Apple Pencil draws, finger pans. Cancel any in-flight draw when a second finger lands. Palm rejection: ignore touches with large `width/height` radius while the pen is down.
- Acceptance: Pinch zoom has no drift (midpoint stays under fingers); second finger during a draw cancels the shape cleanly; no browser pull-to-refresh or back-swipe; works on iPad Safari.
- Edge cases: pointercancel; finger lifts one at a time (rebase on remaining pointer without a jump); pinch crossing zoom clamps.
- Depends on: CANVAS-1, CANVAS-4
- Multi-agent note: n/a

### CANVAS-31: Safari trackpad gesture events and browser-zoom guards
- Priority: P1
- Size: S
- Interaction: On Safari, handle `gesturestart/gesturechange/gestureend` (scale, rotation ignored) to zoom, and `preventDefault` all of them on the board; block pinch-zoom of the whole page via `touch-action` and `wheel` ctrlKey interception already done (`:154`). Provide `meta name=viewport` check (`user-scalable=no` only on the playground route is not possible; rely on handlers). Also block the Back/Forward two-finger swipe overscroll with `overscroll-behavior: none` on `html, body` while the playground is mounted.
- Acceptance: Pinching on Safari zooms only the board; the page never scales; horizontal swipe does not navigate back; unmounting restores overscroll behavior.
- Edge cases: Firefox/Chrome do not emit gesture events (feature-detect); leaving the playground route must remove listeners and styles.
- Depends on: CANVAS-3
- Multi-agent note: n/a

### CANVAS-32: HiDPI and fractional-zoom crispness
- Priority: P1
- Size: M
- Interaction: Handle `devicePixelRatio` 1, 1.5, 2, 3 and changes (window dragged between monitors; `matchMedia('(resolution: Xdppx)')` listener). Canvas overlays (rulers, pixel grid, minimap, optional render layer) size their backing store to `cssSize * dpr` and `ctx.scale(dpr, dpr)`. Snap 1px lines to device pixel centers. For the DOM world layer, avoid compositor blur: snap `camera.x/y` to 1/dpr when not animating; avoid `will-change: transform` on `.pg-world` when idle at high zoom (Chrome keeps the old raster scale); optionally re-rasterize after zoom settles (toggle `will-change` for 150ms on zoom end).
- Acceptance: Text and 1px strokes are sharp on a 2x display at 100%, 200%, 33%; dragging the window across monitors with different dpr redraws overlays correctly; no blurry text after a zoom gesture ends.
- Edge cases: browser zoom 110% gives non-integer dpr; Windows scaling 125/150%; screenshots/export use their own scale (EXPORT domain).
- Depends on: CANVAS-1, CANVAS-35
- Multi-agent note: n/a

### CANVAS-33: Rendering backend decision (DOM vs SVG vs Canvas2D vs WebGL)
- Priority: P0
- Size: L
- Interaction: Decision record plus a pluggable `Renderer` interface so the choice can change without touching tools. Recommendation: stay on DOM for shapes for the hackathon demo (text editing, CSS filters, accessibility, easy agent debugging, already working) with culling (CANVAS-18) and LOD (CANVAS-16) keeping it fast to about 5k; use `<canvas>` 2D for overlays (grid, rulers, minimap, remote selection overlays); keep SVG for vector paths in DOM. Define `interface Renderer { mount(el); setCamera(cam); setShapes(diff); hitTest?; dispose() }` so a Canvas2D/WebGL (e.g. PixiJS, pending dependency approval) backend for 20k+ shapes can be swapped later. Spike: benchmark script that spawns N shapes and reports frame time while panning.
- Acceptance: Written ADR in this doc's Open questions resolved by a human; `window.board.bench(n)` reports median/p95 frame ms for N in {500, 2000, 5000} while auto-panning; target: p95 < 16.7ms at 2000 shapes, < 25ms at 5000 on the dev laptop.
- Edge cases: text in canvas needs custom shaping and IME for editing (why DOM stays for text); font loading before first paint; CSS box-shadow/filter cost scales with area, not count.
- Depends on: CANVAS-18
- Multi-agent note: agents' scripted edits run as store mutations, independent of the renderer.

### CANVAS-34: rAF loop budget and idle throttling
- Priority: P0
- Size: M
- Interaction: One shared rAF scheduler for camera flush, cursor painting (`:90-107`), tweens, minimap; subscribers register with a priority and a budget. Stop the loop when idle: no tweens, no cursor moving, no camera dirty (cursor loop wakes on cursor events). Pause entirely when `document.hidden`, run engine time forward by dt on return (clamped to 100ms to avoid jumps). Measure frame cost with `performance.now()`; if the frame exceeds 12ms for 30 frames, degrade: stop cursor trail effects, skip LOD-level text, lower minimap rate to 5Hz, and show a subtle "Performance mode" chip. Expose `window.board.perf` with fps, frame ms, mounted shape count, cursor count.
- Acceptance: Idle board uses ~0% CPU in the Chrome Performance panel; 50 cursors animating cost < 3ms/frame (transforms written once per frame, reads batched before writes to avoid layout thrash); hidden tab consumes none; perf chip appears when artificially throttled 4x.
- Edge cases: read/write layout interleaving per cursor (`getBoundingClientRect` in a loop); cursors count change mid-loop; 120Hz displays (use dt, not frame counts).
- Depends on: CANVAS-1
- Multi-agent note: the cursor DOM-write path is the hot path for 50+ agents; keep it free of React.

### CANVAS-35: Overlay canvas layer
- Priority: P1
- Size: M
- Interaction: A single full-size `<canvas>` above the world (pointer-events none) hosting rulers, pixel grid, snap guides (ALIGN), marquee, distance measurements, and selection extents, drawn immediate-mode from state each frame it is dirty. React owns DOM shapes; the overlay owns anything that changes every pointer move. API: `overlay.register(drawFn, zIndex)`; draw functions receive `ctx, cam, dpr, size`.
- Acceptance: Registering two draw functions composes in z-order; resize and dpr changes are handled; zero React renders while a guide is drawn at 60fps.
- Edge cases: context loss; canvas size limits (cap at 8192 CSS px, view is never that big); dark theme colors from CSS variables read once per theme change.
- Depends on: CANVAS-1, CANVAS-32
- Multi-agent note: remote users' marquees and guides can render here too.

### CANVAS-36: Viewport persistence in URL hash
- Priority: P1
- Size: S
- Interaction: Encode camera as `#/playground?v=x,y,z` (rounded: x,y to integers, z to 3 decimals) or `#/playground/x/y/z` after the existing hash route. Update with `history.replaceState` debounced 300ms after camera idle (never push history entries per pan). On load, parse and apply (no animation); `share()` (`:262-266`) copies a link with the viewport, and an option "Link to selection" includes a `node=<id>` param (Figma "Copy link to selection") which triggers go-to with pulse on open. Falls back to default camera on parse failure.
- Acceptance: Reload preserves view exactly; sending the link to another browser shows the same view region (up to window size: encode the visible center + zoom rather than raw x/y so different window sizes center the same point); malformed hash does not crash.
- Edge cases: hash router conflicts (dashboard uses `#/...` routes: confirm parsing is isolated to the playground); extremely precise floats; two tabs.
- Depends on: CANVAS-1, CANVAS-2
- Multi-agent note: agent "view-in-link" for debugging: `#/playground?...&follow=<agentId>`.

### CANVAS-37: Viewport persistence in localStorage
- Priority: P1
- Size: S
- Interaction: Persist last camera, ruler/pixel-grid/minimap toggles, pan-on-empty-drag, mouse-wheel mode under `pg.view.v1` (try/catch around reads/writes). On first load of a board with no hash, restore it; if content is not within the restored view (stale), fit instead. A "Reset view" menu item clears it.
- Acceptance: Settings survive reload; corrupt JSON is ignored; no exceptions in private mode.
- Edge cases: multiple boards (key by board id when BOARD domain exists); quota errors.
- Depends on: CANVAS-36
- Multi-agent note: n/a

### CANVAS-38: Smart initial view and first-paint framing
- Priority: P1
- Size: S
- Interaction: On first load with content and no saved view, fit content at max 100% zoom with margin (not the hard-coded `{x:60,y:90,z:0.55}`, `:45`). On an empty board center the origin with z=1 and show a faint "Drag to pan, scroll to zoom" hint (the existing hint, `:551`, hides after first pan/zoom and on touch devices shows touch wording). When agents add the first shapes to an empty board, do not move the human's camera; the minimap/indicators show it (CANVAS-29).
- Acceptance: Fresh load of demo seed shows all initial frames without manual zoom; hint disappears after interaction and does not return in the session.
- Edge cases: window resize before first fit (fit once layout settles, `ResizeObserver`).
- Depends on: CANVAS-10
- Multi-agent note: do not auto-fit when agents populate; only the first-run fit for seeded demo content.

### CANVAS-39: Resize handling (ResizeObserver, panel toggles)
- Priority: P0
- Size: S
- Interaction: Observe the view element with `ResizeObserver`. When the window or side panels (left layers, right chat) change size, keep the world point at the view center fixed (Figma keeps top-left; centering feels better with collapsing panels), unless the user's last action was a fit, in which case re-fit. `getBoundingClientRect` is cached per frame in a `viewRect` ref instead of queried on every pointer event (`:112`, `:117`, `:287`).
- Acceptance: Collapsing the right panel does not visibly shift the content under the viewer; no layout-thrash warnings in the profiler during resize; overlays resize with it.
- Edge cases: zero-size view (hidden tab); mobile virtual keyboard.
- Depends on: CANVAS-1, CANVAS-2
- Multi-agent note: n/a

### CANVAS-40: Snap-to-pixel for geometry and camera
- Priority: P1
- Size: S
- Interaction: Setting "Snap to pixel grid" (Figma default on): shape x/y/w/h round to integers during create, move, resize (rounding, not snapping guides, which is ALIGN). When off, allow decimals (hold `Cmd/Ctrl` while dragging to temporarily disable, Figma). Camera zoom steps at preset ladder aim at integer device pixels at 100%. Rendered positions at z=1 are pixel aligned (avoid fractional translate causing blurry edges).
- Acceptance: Drawing a rect at 100% produces integer coordinates; at 800% still integers when snap is on; hold-modifier produces fractional values; toggle visible in the zoom menu with a check.
- Edge cases: scaling a group yields fractional children (children keep exact values internally, display only); text baseline alignment; agent-authored coordinates are never rounded after the fact (only on interactive input).
- Depends on: CANVAS-11
- Multi-agent note: agent API accepts floats; snapping applies to human pointer input only.

### CANVAS-41: Presentation / focus view (hide chrome)
- Priority: P2
- Size: M
- Interaction: `Cmd/Ctrl+\` toggles UI (Figma "Show/Hide UI"): panels, toolbar, top bar fade out leaving the board, with a small floating "Exit" chip. In this view only pan/zoom/follow work. Useful for the demo screen-share.
- Acceptance: Shortcut toggles and restores the previous panel state; pan/zoom/follow still work; cursor chips remain.
- Edge cases: view resize on toggle uses CANVAS-39 (keeps center); focus inside input.
- Depends on: CANVAS-39
- Multi-agent note: great for the stage demo: audience watches agents design full-screen.

### CANVAS-42: Cursor and overlay stress mode (50+ cursors, 5k shapes)
- Priority: P1
- Size: M
- Interaction: `window.board.stress({shapes: 5000, agents: 50})` seeds a grid of synthetic frames and spawns lightweight agent cursors that wander and edit; reports frame stats from CANVAS-34. Cursor layer uses `contain: strict` + `will-change: transform` per cursor, name tags hidden when density is high (more than 12 on screen, show tags only for hovered / nearest 12), cursors beyond 200 draw as 4px dots.
- Acceptance: p95 frame < 16.7ms with 50 cursors and 2000 shapes visible; cursor tag decluttering keeps readability; script is dev-only (not in production bundle path).
- Edge cases: memory growth after repeated stress runs (cleanup), engine reset (`engine.reset`, `engine.ts:449`).
- Depends on: CANVAS-18, CANVAS-34
- Multi-agent note: the acceptance harness for MULTI performance claims.

### CANVAS-43: Accessibility and reduced motion for navigation
- Priority: P1
- Size: S
- Interaction: `prefers-reduced-motion` disables tweens, momentum and pulse animations. The board has `role="application"` with `aria-label`, zoom changes announced via a polite live region ("Zoom 150%"), keyboard-reachable zoom controls, focus ring on the zoom pill. Wheel handling must not break page scroll outside the board. Minimum on-screen hit size 24px for tiny shapes via tolerance (CANVAS-21).
- Acceptance: With reduced motion on, Shift+1 jumps instantly; screen reader announces zoom changes at most once per 500ms; Tab order includes zoom pill.
- Edge cases: high-contrast mode keeps dots visible (dot color from CSS var).
- Depends on: CANVAS-13
- Multi-agent note: n/a

### CANVAS-44: Canvas debug HUD and tests
- Priority: P0
- Size: S
- Interaction: `?debug` or `window.board.debug(true)` shows an overlay: camera x/y/z, visible world rect, mounted/total shapes, cursor count, fps/frame ms, dpr. Unit tests (vitest) for camera math (`zoomAt`, `fitRect`, round-trip), wheel classification, hit tests (ellipse, tolerance, z-order), spatial index vs brute force, URL hash codec. A Playwright smoke (if the repo has one; otherwise a documented manual script) verifies pan, zoom, fit, go-to.
- Acceptance: `npm test` in `dashboard/` runs the canvas tests; HUD numbers match `window.board.cam`; failing math tests block the PR.
- Edge cases: HUD must not intercept pointer events.
- Depends on: CANVAS-2
- Multi-agent note: lets agents building features verify camera behavior without a human at the keyboard.

## Data model and architecture implications
- Camera lives outside React: `camera.ts` with `type Cam = { x: number; y: number; z: number }` (x,y = screen-space translation of world origin in CSS px, z = scale; same convention as today, `Playground.tsx:15`). Public API: `getCam()`, `setCam(c, opts?)`, `subscribe(fn)`, `screenToWorld`, `worldToScreen`, `visibleWorldRect`, `zoomAt`, `fitRect`, `goTo(target, opts)`.
- `type GoToTarget = { shapeId: string } | { pinId: string } | { cursorId: string } | { rect: Rect } | { point: Pt }` and `type Follow = { cursorId: string; mode: 'viewport' | 'keep-in-view' } | null`.
- Shapes need cached world AABB (`bbox`) maintained by the store (not recomputed in render), plus `rotation?: number` before hit testing is finalized, so CANVAS-21 does not need rework; shape change events `added | updated | removed` feed the spatial index and culling.
- Peers publish presence as `{ cursorId, x, y, tool, viewport?: Rect, focus?: Rect }` in world coordinates (agents set `focus`, humans set `viewport`); the canvas module only consumes it for off-screen chips, minimap and follow.
- View settings object `ViewPrefs = { rulers, pixelGrid, minimap, scrollbars, snapToPixel, wheelMode: 'scroll'|'zoom', dragEmptyPans }` in localStorage and a React context for the menu; camera itself in the URL hash (CANVAS-36).
- Renderer boundary: `interface Renderer { mount; setCamera; setShapes(diff); dispose }` with the DOM implementation as default; overlay canvas registry (CANVAS-35) shared by ALIGN and SELECT.
- All other domains must use `hitTest`, `screenToWorld` and the overlay API instead of reading `getBoundingClientRect` or `camRef` directly.
- Single rAF scheduler (CANVAS-34) replaces the ad hoc loop at `Playground.tsx:90-107`.

## Open questions
1. DOM vs canvas/WebGL for shapes. Recommended: DOM + culling + canvas overlays for the hackathon; revisit if the 5k-shape benchmark (CANVAS-33) misses its budget.
2. Allow a new dependency for the spatial index (`rbush`, ~3KB) and/or a renderer (`pixi.js`)? Recommended: no, write the 60-line grid hash; defer pixi.
3. Mouse wheel default: scroll (Figma) or zoom (Miro)? Recommended: scroll, with a setting.
4. Should plain drag on empty canvas keep panning once marquee select exists? Recommended: no, marquee wins; pan stays on Space/Hand/middle (touch always pans).
5. Zoom range: keep 8%-400% or adopt Figma 2%-25600%? Recommended: 2%-25600% so pixel grid and 5k-shape overview both work.
6. Native system cursors vs the drawn human cursor (`cursor: none` today). Recommended: native for the human, drawn arrows only for remote cursors.
7. Follow semantics for agents, which have no viewport: keep-in-view easing vs requiring agents to publish a `focus` rect. Recommended: both, `focus` wins when present.
8. Viewport in URL: store raw x,y,z or center+zoom? Recommended: center+zoom so links work across window sizes.
9. Is touch/iPad a demo target? Recommended: no for the hackathon (P2), but keep Pointer Events based input so it can be added.
