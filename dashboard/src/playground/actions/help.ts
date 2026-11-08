import type { Action } from '../core/types';
import { toggleHelp } from '../ui/HelpOverlay';

export const actions: Action[] = [
  { id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', keys: { all: ['Shift+Slash'] }, contexts: ['canvas', 'panel', 'dialog'], run: () => toggleHelp() },
];
