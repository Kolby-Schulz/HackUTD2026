// Demo actions (AGENT-17): play, next, reset, stage mode. Keys only fire while the demo bar is showing.
// WP-67 takes this file over for the panic key and seed.
import type { Action } from '../core/types';
import { activeRunner, demoUi } from '../agents/demo';

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
    id: 'demo.stage', title: 'Demo: stage mode', group: 'View', contexts: ctx, keys: { all: ['Shift+s'] },
    run() { const s = demoUi.get(); demoUi.set(s.stage ? { stage: false } : { stage: true, visible: true }); },
  },
];
