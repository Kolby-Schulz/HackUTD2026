# Stage checklist: the 3-minute demo

Written from the code as of WP-67. Open `http://localhost:5173/#/playground?demo=1` (`npm run dashboard`).
Two people can run this from the page alone. Target: 3:00, hard limit 3:30.

## 0. Before going on stage (once)
- [ ] Screen 1920x1080, browser zoom 100%, full screen (F11). Do Not Disturb on, battery saver off.
- [ ] DevTools closed. Console clean after load (open it once, then close).
- [ ] Open the URL above in a fresh tab. `?demo=1` ignores and never overwrites the saved board, so no localStorage clearing is needed.
- [ ] Check: demo bar at the bottom, a seeded "Demo brief" frame at the top, no FPS HUD (the HUD stays off unless you toggle it).
- [ ] Agent speed 1x (Agents panel). Network is not needed.
- [ ] Press **Reset** once, then **Cmd+Shift+Backspace** once: both must return to the single "Demo brief" frame.
- [ ] Backup: screen recording of a full run, plus a pre-exported PNG, on the desktop.

Note: on load the page spawns 3 default agents. Reset removes them; the scripted run then spawns Iris, Juno and Milo itself.
Press **Reset** (or the panic key) before you start so the board is exactly the seed.

## 1. The run (button path, always works)
The demo bar plays the scripted pitch. Play = Shift+P, Next/skip = N, Reset = bar button. Keys only work while the bar shows and focus is not in a text field.

| Time | Do | Audience sees | If it fails |
| --- | --- | --- | --- |
| 0:00 | Say the pitch line. Click **Play**. | Caption "Three agents join the board"; Iris, Juno, Milo cursors appear one by one with name tags in the presence list. | No cursors: press Reset, then Play. |
| 0:15 | (Optional, live) Press **F**, drag a small frame in empty space, then **Cmd+Z**. | Frame snaps to whole numbers with a W x H pill; Cmd+Z removes only your frame. | Skip it; the script does not depend on it. |
| 0:30 | Talk over the build. Press **Shift+1** if the view drifts. | Caption "Each one builds its own frame, in parallel": cursors race, frames fill, layers tree grows. The script waits up to 40 s for all three to go idle. | Press **N** to skip the wait; a toast says agents were still busy. |
| 1:00 | Nothing; keep talking. | "Landing hero" frame appears, camera zooms to it, caption "Two agents reach for the same frame"; a conflict card shows in chat. | No conflict card: Reset and Play again. Backup recording. |
| 1:20 | Nothing. | Coordinator line in chat: Iris keeps the hero, Juno takes pricing copy. | Skip with N. |
| 1:35 | Nothing (script types for you). | Chat shows "@Iris make it purple"; Iris's cursor flies to the button and recolours it; an action card with **Undo** appears. | If the card is missing a toast says so; click into chat and type `@Iris make it purple` yourself. |
| 1:55 | Click **Undo** on the action card. | Only Iris's change reverts (button back). | If the button is disabled ("Changed since"), press Cmd+Z instead. |
| 2:10 | Marquee-drag three cards, press **Alt+W** (align tops), change fill in the inspector, double-click a layer name to rename. | Align, inspector and layers all update; each is one undo step. | Skip; mention it. |
| 2:30 | Select a frame, press **Cmd+K**, type "export", Enter. | PNG downloads. Palette also has "Copy link to this view". | Skip; show the pre-exported PNG. |
| 2:45 | Press **Shift+1**. In the browser console run `board.stress({agents: 50})`. Optionally toggle the debug HUD from Cmd+K ("Toggle debug HUD"). | 50 extra cursors, still smooth; HUD ~60 fps. | Reload (the stress agents vanish) and carry on. |
| 3:00 | Reload the page. | Page reloads; with `?demo=1` the board returns to the seed (demo mode does not load saved boards). Say "outside demo mode the board and chat survive reload". | n/a |

## 2. Recovery
- **Anything odd at any moment: Cmd+Shift+Backspace.** Resets to the seed instantly, no confirm, only with `?demo=1`. A toast offers Undo. Then click Play.
- **Wrong key:** Cmd+Z undoes only your last move; agent work stays.
- **Stuck step:** N skips the step in flight.
- **Page frozen or crashed:** reload the same URL (still `?demo=1`), press Play.
- **Last resort:** play the backup recording.

## 3. Not built yet (do not promise on stage)
- Present mode (slot is empty; Present action list is empty).
- Share link restores view only, not content (by design).
- Beat "human drags a rectangle an agent is drawing" is manual: drag a layer while an agent builds; toast "You took over from X". Not scripted.
- Manual comment beat: press **C**, click the button, type "make it purple" (the scripted run does this via chat instead).
