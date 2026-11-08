// Tool actions (tool.*): one key each, canvas and panel focus only (typing never switches tools).
import type { Action } from '../core/types';
import { activeBoard } from '../ui/board/state';
import type { Tool } from '../ui/board/state';

export const TOOL_KEYS: Record<Tool, string> = { select: 'v', frame: 'f', rect: 'r', ellipse: 'o', text: 't', hand: 'h', comment: 'c' };
const TITLES: Record<Tool, string> = {
  select: 'Move', frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', hand: 'Hand',
  comment: 'Comment: point at a layer, the note goes to its agent',
};

/** Switch the board's tool (closes an open comment popover). */
export function setTool(tool: Tool) {
  const env = activeBoard();
  if (!env) return;
  env.ui.set({ tool, pop: null, hover: null });
}

export const actions: Action[] = (Object.keys(TOOL_KEYS) as Tool[]).map((tool) => ({
  id: `tool.${tool}`,
  title: TITLES[tool],
  group: 'Tools' as const,
  keys: { all: [TOOL_KEYS[tool]] },
  contexts: ['canvas', 'panel'],
  run: () => setTool(tool),
}));
