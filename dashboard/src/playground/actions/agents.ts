// Agent actions (AGENT-15): pause all / stop all / step. The runtime is owned by the page, so
// ui/AgentsPanel registers it here once it exists; until then the actions explain why they cannot run.
import type { AgentRuntime } from '../agents/runtime';
import type { Action } from '../core/types';

let runtime: AgentRuntime | null = null;
let allPaused = false;
/** Called by the agents panel when the runtime appears or goes away. */
export function setActionRuntime(rt: AgentRuntime | null) { runtime = rt; allPaused = false; }

const ready = () => (runtime?.hosting ? true : 'No agents run in this browser') as true | string;

export const actions: Action[] = [
  {
    id: 'agents.pauseAll', title: 'Pause / resume all agents', group: 'Agents', keys: { all: ['Mod+.'] },
    contexts: ['canvas', 'panel', 'chat', 'dialog'], when: ready,
    run() { allPaused = !allPaused; runtime?.setAllPaused(allPaused); },
  },
  {
    id: 'agents.stopAll', title: 'Stop all agents', group: 'Agents', keys: { all: ['Mod+Shift+.'] },
    contexts: ['canvas', 'panel', 'chat', 'dialog'], when: ready,
    run() { runtime?.stopAll('you'); },
  },
  {
    id: 'agents.step', title: 'Step agents (step mode)', group: 'Agents',
    contexts: ['canvas', 'panel'], when: ready,
    run() { runtime?.step(); },
  },
];
