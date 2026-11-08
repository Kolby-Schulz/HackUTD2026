# Design variants (`#/variants`)

Compare UI variants side by side from **one branch**, pick one, or take slots from several and save
the result as a **mix**. A mix can be the final design or the starting point for new children.

Open it with `npm run dashboard`, then go to http://localhost:5173/#/variants.

## Layout on disk

```
src/designs/
  <screen>/
    screen.tsx              declares the slots and places them (defineScreen)
    <variant>/index.tsx     fills some or all slots (defineVariant); the folder name is its id
```

- **Screen**: `slots` maps slot id to label (`{ nav: 'Top nav', cta: 'Primary button', ... }`).
  `Layout` receives `slots` as elements and arranges them.
- **Root variant**: fills every slot.
- **Child variant**: `extends: '<id>'` (a variant or a mix) and fills only the slots it changes.
  The rest come from its parent.
- **Mix**: a row in SpacetimeDB (`variant_mix`) saying which node each slot comes from. Made in the page, not by hand.
- Picks, votes and generation jobs are SpacetimeDB rows too (`variant_pick`, `variant_vote`, `variant_job`), so every
  browser sees the same decisions live. Only code lives in git.

## Generating variants with the agent

Pick **Generate a child variant…** in a design's ⋯ menu and describe the change. The job is queued in SpacetimeDB;
the variant agent (`npm run variants-agent`, in `agents/variants/`) takes it, writes `<screen>/gen-<slug>/`,
typechecks the dashboard, commits only that folder and marks the job done with its token use. The dev server on the
agent's checkout shows it at once; other laptops and deployed builds show "not in this build" until they pull.

## Rules for variant code

- Style with CSS modules (`*.module.css`) or inline styles, so two variants on one screen don't clash.
- Use container queries (`@container (max-width: 800px)`), not media queries: the page renders each
  variant at the chosen design width (desktop / tablet / mobile) inside a container.
- Slot components take no props. Shared data goes in the variant's own module.
- A slot that crashes shows a red box; the rest of the page keeps working.

## Using the page

- The **left sidebar** shows the lineage tree. Click a node to show it in the focused pane; **+** opens it in a new pane (up to 4);
  **⑂** creates a child folder that extends it.
- **Pick A** in a pane header marks that variant as the final design.
- **Take a slot**: hover over a slot in any pane and click "Take … from B", or use the A/B/C/D buttons in the bottom bar.
  Slots you don't pick come from pane A. The **Result** pane previews the mix live.
- **Save mix**, **Save as final** or **Save & evolve** (save, then create a child folder from the mix).
- Click a slot name in the bottom bar (or press **I**) to compare just that slot across panes.
- The URL holds the screen, panes and viewport, so you can share a comparison as a link.
- Keys: `1`–`4` focus a pane, `↑`/`↓` show the next variant in the focused pane, `Shift+A`…`D` take every slot from that pane,
  `R` shows or hides the result, `Esc` clears.

## For agents writing variants

To try an idea, create a new folder with `extends` pointing at the current final design (or a mix), and override
only the slots you were asked to change. Never edit another variant's folder: that would change
every mix built from it.
