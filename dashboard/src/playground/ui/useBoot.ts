// Page boot: key dispatcher, view shortcuts, the agent runtime with three agents, window.board.
// The ONE startAgents call lives here, with the host flag.
import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { createChoreographer } from '../agents/choreographer';
import type { Choreographer } from '../agents/choreographer';
import { startAgents } from '../agents/runtime';
import type { AgentRuntime } from '../agents/runtime';
import type { BoardKit } from '../core/commands';
import { installDevtools } from '../core/devtools';
import { install as installKeys } from '../core/keys';
import { registerViewFallbacks } from './board/viewActions';
import { HOST_AGENTS, viewCenter } from './kit';
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
    // restore the saved board and chat before agents start (here, not in createKit, so a StrictMode remount's
    // teardown cannot wipe what was just restored)
    const loaded = sink.persistence?.load() ?? false;
    // only a board with live layers counts as restored (an autosaved empty board must not idle the agents)
    const restored = loaded && [...board.doc.getState().shapes.values()].some((sh) => !sh.deleted);
    const r = startAgents(board, { host: HOST_AGENTS, onSay: (a, text) => sink.say?.(a.id, text) });
    rtRef.current = r;
    setRt(r);
    for (let i = 0; i < 3; i++) r.spawn({ at: viewCenter() });
    // the runtime cannot yet tell which slots a restored board occupies: start idle instead of building over it
    if (restored) r.setAllPaused(true);

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
      offKeys(); offView(); offDev();
      for (const id of r.agentIds()) board.presence.remove(id);
      r.reset();
      rtRef.current = null;
      teardown.current();
    };
  }, [board, sink, rtRef]);

  return rt;
}
