// The one place the board, UI store and chat sink are created, and the two page-level facts:
// who the local human is and whether this browser hosts the scripted agents.
import { makeActorId } from '../core/actors';
import { camera } from '../core/camera';
import { createBoard } from '../core/commands';
import type { ActorId } from '../core/types';
import { createUiStore } from './board/state';

/**
 * The local human's actor id. This is the ONLY place it is made: unique per person and per tab,
 * which a networked board needs. Everything else reads `board.me`.
 */
export function humanId(): ActorId {
  return makeActorId('human');
}

/** This browser runs the scripted agents (a networked viewer would pass false). */
export const HOST_AGENTS = true;

export type ChatSink = { say: ((actor: ActorId, text: string) => void) | null };

export function createKit() {
  const sink: ChatSink = { say: null };
  const board = createBoard({
    me: humanId(),
    // chat lives in the page for now; a `chat.say` board command (console, future bridge) lands in the same panel
    extra: (actor, cmd) => {
      if (cmd.t !== 'chat.say' || cmd.body.kind !== 'text') return undefined;
      sink.say?.(actor, cmd.body.text);
      return { ok: true };
    },
  });
  return { board, ui: createUiStore(), sink };
}

/** Where new agents appear: the middle of what the human is looking at. */
export const viewCenter = () => {
  const r = camera.visibleRect();
  return r.w > 0 ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 600, y: 300 };
};
