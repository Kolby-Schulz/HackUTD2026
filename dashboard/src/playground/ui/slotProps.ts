// Props every shell slot receives from ui/Playground.tsx. A slot that needs more reads it itself:
// camera from core/camera, toasts from core/toast, selection via useSelection(board), tool via useUi(ui, 'tool').
import type { BoardKit } from '../core/commands';
import type { AgentRuntime } from '../agents/runtime';
import type { UiStore } from './board/state';
import type { Meta } from './meta';

export interface SlotProps {
  board: BoardKit;
  ui: UiStore;
  /** The scripted-agent runtime (null until the page has booted). */
  rt: AgentRuntime | null;
  /** Every actor with a cursor (human, agents, API cursors) with presence status. */
  cursors: Meta[];
}
