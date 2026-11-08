// Page boot: key dispatcher, view shortcuts, the agent runtime with three agents, window.board.
// The ONE startAgents call lives here, with the host flag.
import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { agentChatHooks } from './chat/agentChat';
import { createChoreographer } from '../agents/choreographer';
import type { Choreographer } from '../agents/choreographer';
import { startAgents } from '../agents/runtime';
import type { AgentRuntime } from '../agents/runtime';
import type { BoardKit } from '../core/commands';
import { installDevtools } from '../core/devtools';
import { camera } from '../core/camera';
import { createPersistence, registerExtra } from '../core/persist';
import { bindSnapSource } from '../core/snap/candidates';
import { toast } from '../core/toast';
import type { ChatStore } from '../chat/store';
import { commentThreads } from '../comments/threads';
import { install as installKeys } from '../core/keys';
import { registerViewFallbacks } from './board/viewActions';
import { applyViewFromUrl } from '../actions/share';
import { DEMO, HOST_AGENTS, viewCenter } from './kit';
import type { ChatSink } from './kit';

/** Boots the page; `rtRef` mirrors the returned runtime for callbacks that must not re-render on it. */
export function useBoot(board: BoardKit, sink: ChatSink, rtRef: MutableRefObject<AgentRuntime | null>, onTeardown: () => void): AgentRuntime | null {
  const [rt, setRt] = useState<AgentRuntime | null>(null);
  const teardown = useRef(onTeardown);
  teardown.current = onTeardown;

  useEffect(() => {
    // core/keys install() types its target with `(e: never)` listeners, which Window does not satisfy
    const offKeys = installKeys(window as unknown as Parameters<typeof installKeys>[0]);
    const offView = registerViewFallbacks();
    // Global wiring happens here (with cleanup), never in createKit: StrictMode calls the kit factory twice.
    // Snapping reads the live document, the shared spatial index and the camera.
    bindSnapSource({
      get view() { return board.doc.getState(); },
      index: board.index,
      zoom: () => camera.getCam().z,
      viewport: () => camera.visibleRect(),
    });
    // Autosave: board, chat and comment threads survive a reload; `?demo=1` skips both load and save.
    const persistence = createPersistence(board.doc, { boardId: 'playground', demo: DEMO, toast: (t, o) => toast(t, o) });
    const offExtras = [
      registerExtra('chat', { get: () => sink.chat.toJSON(), set: (v) => sink.chat.load(v as Parameters<ChatStore['load']>[0]) }),
      registerExtra('comments', { get: () => commentThreads.toJSON(), set: (v) => commentThreads.load(v as Parameters<typeof commentThreads.load>[0]) }),
    ];
    sink.persistence = persistence;
    sink.ui.set({ persistence });
    // Restore before agents start (a remount's teardown has already run, so nothing wipes it afterwards).
    const loaded = persistence.load();
    // only a board with live layers counts as restored (an autosaved empty board must not idle the agents)
    const restored = loaded && [...board.doc.getState().shapes.values()].some((sh) => !sh.deleted);
    const r = startAgents(board, { host: HOST_AGENTS, onSay: (a, text) => sink.say?.(a.id, text), ...agentChatHooks(sink.chat) });
    rtRef.current = r;
    setRt(r);
    // a restored board: agents build in cells that saved work does not touch
    if (restored) r.occupy(board.doc.getState());
    for (let i = 0; i < 3; i++) r.spawn({ at: viewCenter() });
    // a shared link (#/playground?x=&y=&z=&sel=) moves the camera there and selects the ids that exist
    const offUrl = applyViewFromUrl(board, camera);

    const apiCursors = new Map<string, Choreographer>();
    const choreo = (id: string) => r.choreographer(id) ?? apiCursors.get(id) ?? (apiCursors.set(id, createChoreographer({ actor: id, presence: board.presence })), apiCursors.get(id)!);
    const offDev = installDevtools(board, {
      spawnAgent: () => r.spawn({ at: viewCenter() }),
      addCursor: (name = 'Bot', color) => {
        const a = board.actors.spawn({ kind: 'api', name, ...(color ? { color } : {}) });
        const c = viewCenter();
        board.presence.publish({ actor: a.id, x: c.x, y: c.y, down: false, state: 'idle', detail: 'API-controlled' });
        return a.id;
      },
      moveCursor: (id, x, y, ms) => choreo(id).moveTo(x, y, ms !== undefined ? { dur: ms } : {}),
      press: (id, down) => choreo(id).press(down),
    });
    return () => {
      persistence.dispose(); offExtras.forEach((f) => f()); bindSnapSource(null);
      sink.persistence = null; sink.ui.set({ persistence: null });
      offUrl(); offKeys(); offView(); offDev();
      for (const id of r.agentIds()) board.presence.remove(id);
      r.reset();
      rtRef.current = null;
      teardown.current();
    };
  }, [board, sink, rtRef]);

  return rt;
}
