// Chat and comment state for the page: messages, the open thread, comment pins, and `send`, which
// routes a note to an agent. The page owns it so it survives panel switches and collapses.
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MutableRefObject } from 'react';
import type { AgentRuntime } from '../../agents/runtime';
import type { BoardKit } from '../../core/commands';
import { newId, opId } from '../../core/ids';
import { absRect } from '../../core/tree';
import type { ActorId, ShapeId } from '../../core/types';
import { CLAUDE, YOU_COLOR } from '../constants';
import type { ChatSink } from '../kit';
import { statusOf } from '../meta';
import type { Meta } from '../meta';
import { ctxLabel, routeFor } from '../comments/route';
import type { Pin } from '../comments/route';
import { createChatStore, YOU } from '../../chat/store';
import type { ChatMsg, NewMsg } from '../../chat/store';
import type { Thread } from './ChatPanel';

/** Actor that reassigns an unowned layer to the agent a note was routed to (kept off the human's undo stack). */
const ROUTER: ActorId = 'system-router';

export type SendOpts = { thread?: string; shapeId?: string; at?: { x: number; y: number } };

export function useChat(board: BoardKit, sink: ChatSink, rtRef: MutableRefObject<AgentRuntime | null>, cursors: Meta[], onOpenChat: () => void) {
  const me = board.me;
  /** The framework-free store; `store.toJSON()` / `store.load()` let persistence save and restore it. */
  const [store] = useState(() => sink.chat ?? createChatStore());
  const messages = useSyncExternalStore(store.subscribe, store.messages);
  const unread = useSyncExternalStore(store.subscribe, store.unread);
  const [thread, setThread] = useState('general');
  const [pins, setPins] = useState<Pin[]>([]);
  const [showPins, setShowPins] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [focusMsg, setFocusMsg] = useState<string | null>(null);
  const pinCount = useRef(0);
  /** Notes waiting on each agent, oldest first: its replies are tagged with the head note's layer. */
  const pending = useRef(new Map<ActorId, Array<{ ctx?: string; shapeId?: string }>>());

  const post = useCallback((m: NewMsg) => store.post(m), [store]);
  const postText = useCallback((m: Omit<NewMsg, 'body'> & { text: string }) => { const { text, ...rest } = m; return store.post({ ...rest, body: { kind: 'text', text } }); }, [store]);
  const resolvePin = useCallback((id: string) => setPins((ps) => ps.map((p) => (p.id === id ? { ...p, done: true } : p))), []);
  const clearResolved = useCallback(() => setPins((ps) => ps.filter((p) => !p.done)), []);
  /** Page teardown: forget every message, pin and queued note. */
  const reset = useCallback(() => { pending.current.clear(); store.reset(); setPins([]); pinCount.current = 0; }, [store]);

  // agent chat lines land in the agent's own thread
  sink.say = (actor, text) => {
    const a = board.actors.get(actor);
    const head = pending.current.get(actor)?.[0];
    const tag = head && !/^(Starting a |Finished the )/.test(text) ? head : undefined;
    const who = { thread: actor, from: actor, name: a?.name ?? actor, color: a?.color ?? '#999' };
    if (/^(Starting a |Finished the )/.test(text)) post({ ...who, body: { kind: 'status', text } });
    else postText({ ...who, text, ...(tag?.ctx ? { ctx: tag.ctx } : {}), ...(tag?.shapeId ? { shapeId: tag.shapeId } : {}) });
  };

  const openThread = useCallback((t: string, msgId?: string) => {
    setThread(t);
    onOpenChat();
    setFlash(t);
    setTimeout(() => setFlash((f) => (f === t ? null : f)), 1400);
    if (msgId) setFocusMsg(msgId);
  }, [onOpenChat]);

  const send = useCallback((text: string, opts: SendOpts = {}) => {
    const r = rtRef.current;
    const st = board.doc.getState();
    const found = opts.shapeId ? st.shapes.get(opts.shapeId) : undefined;
    const shape = found && !found.deleted ? found : undefined;
    let target = opts.thread ?? 'general';
    if (shape) {
      const route = routeFor(board, r, shape.id);
      target = route.thread;
      // claim unowned layers for the agent we routed to, so follow-ups land in the same chat
      if (route.how === 'nearest') board.exec({ actor: ROUTER, opId: opId(ROUTER), commands: [{ t: 'shape.update', ids: [shape.id], patch: { author: route.thread } }] });
    } else if (target === 'general') {
      const live = r?.agentIds() ?? [];
      if (live.length) {
        const pick = live[Math.floor(Math.random() * live.length)];
        postText({ thread: 'general', from: YOU, name: 'You', color: YOU_COLOR, text });
        post({ thread: 'general', from: 'claude', ...CLAUDE, body: { kind: 'routing', to: pick, why: 'manual' } });
        target = pick;
      }
    }
    const ctx = shape ? ctxLabel(board, shape.id) : undefined;
    let pinId: string | undefined;
    if (shape) {
      const box = absRect(st, shape.id)!;
      const at = opts.at ?? { x: box.x + box.w - 4, y: box.y + 4 };
      pinId = newId('p');
      const pin: Pin = { id: pinId, n: ++pinCount.current, shapeId: shape.id, dx: at.x - box.x, dy: at.y - box.y, thread: target, done: false };
      setPins((ps) => [...ps, pin]);
    }
    postText({ thread: target, from: YOU, name: 'You', color: YOU_COLOR, text, ...(ctx ? { ctx } : {}), ...(pinId ? { pin: pinId } : {}), ...(shape ? { shapeId: shape.id } : {}) });
    if (target === 'general' || !r) {
      postText({ thread: 'general', from: 'claude', ...CLAUDE, text: 'No agents on the board yet. Add one with + Agent and I will route notes to it.' });
      if (pinId) resolvePin(pinId);
    } else {
      const q = pending.current.get(target) ?? [];
      q.push({ ctx, shapeId: shape?.id });
      pending.current.set(target, q);
      const pid = pinId;
      r.request(target, { text, shapeId: shape?.id, from: me }).finally(() => {
        pending.current.get(target)?.shift();
        if (pid) resolvePin(pid);
      });
    }
    openThread(target);
  }, [board, me, rtRef, post, postText, resolvePin, openThread]);

  const threads: Thread[] = useMemo(() => {
    const list: Thread[] = [{ id: 'general', name: 'General', color: CLAUDE.color, status: 'everyone', live: true }];
    for (const c of cursors) if (c.kind === 'agent') list.push({ id: c.id, name: c.name, color: c.color, status: statusOf(c), live: true });
    const known = new Set(list.map((t) => t.id));
    for (const m of messages) {
      if (known.has(m.thread)) continue;
      const a = messages.find((x: ChatMsg) => x.thread === m.thread && x.from === m.thread);
      list.push({ id: m.thread, name: a?.name ?? m.thread, color: a?.color ?? '#999', status: 'left the board', live: false });
      known.add(m.thread);
    }
    return list;
  }, [cursors, messages]);
  const threadOf = useCallback((id: string) => threads.find((t) => t.id === id), [threads]);
  const describeTarget = (id: ShapeId) => {
    const t = threadOf(routeFor(board, rtRef.current, id).thread);
    return { label: `${board.doc.getState().shapes.get(id)?.name ?? ''} → ${t?.name ?? 'General'}`, color: t?.color ?? CLAUDE.color };
  };

  return {
    store, messages, unread, thread, setThread, pins, showPins, setShowPins, flash, focusMsg, clearFocus: () => setFocusMsg(null),
    threads, threadOf, describeTarget, send, openThread, clearResolved, reset,
  };
}
export type Chat = ReturnType<typeof useChat>;
