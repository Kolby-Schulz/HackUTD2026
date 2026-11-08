# <Domain name>

Scope: one paragraph. What this domain covers and what it leaves to other domains (name them).

## Today
What the current playground already does in this domain, with file:line citations. What is missing or wrong.

## Features
One block per feature. Be exhaustive: list everything Figma, Penpot, tldraw, Excalidraw, Sketch and Claude Design do in this
domain, then everything a multi-agent board needs on top. Aim for 30+ features per domain; small ones count.

### <ID>: <Feature name>
- Priority: P0 (demo MVP must-have) | P1 (makes the demo feel real) | P2 (later)
- Size: S (<1h for an agent) | M (1-3h) | L (3h+ / split it)
- Interaction: exact behavior. Keys, modifiers, mouse, touchpad, what the pointer shows, what the UI shows, timing.
- Acceptance: 2-5 checkable statements a reviewer can verify in the browser.
- Edge cases: the awkward ones (zoomed out, rotated, nested in a frame, 200 agents, offline, empty board, mid-drag undo...).
- Depends on: feature IDs, in this domain or others (<DOMAIN>-<n>).
- Multi-agent note: how it behaves when an agent (not the human) does it, or when two cursors do it at once. Skip if n/a.

## Data model and architecture implications
What the shape/document/engine types need (fields, events, commands) so these features can be built without rewrites.
Be concrete: TypeScript type sketches are welcome.

## Open questions
Decisions a human should make. Give a recommended default for each.
