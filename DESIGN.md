---
version: alpha
name: InSync Workbench
description: >-
  The InSync dashboard's editor-style workbench (title bar, side bar, editor, panel, chat,
  status bar) dressed in the warm paper surfaces, soft floating tools and serif agent voice
  of the Claude Design-style board. One blue for actions, clay for the agents' voice.
colors:
  primary: "#2563eb"
  primary-hover: "#1d4ed8"
  primary-soft: "#eef3fe"
  on-primary: "#ffffff"
  secondary: "#d97757"
  secondary-strong: "#b5532f"
  secondary-soft: "#fbe9e2"
  on-secondary-soft: "#9a3f22"
  neutral: "#f3f2ee"
  surface: "#ffffff"
  surface-sunken: "#faf9f5"
  surface-hover: "#f1efe9"
  surface-active: "#efece4"
  line: "#e6e3dc"
  line-strong: "#d6d3cd"
  dot: "#c9c4b8"
  on-surface: "#1c1917"
  on-surface-variant: "#57534e"
  muted: "#6b655f"
  success: "#1a7f37"
  success-soft: "#eef8f0"
  warning: "#a35200"
  warning-soft: "#fdf0dc"
  error: "#b42318"
  error-soft: "#fef3f2"
  done: "#8250df"
  done-soft: "#f7f3fe"
  code-bg: "#1c1917"
  code-ink: "#e7e5e0"
  agent-1: "#bf3989"
  agent-2: "#1a7f37"
  agent-3: "#8250df"
  agent-4: "#bc4c00"
  agent-5: "#0a7d84"
  agent-6: "#0969da"
  coordinator: "#6b655f"
typography:
  display-hero:
    fontFamily: Unbounded Variable
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -0.02em
  display-wordmark:
    fontFamily: Unbounded Variable
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1
  headline-md:
    fontFamily: -apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: -apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.3
  body-lg:
    fontFamily: -apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  body-md:
    fontFamily: -apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: -apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  label-md:
    fontFamily: -apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.2
  label-caps:
    fontFamily: -apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif
    fontSize: 11px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0.06em
  prose-md:
    fontFamily: ui-serif, Georgia, Times New Roman, serif
    fontSize: 14.5px
    fontWeight: 400
    lineHeight: 1.5
  mono-md:
    fontFamily: JetBrains Mono Variable, ui-monospace, Menlo, monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
  mono-sm:
    fontFamily: JetBrains Mono Variable, ui-monospace, Menlo, monospace
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
  number-lg:
    fontFamily: -apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif
    fontSize: 36px
    fontWeight: 800
    lineHeight: 1
    letterSpacing: -0.03em
    fontFeature: '"tnum" 1'
rounded:
  none: 0px
  xs: 3px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  base: 4px
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  titlebar: 40px
  pane-head: 36px
  statusbar: 24px
  row: 30px
  control: 28px
  side-bar: 264px
  chat: 340px
components:
  app-canvas:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
  titlebar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    height: "{spacing.titlebar}"
  wordmark:
    textColor: "{colors.on-surface}"
    typography: "{typography.display-wordmark}"
  side-bar:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.on-surface}"
    width: "{spacing.side-bar}"
  pane-head:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-caps}"
    height: "{spacing.pane-head}"
  editor-tab:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.muted}"
    typography: "{typography.body-md}"
    height: "{spacing.pane-head}"
  editor-tab-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
  list-row:
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.row}"
  list-row-hover:
    backgroundColor: "{colors.surface-hover}"
  list-row-selected:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.on-surface}"
  statusbar:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    height: "{spacing.statusbar}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: 10px
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.on-surface}"
  button-ink:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: 10px
  button-danger:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: 12px
  button-ghost:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: 8px
  icon-button:
    textColor: "{colors.on-surface-variant}"
    rounded: "{rounded.sm}"
    size: "{spacing.control}"
  icon-button-on:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
  agent-send:
    backgroundColor: "{colors.secondary-strong}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    size: 30px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: 8px
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.xl}"
    padding: 10px
  segmented:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 2px
  segmented-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    height: 24px
    padding: 10px
  chip-selected:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
  tag:
    backgroundColor: "{colors.surface-active}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.xs}"
    padding: 4px
  agent-badge:
    backgroundColor: "{colors.agent-1}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.xs}"
    size: 18px
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
  input-border:
    backgroundColor: "{colors.line-strong}"
    height: 1px
  canvas-dot:
    backgroundColor: "{colors.dot}"
    size: 2px
  agent-badge-2:
    backgroundColor: "{colors.agent-2}"
    textColor: "{colors.on-primary}"
  agent-badge-3:
    backgroundColor: "{colors.agent-3}"
    textColor: "{colors.on-primary}"
  agent-badge-4:
    backgroundColor: "{colors.agent-4}"
    textColor: "{colors.on-primary}"
  agent-badge-5:
    backgroundColor: "{colors.agent-5}"
    textColor: "{colors.on-primary}"
  agent-badge-6:
    backgroundColor: "{colors.agent-6}"
    textColor: "{colors.on-primary}"
  coordinator-badge:
    backgroundColor: "{colors.coordinator}"
    textColor: "{colors.on-primary}"
  status-working:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
  status-paused:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
  status-conflict:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.error}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
  status-done:
    backgroundColor: "{colors.done-soft}"
    textColor: "{colors.done}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 12px
  popover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 6px
  floating-toolbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 5px
  tool-selected:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    size: 36px
  tooltip:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
    padding: 6px
  agent-message:
    textColor: "{colors.on-surface}"
    typography: "{typography.prose-md}"
  user-bubble:
    backgroundColor: "{colors.surface-active}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.xl}"
    padding: 10px
  agent-highlight:
    backgroundColor: "{colors.secondary-soft}"
    textColor: "{colors.on-secondary-soft}"
    rounded: "{rounded.md}"
  code-block:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-ink}"
    typography: "{typography.mono-md}"
    rounded: "{rounded.md}"
    padding: 10px
  code-inline:
    backgroundColor: "{colors.surface-active}"
    textColor: "{colors.on-surface}"
    typography: "{typography.mono-md}"
    rounded: "{rounded.xs}"
    padding: 4px
  metric:
    textColor: "{colors.on-surface}"
    typography: "{typography.number-lg}"
  toast:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 10px
  banner-error:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.error}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 10px
---

# InSync Workbench

## Overview

InSync is a control room for many coding agents working in one repository, with humans
steering. The UI combines two parents:

- **Structure from Tyler's workbench** (main, PR #48): one screen laid out like a code
  editor. A title bar holds the run picker. Below it are an agents side bar, a central editor
  with tabs (code map, control), a bottom panel (Savings, Problems), a chat column and a blue
  status bar. Panes resize and collapse like VS Code. The workbench is dense (13px UI text), separates
  areas with hairlines instead of cards, uses monospace for anything that names code, and
  uses Unbounded only for the wordmark.
- **Surface and voice from the Claude Design-style board** (`#/playground`): warm paper
  neutrals instead of cool greys, ink-black text, soft rounded floating tools (toolbar,
  menus, composer) with warm shadows, pill chips for threads and filters, and agents that
  speak in a serif. That serif is the one place the UI feels like correspondence rather than a tool.

The result should feel like a **calm, well-lit studio**: professional and information-dense like
an IDE, warm and humane like a notebook. It should never feel like a terminal (dark, neon) or
a marketing page (big gradients, hero type inside the product).

Two accent roles keep meaning clear:
- **Blue is InSync.** It marks actions, focus, selection, the active tab and the status bar.
- **Clay is the agents' voice.** It marks the spark on agent-written content, the send-to-agents
  button and highlights on what an agent just did. It never marks a generic button.

## Colors

The palette is warm neutrals, ink text, one blue and one clay, plus status colours and a fixed
set of agent identity colours.

- **Primary, InSync Blue (#2563eb):** the only colour for primary actions, focus rings,
  selection outlines on the canvas, the selected editor tab underline and the status bar.
  Hover darkens to #1d4ed8. Selected rows and pressed toggles use Blue Mist (#eef3fe).
- **Secondary, Clay (#d97757):** the agents' voice. Use it for decoration only: the spark
  icon, dots, washes, the left rule of an agent action card. For clay text, icons or a filled
  button with white text, use **Burnt Clay (#b5532f)**, which passes AA. A wash behind an agent's
  latest work is Clay Mist (#fbe9e2) with text in #9a3f22.
- **Neutral, Paper (#f3f2ee):** the app canvas and the code map's dotted background (dots
  #c9c4b8). Panels sit on **White (#ffffff)**. Side bars and the chat column use **Sunken
  Paper (#faf9f5)**, so the editor reads as the lit centre.
- **Ink (#1c1917):** all primary text, the selected tool in the floating toolbar, tooltips and
  toasts (inverted). Secondary text is **Stone (#57534e)**. Hints, timestamps and placeholders
  are **Pebble (#6b655f)**, the lightest grey allowed for text on Paper.
- **Lines:** hairlines are #e6e3dc. Use #d6d3cd for input borders and hover outlines.
- **Status:** success #1a7f37, warning #a35200, error #b42318, done #8250df. Each has a
  matching soft fill (`*-soft`) for chips, banners and row tints. Paused agents tint amber,
  resumed agents flash green, and conflicts tint red. These carry over from the workbench.
- **Agents:** six identity colours, assigned in order (magenta, green, violet, orange, teal,
  azure) and stable for a run. All pass AA with white letters, so badges and cursor labels can
  be filled. The coordinator is always Pebble (#6b655f) and never takes an agent colour.
  Agent colours appear only on that agent's things: its badge, cursor, claim outline, chat
  dot and the left rule of its cards. Never use them for UI chrome.

## Typography

Four families, each with one job:

- **UI sans** (system stack: SF Pro, Segoe UI, Inter): everything interactive. Body is 13px
  (`body-md`), the composer and chat bubbles are 14px (`body-lg`), and metadata is 12px
  (`body-sm`). Section headers in panes are 11px bold uppercase with 0.06em tracking (`label-caps`).
  Headlines are rare: 15px (`headline-sm`) for card and dialog titles, 20px (`headline-md`)
  for empty states.
- **Serif** (`prose-md`, ui-serif / Georgia, 14.5px / 1.5): what agents *say*. That means
  agent chat messages, the assistant's replies and empty-state invitations. Never use it for
  labels, buttons or data.
- **JetBrains Mono** (`mono-md` 12px, `mono-sm` 11px): symbol names, file paths, signatures,
  run ids, timestamps and token counts. If it could be pasted into a terminal, it is mono.
- **Unbounded** (`display-wordmark` 14px, `display-hero` 40px): the InSync wordmark in the
  title bar and the intro title card. Nowhere else.

Large numbers in the Savings panel use `number-lg` (36px, 800, tabular figures). A zero is
shown in Pebble, so empty results don't shout.

## Layout

The layout is a fixed **workbench grid** that fills the viewport and never scrolls as a page:

```
title bar            40px  wordmark | run picker (centred) | pane toggles
side bar | editor | chat   side bar 264px, chat 340px, both resizable and collapsible
         | panel           bottom panel, resizable, collapsible
status bar           24px  blue
```

- Panes are separated by 1px hairline sashes. Dragging resizes; double-click or Enter
  collapses. Sizes persist per browser.
- The spacing scale is **4px-based**: 2, 4, 8, 12, 16, 24, 32. Inside panes use 8 to 12px
  gaps and 12 to 16px gutters. Larger spacing appears only in empty states and dialogs.
- Rows are 30px and controls (buttons, inputs, segmented controls) are 28px tall. Pane
  headers and editor tabs are 36px.
- The editor area is a **canvas**: Paper with a 20px dot grid. Floating tools (toolbar, zoom,
  hints) sit over it and don't push content around. The floating toolbar is centred 18px from the bottom.
- Under 1100px the chat collapses to an icon. Under 760px the side bar collapses and panes stack.

## Elevation & Depth

Depth comes mostly from **tone**, not shadow:

1. Paper canvas (lowest), then White panels, with Sunken Paper side columns.
2. Hairlines separate docked panes. Docked chrome never has a shadow.
3. Shadows are only for things that **float above the canvas**, always warm-tinted
   (ink at low alpha):
   - frames and cards on the canvas: `0 1px 3px rgba(28,25,23,.06), 0 8px 24px rgba(28,25,23,.06)`
   - floating toolbar and composer: `0 6px 24px rgba(28,25,23,.10)`
   - menus and popovers: `0 10px 30px rgba(28,25,23,.12)`
   - dialogs: `0 12px 36px rgba(28,25,23,.18)` over a `rgba(28,25,23,.35)` scrim

Focus is a 2px InSync Blue outline with a 1 to 2px offset, on every interactive element.

## Shapes

Small, consistent radii. Docked UI is crisp and floating UI is softer:

- **3px (`xs`):** tags, code chips, tooltips, dimension pills.
- **6px (`sm`):** buttons, inputs, list rows, code-map nodes, segmented controls (from the workbench).
- **8px (`md`):** toasts, code blocks, menu items, the agent send button.
- **12px (`lg`):** cards, popovers, menus and the floating toolbar (from the board).
- **16px (`xl`):** the chat composer and chat bubbles (from the board).
- **Full:** chips, avatars, status pills and agent dots.

Icons are 16px line icons with a 1.7 to 1.8px stroke and round caps and joins, drawn in
`currentColor`. Don't use filled icon sets, and never use emoji as icons.

## Components

- **Title bar:** White, 40px. The left holds the wordmark and the lanes logo. The run picker sits in
  the centre as a quiet 26px field with a mono value. Pane toggles on the right are icon buttons
  that turn Blue when pressed.
- **Side bar (agents):** Sunken Paper. Each agent row shows its badge (18px square in the agent's colour with
  a white letter), its name, a status pill and a 4px token-spend bar. Expanding a row shows the agent's
  latest lines with a 2px left rule in its colour. Paused rows tint amber.
- **Editor tabs:** 36px on Sunken Paper. The selected tab is White with a 2px Blue top inset.
  Breadcrumbs below are 12px Stone, and the current step is Blue.
- **Code map nodes:** White 172 by 48px cards with 6px radius and a 1.5px line border, a mono name and a mono file
  path. They are dashed when planned, outlined in an agent's colour when claimed, red with a red halo
  when conflicted, and pulse amber once when changed.
- **Buttons:** primary is Blue, used once per area for the main action. Secondary is White with a #d6d3cd
  border. Ink is a black fill for a single decisive confirm on the canvas (as in the board's
  "Start agents"). Ghost is text only for low-emphasis actions. Danger is red and only for destructive
  actions, which always ask first.
- **Agent send:** a 30px Burnt Clay square in the composer. It is the only clay-filled control.
- **Composer:** White, 16px radius, the floating shadow and a #e6e3dc border that darkens on
  focus. Target chips (which agents to address) sit above the send row.
- **Chips:** 24px pills on White with a hairline border. Selected chips use Blue Mist with Blue text.
  Thread chips show the agent's colour dot and an unread count in a filled pill of that colour.
- **Segmented control:** a Stone-on-#f1efe9 track holding a White selected segment with the
  smallest shadow. Use it for 2 to 4 mutually exclusive views, such as viewport or panel mode.
- **Chat:** agent messages are serif text after a 26px avatar, with no bubble. Human
  messages are right-aligned 14px sans bubbles on #efece4. System lines are centred 11.5px Pebble.
  An **agent action card** is White with a 3px left rule in the agent's colour, a one-line summary,
  chips for changed items and a quiet Undo.
- **Cards and popovers:** White, 12px radius, hairline border, floating shadow only when they
  float. Popovers have a Sunken Paper header row.
- **Status bar:** InSync Blue, 24px, white 12px text in bold segments. It holds run state, the agent
  count and savings. Buttons in it get a 15% white hover.
- **Toasts:** inverted Ink, 8px radius, bottom-centre, 3 seconds. Errors stay until dismissed and
  use the error banner style instead.
- **Empty states:** a centred `headline-md` line, one serif sentence in Stone, then one to three
  example chips. No illustrations.

### Comparison surfaces (design variants)

The variant picker uses the same parts. Panes are editor panes with a pane header. Each pane's letter
(A, B, C, D) is an agent-style badge in the first four agent colours. Picking a slot uses
chips, and the live result is a pane with a dashed hairline border. Designs render on
White inside the Paper canvas with the canvas-frame shadow, never directly on chrome.

## Do's and Don'ts

- Do keep Blue for actions, focus and selection, and Clay for agent voice. Never swap them, and never
  add a third accent.
- Do use Burnt Clay (#b5532f), not Clay (#d97757), whenever clay carries text or white text sits on it.
- Do use agent colours only for that agent's own marks. Don't tint chrome, headers or buttons with them.
- Do set anything that names code (symbols, paths, ids, counts) in JetBrains Mono.
- Do write agent speech in the serif and everything else in the sans. Don't put serif in buttons.
- Don't use Unbounded outside the wordmark and the title card.
- Don't put shadows on docked panes. Hairlines separate docked areas, and shadows mean "floating".
- Don't use pure grey (#888, #ccc) or cool blue-grey neutrals. Every neutral comes from the warm
  scale above.
- Don't use gradients, glows or glassmorphism in the product UI. The intro title card is
  the only exception.
- Do keep body text at 13px and rows at 30px. Density is a feature. Don't add padding to look "premium".
- Do maintain WCAG AA: 4.5:1 for text, 3:1 for icons and focus rings. Pebble is the lightest text grey.
- Do respect `prefers-reduced-motion`: pulses, slide-ins and cursor drift switch off. Keep motion
  under 300ms except for status flashes (up to 2.4s, fading).
