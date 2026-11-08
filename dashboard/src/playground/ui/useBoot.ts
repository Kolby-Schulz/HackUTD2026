// Page boot: key dispatcher, view shortcuts, the agent runtime with three agents, window.board.
// The ONE startAgents call lives here, with the host flag.
import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { agentChatHooks } from './chat/agentChat';
import { createChoreographer } from '../agents/choreographer';
import type { Choreographer } from '../agents/choreographer';
import { startAgents } from '../agents/runtime';
import type { AgentRuntime } from '../agents/runtime';
import { startCoordinator } from '../agents/coordinator';
import { writeMeasuredSize } from './text/autosize';
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
import { DEMO, HOST_AGENTS, LIVE, viewCenter } from './kit';
import { connectBoard } from '../net/session';
import { connectSpacetime } from '../net/spacetime';
import { electHost, RENEW_MS } from '../net/host';
import type { BoardTransport } from '../net/types';
import { SPACETIME_DB_NAME, SPACETIME_HOST } from '../../data';
import type { ChatSink } from './kit';

/** Boots the page; `rtRef` mirrors the returned runtime for callbacks that must not re-render on it. */
export function useBoot(board: BoardKit, sink: ChatSink, rtRef: MutableRefObject<AgentRuntime | null>, onTeardown: () => void): AgentRuntime | null {
  const [rt, setRt] = useState<AgentRuntime | null>(null);
  const teardown = useRef(onTeardown);
  teardown.current = onTeardown;
  // Live board: one connection for the page, and the host election that decides whether this tab runs the agents.
  const [net, setNet] = useState<(BoardTransport & { close(): void }) | null>(null);
  const [hosting, setHosting] = useState(false);
  useEffect(() => {
    if (!LIVE) return;
    const t = connectSpacetime({ uri: SPACETIME_HOST, database: SPACETIME_DB_NAME, boardId: 'playground', boardName: 'Design board' });
    setNet(t);
    const election = electHost(t, board.me, (h) => {
      setHosting(h);
      if (h) toast('Agents are running in this tab', { key: 'net.host', ttlMs: 6000 });
    });
    return () => { election.dispose(); t.close(); setNet(null); setHosting(false); };
  }, [board]);

  useEffect(() => {
    if (LIVE && !net) return;
    const hostAgents = HOST_AGENTS || hosting;
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
    // The live board's state lives in SpacetimeDB, so it neither loads nor autosaves a local copy.
    const persistence = createPersistence(board.doc, { boardId: 'playground', demo: DEMO || LIVE, toast: (t, o) => toast(t, o) });
    const me = board.actors.get(board.me);
    const session = net ? connectBoard({
      boardId: 'playground', doc: board.doc, presence: board.presence, transport: net,
      actors: [{ id: board.me, kind: 'human', name: me?.name ?? 'You', color: me?.color ?? '#3366ff' }],
      onRemoteActor: (r) => {
        if (board.actors.get(r.actor)) return;
        const kind = r.kind === 'agent' ? 'agent' : r.kind === 'system' ? 'system' : 'human';
        board.actors.spawn({ id: r.actor, kind, name: r.name, color: r.color });
      },
      onError: (e) => toast(e.kind === 'op-too-large' ? 'That change is too large to sync' : e.kind === 'push-refused' ? 'The server refused a change' : `Sync problem: ${e.kind}`, { key: `net.${e.kind}` }),
    }) : null;
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
    const r = startAgents(board, { host: hostAgents, onSay: (a, text) => sink.say?.(a.id, text), ...agentChatHooks(sink.chat) });
    rtRef.current = r;
    setRt(r);
    // Claim contention rulings (WP-68). Started here, stopped in cleanup (StrictMode runs this effect twice).
    const offCoord = startCoordinator({
      board, chat: sink.chat,
      pickSlot: r.pickSlot, freeSlot: r.freeSlot,
      onRedirect: (agent) => r.redirect(agent),
    });
    // The agent host (this peer) writes the measured size of agent text after it is created or changed (WP-60).
    // Viewers never do; writeMeasuredSize itself only accepts agent-made text. Its own write comes from system-measure, so it cannot loop.
    const offMeasure = hostAgents ? board.subscribe({ kinds: ['shape.created', 'shape.updated'] }, (e) => {
      if (!e.actor.startsWith('agent-') || !('ids' in e)) return;
      for (const id of e.ids) writeMeasuredSize(board, id, { role: 'host' }, true);
    }) : () => {};
    // a restored board: agents build in cells that saved work does not touch
    if (restored) r.occupy(board.doc.getState());
    if (hostAgents) for (let i = 0; i < 3; i++) r.spawn({ at: viewCenter() });
    // On the live board the host tab's agents are SpacetimeDB actors: each one registers as an `agent` row and
    // joins the board, and its edits, cursor and presence go through the same session as a person's.
    const joinAgents = () => {
      if (!session) return;
      for (const id of r.agentIds()) {
        const a = board.actors.get(id);
        if (a) session.join({ id, kind: 'agent', name: a.name, color: a.color, agentId: id });
      }
    };
    joinAgents();
    const offAgents = session ? board.actors.subscribe(joinAgents) : () => {};
    const beat = net && hostAgents ? setInterval(() => { for (const id of r.agentIds()) net.heartbeat(id).catch(() => {}); }, RENEW_MS) : null;
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
      offAgents(); if (beat) clearInterval(beat);
      session?.dispose();
      persistence.dispose(); offExtras.forEach((f) => f()); bindSnapSource(null);
      sink.persistence = null; sink.ui.set({ persistence: null });
      offCoord(); offMeasure(); offUrl(); offKeys(); offView(); offDev();
      for (const id of r.agentIds()) board.presence.remove(id);
      r.reset();
      rtRef.current = null;
      teardown.current();
    };
  }, [board, sink, rtRef, net, hosting]);

  return rt;
}
