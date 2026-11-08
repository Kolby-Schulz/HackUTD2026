// CSS cursor for the board per tool / hover target. Stub: the default (the board draws its own
// pointer, so the view keeps `cursor: none`); handles carry their own resize cursors.
import type { Tool } from './state';

export function cursorFor(_tool: Tool, _hover?: string | null): string {
  return 'default';
}
