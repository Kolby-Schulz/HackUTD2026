// Demo actions (AGENT-17): play, next, reset, stage mode. Keys only fire while the demo bar is showing.
// WP-67: registers the demo seed/reset and the panic key (Mod+Shift+Backspace, only with `?demo=1`).
import type { Action } from '../core/types';
import { activeRunner, demoUi } from '../agents/demo';
import { registerDemoSeed, resetToSeed } from '../agents/seed';
import { toast } from '../core/toast';
import { activeBoard } from '../ui/board/state';
import { DEMO } from '../ui/kit';

registerDemoSeed();   // the runner seeds on first play and calls this reset on Reset

/** Panic: reset to the seed at once, no confirm. One toast offers Undo (restores the layers, not the stopped agents). */
export function panic() {
  const env = activeBoard();
  const runner = activeRunner();
  if (runner) runner.reset();
  else if (env) resetToSeed({ board: env.board });
  else return;
  const board = env?.board;
  toast('Demo reset', { variant: 'info', ttlMs: 6000, key: 'demo.panic', action: board ? { label: 'Undo', run: () => { board.undo(board.me); } } : undefined });
}

const demoOnly = (): true | string => (DEMO ? true : '');
const live = (): true | string => (demoUi.get().visible && activeRunner() ? true : '');
const ctx: Action['contexts'] = ['canvas', 'panel'];

export const actions: Action[] = [
  {
    id: 'demo.play', title: 'Demo: play / pause', group: 'Agents', contexts: ctx, keys: { all: ['Shift+p'] }, when: live,
    run() { const r = activeRunner(); if (!r) return; if (r.getState().status === 'playing') r.pause(); else r.play(); },
  },
  { id: 'demo.next', title: 'Demo: next step', group: 'Agents', contexts: ctx, keys: { all: ['n'] }, when: live, run() { activeRunner()?.next(); } },
  { id: 'demo.reset', title: 'Demo: reset', group: 'Agents', contexts: ctx, when: live, run() { activeRunner()?.reset(); } },
  {
    id: 'demo.panic', title: 'Demo: panic reset', group: 'Agents', contexts: ['canvas', 'panel', 'chat', 'text-edit'], keys: { all: ['Mod+Shift+Backspace'] }, when: demoOnly, run: panic,
  },
  {
    id: 'demo.stage', title: 'Demo: stage mode', group: 'View', contexts: ctx, keys: { all: ['Shift+s'] },
    run() { const s = demoUi.get(); demoUi.set(s.stage ? { stage: false } : { stage: true, visible: true }); },
  },
];
