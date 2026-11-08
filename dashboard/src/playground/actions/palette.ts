import type { Action } from '../core/types';
import { openPalette } from '../ui/CommandPalette';

export const actions: Action[] = [
  { id: 'palette.open', title: 'Command palette', group: 'Help', keys: { all: ['Mod+k'] },
    contexts: ['canvas', 'panel', 'chat', 'text-edit', 'palette', 'dialog'], run: () => openPalette() },
];
