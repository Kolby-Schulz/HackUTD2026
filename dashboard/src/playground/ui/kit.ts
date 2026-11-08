// The one place the board, UI store and chat sink are created, and the two page-level facts:
// who the local human is and whether this browser hosts the scripted agents.
import { makeActorId } from '../core/actors';
import { camera } from '../core/camera';
import { createBoard } from '../core/commands';
import type { BoardKit } from '../core/commands';
import type { Persistence } from '../core/persist';
import { toast } from '../core/toast';
import type { ActorId } from '../core/types';
import { chatSayHandler, createChatStore } from '../chat/store';
import type { ChatStore } from '../chat/store';
import { attachClaims } from '../presence/claims';
import { attachLocks } from '../presence/locks';
import { createUiStore } from './board/state';
import type { UiStore } from './board/state';

/**
 * The local human's actor id. This is the ONLY place it is made: unique per person and per tab,
 * which a networked board needs. Everything else reads `board.me`.
 */
export function humanId(): ActorId {
  return makeActorId('human');
}

/** Live board through SpacetimeDB unless the page asks for the offline board (`?board=local`). */
export const LIVE = typeof location !== 'undefined' && !/[?&]board=local\b/.test(location.search + location.hash);

/** Only the offline board runs agents in the page. On the live board the agents run in the agent process
 *  (dashboard/agent), and every tab is a viewer that talks to them through SpacetimeDB. */
export const HOST_AGENTS = !LIVE;

/**
 * What the shell hands to boot: the chat sink and store and the UI store. Boot creates the autosave handle
 * (`persistence`) in its effect, because global registrations must not happen here: StrictMode runs this kit
 * factory twice and keeps one result.
 */
export type ChatSink = {
  say: ((actor: ActorId, text: string) => void) | null; chat: ChatStore; ui: UiStore; persistence: Persistence | null;
  /** Live board: send a chat message to the board's agents through SpacetimeDB (they run in the agent process). */
  remote: ((text: string, thread: string) => void) | null;
};

/** True when the page was opened for the stage: start from the seed, never load or overwrite the saved board. */
export const DEMO = typeof location !== 'undefined' && /[?&]demo=1\b/.test(location.search + location.hash);

export function createKit() {
  const chat = createChatStore();
  const ui = createUiStore();
  const sink: ChatSink = { say: null, chat, ui, persistence: null, remote: null };
  // `chat.say` board commands (console, future bridge) post to the chat store and emit `message.created`
  let say: ReturnType<typeof chatSayHandler> | null = null;
  const board: BoardKit = createBoard({ me: humanId(), extra: (actor, cmd) => say?.(actor, cmd) });
  say = chatSayHandler(chat, board.events, (id) => board.actors.get(id));

  // humans win: lock-aware gestures, takeover revokes agent locks (must run before agents capture board.gesture)
  attachLocks(board, { toast: (text) => toast(text) });
  // claims: frame/descendant/rect coverage, TTL sweep, contention conflicts, claim events
  attachClaims(board, { toast: (text) => toast(text) });

  // Global wiring (snap source, autosave, saved extras) lives in useBoot's effect, not here.
  return { board, ui, sink };
}

/** Where new agents appear: the middle of what the human is looking at. */
export const viewCenter = () => {
  const r = camera.visibleRect();
  return r.w > 0 ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 600, y: 300 };
};
