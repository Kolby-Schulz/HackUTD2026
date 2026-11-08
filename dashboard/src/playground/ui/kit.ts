// The one place the board, UI store and chat sink are created, and the two page-level facts:
// who the local human is and whether this browser hosts the scripted agents.
import { makeActorId } from '../core/actors';
import { camera } from '../core/camera';
import { createBoard } from '../core/commands';
import type { BoardKit } from '../core/commands';
import { createPersistence, registerExtra } from '../core/persist';
import type { Persistence } from '../core/persist';
import { bindSnapSource } from '../core/snap/candidates';
import { toast } from '../core/toast';
import type { ActorId } from '../core/types';
import { chatSayHandler, createChatStore } from '../chat/store';
import type { ChatStore } from '../chat/store';
import { attachLocks } from '../presence/locks';
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

/** What the shell hands to boot: the chat sink and store, plus the autosave handle (loaded in useBoot's effect). */
export type ChatSink = { say: ((actor: ActorId, text: string) => void) | null; chat: ChatStore; persistence: Persistence | null };

/** True when the page was opened for the stage: start from the seed, never load or overwrite the saved board. */
export const DEMO = typeof location !== 'undefined' && /[?&]demo=1\b/.test(location.search + location.hash);

export function createKit() {
  const chat = createChatStore();
  const sink: ChatSink = { say: null, chat, persistence: null };
  // `chat.say` board commands (console, future bridge) post to the chat store and emit `message.created`
  let say: ReturnType<typeof chatSayHandler> | null = null;
  const board: BoardKit = createBoard({ me: humanId(), extra: (actor, cmd) => say?.(actor, cmd) });
  say = chatSayHandler(chat, board.events, (id) => board.actors.get(id));

  // humans win: lock-aware gestures, takeover revokes agent locks (must run before agents capture board.gesture)
  attachLocks(board, { toast: (text) => toast(text) });

  // snapping reads the live document, the shared spatial index and the camera
  bindSnapSource({
    get view() { return board.doc.getState(); },
    index: board.index,
    zoom: () => camera.getCam().z,
    viewport: () => camera.visibleRect(),
  });

  // autosave: the board plus chat survive a reload; `?demo=1` skips both load and save
  const persistence = createPersistence(board.doc, { boardId: 'playground', demo: DEMO, toast: (t, o) => toast(t, o) });
  registerExtra('chat', { get: () => chat.toJSON(), set: (v) => chat.load(v as Parameters<ChatStore['load']>[0]) });

  const ui = createUiStore();
  ui.set({ persistence });
  sink.persistence = persistence;
  return { board, ui, sink, persistence };
}

/** Where new agents appear: the middle of what the human is looking at. */
export const viewCenter = () => {
  const r = camera.visibleRect();
  return r.w > 0 ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 600, y: 300 };
};
