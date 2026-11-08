// Demo seed (SHELL-25/26): the deterministic starting board for `?demo=1`, and the reset that returns to it.
// Pure board commands, no React or DOM. The seed is one small "Demo brief" frame placed ABOVE the agents' slot grid
// (slots start at y=40) and clear of the scripted "Landing hero" frame, so nothing the script builds lands on it.
// `registerDemoSeed()` plugs seed and reset into WP-66's `demoHooks`; the runner calls them on first play and on reset.
import { opId } from '../core/ids';
import type { BoardKit } from '../core/commands';
import type { Command } from '../core/types';
import { demoHooks } from './demo';
import type { DemoEnv } from './demo';

/** Deleted ids stay taken (tombstones), so each generation of the seed uses a fresh id prefix: seed-brief, seed2-brief, ... */
const frameId = (gen: number) => (gen <= 1 ? 'seed-brief' : `seed${gen}-brief`);
export const SEED_ID = frameId(1);
const INK = '#2b2a26', PAPER = '#f4f2ec', ACCENT = '#d97757';

/** The seed as one command list: a frame with a title, a subtitle and three chips (5 layers). */
export function seedCommands(gen = 1): Command[] {
  const P = gen <= 1 ? 'seed' : `seed${gen}`, FRAME = frameId(gen);
  const text = (id: string, name: string, t: string, x: number, y: number, w: number, size: number, weight: number): Command => ({
    t: 'shape.create', kind: 'text', id, parent: FRAME,
    props: { name, text: t, x, y, w, h: Math.round(size * 1.4), fontSize: size, fontWeight: weight, fills: [{ type: 'solid', color: INK }] },
  });
  const chip = (id: string, name: string, x: number, color: string): Command => ({
    t: 'shape.create', kind: 'rect', id, parent: FRAME,
    props: { name, x, y: 150, w: 130, h: 40, radius: 20, fills: [{ type: 'solid', color }] },
  });
  return [
    { t: 'shape.create', kind: 'frame', id: FRAME, props: { name: 'Demo brief', x: 0, y: -380, w: 480, h: 240, radius: 12, fills: [{ type: 'solid', color: PAPER }] } },
    text(`${P}-title`, 'Brief title', 'Landing page for Contract', 32, 32, 416, 28, 700),
    text(`${P}-sub`, 'Brief subtitle', 'Hero, stats, profile card', 32, 84, 416, 16, 400),
    chip(`${P}-chip-1`, 'Hero', 32, ACCENT),
    chip(`${P}-chip-2`, 'Stats', 175, '#6a9bcc'),
    chip(`${P}-chip-3`, 'Profile', 318, '#788c5d'),
  ];
}

/** First generation whose frame id was never used on this board. */
const nextGen = (board: BoardKit) => { let g = 1; while (board.doc.getState().shapes.has(frameId(g))) g++; return g; };
/** Is the current seed frame on the board and not deleted? */
const liveSeed = (board: BoardKit) => { const s = board.doc.getState().shapes.get(frameId(Math.max(1, nextGen(board) - 1))); return !!s && !s.deleted; };

/** Fill the starting board. Idempotent: does nothing when the seed is already there. */
export function seedBoard(env: Pick<DemoEnv, 'board'>) {
  const { board } = env;
  if (liveSeed(board)) return;
  board.exec({ actor: board.me, opId: opId(board.me), label: 'Demo: seed', commands: seedCommands(nextGen(board)) });
}

/** Back to the seed in ONE undoable batch: delete every top-level layer, then lay the seed down again. */
export function resetToSeed(env: Pick<DemoEnv, 'board'>) {
  const { board } = env;
  const st = board.doc.getState();
  const roots = [...(st.children.get(null) ?? [])].filter((id) => !st.shapes.get(id)?.deleted);
  const commands: Command[] = [];
  if (roots.length) commands.push({ t: 'shape.delete', ids: roots });
  commands.push(...seedCommands(nextGen(board)));
  board.exec({ actor: board.me, opId: opId(board.me), label: 'Demo: reset', commands });
}

/** Hook the seed into the demo runner. Safe to call more than once. */
export function registerDemoSeed() {
  demoHooks.seed = seedBoard;
  demoHooks.reset = resetToSeed;
}
