// Chat and comment state for the page: messages, the open thread, comment pins, and `send`, which
// routes a note to an agent. The page owns it so it survives panel switches and collapses.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MutableRefObject } from 'react';
import type { AgentRuntime } from '../../agents/runtime';
import type { BoardKit } from '../../core/commands';
import { opId } from '../../core/ids';
import { absRect } from '../../core/tree';
import { GENERAL, parseMentions, routingCard } from '../../agents/router';
import { commentThreads } from '../../comments/threads';
import type { CommentThread, ThreadMsg } from '../../comments/threads';
import type { ActorId, ShapeId } from '../../core/types';
import { CLAUDE, YOU_COLOR } from '../constants';
import type { ChatSink } from '../kit';
import { statusOf } from '../meta';
import type { Meta } from '../meta';
import { ctxLabel, routeFor, routerInput } from '../comments/route';
import type { Pin } from '../comments/route';
import { createChatStore, YOU } from '../../chat/store';
import type { ChatMsg, NewMsg } from '../../chat/store';
import type { Thread } from './ChatPanel';
import { planMessage } from './plan';
import type { SendPlan } from './plan';

/** Actor that reassigns an unowned layer to the agent a note was routed to (kept off the human's undo stack). */
const ROUTER: ActorId = 'system-router';

const NO_PINS: Pin[] = [];
export type SendOpts = { thread?: string; shapeId?: string; at?: { x: number; y: number } };

export function useChat(board: BoardKit, sink: ChatSink, rtRef: MutableRefObject<AgentRuntime | null>, cursors: Meta[], onOpenChat: () => void) {
  const me = board.me;
  /** The framework-free store; `store.toJSON()` / `store.load()` let persistence save and restore it. */
  const [store] = useState(() => sink.chat ?? createChatStore());
  const messages = useSyncExternalStore(store.subscribe, store.messages);
  const unread = useSyncExternalStore(store.subscribe, store.unread);
  const [thread, setThread] = useState('general');
  /** Legacy per-send pins. Layer comments are `commentThreads` now; the page still passes this (empty) list to <Pins>. */
  const pins: Pin[] = NO_PINS;
  const [showPins, setShowPins] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [focusMsg, setFocusMsg] = useState<string | null>(null);
  /** Notes waiting on each agent, oldest first: its replies are tagged with the head note's layer. */
  const pending = useRef(new Map<ActorId, Array<{ ctx?: string; shapeId?: string }>>());

  const post = useCallback((m: NewMsg) => store.post(m), [store]);
  const postText = useCallback((m: Omit<NewMsg, 'body'> & { text: string }) => { const { text, ...rest } = m; return store.post({ ...rest, body: { kind: 'text', text } }); }, [store]);
  const clearResolved = useCallback(() => { for (const t of commentThreads.list()) if (t.state === 'resolved') commentThreads.remove(t.id); }, []);
  /** Page teardown: forget every message, pin and queued note. */
  const reset = useCallback(() => { pending.current.clear(); store.reset(); commentThreads.load({ v: 1, counter: 0, threads: [] }); }, [store]);

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

  const nameOf = useCallback((id: ActorId) => board.actors.get(id)?.name ?? id, [board]);
  const note = useCallback((thread: string, text: string, kind: 'error' | 'system' = 'error') =>
    post({ thread, from: 'claude', ...CLAUDE, body: { kind, text } }), [post]);

  /** One user message into an agent's chat, then the agent's request. Resolves true when an agent ran it. */
  const deliverChat = useCallback(async (target: ActorId, text: string, o: { shapeId?: string; ctx?: string; pin?: string } = {}) => {
    const r = rtRef.current;
    postText({ thread: target, from: YOU, name: 'You', color: YOU_COLOR, text, ...(o.ctx ? { ctx: o.ctx } : {}), ...(o.pin ? { pin: o.pin } : {}), ...(o.shapeId ? { shapeId: o.shapeId } : {}) });
    if (!r || !r.has(target)) {
      postText({ thread: 'general', from: 'claude', ...CLAUDE, text: 'No agents on the board yet. Add one with + Agent and I will route notes to it.' });
      return false;
    }
    const q = pending.current.get(target) ?? [];
    q.push({ ctx: o.ctx, shapeId: o.shapeId });
    pending.current.set(target, q);
    try { await r.request(target, { text, shapeId: o.shapeId, from: me }); } finally { pending.current.get(target)?.shift(); }
    return true;
  }, [rtRef, postText, me]);

  /** A human message on a comment thread (first note or a reply) goes to the thread's chat; the agent finishing marks it answered. */
  const forward = useCallback((t: CommentThread, msg: ThreadMsg) => {
    const shapeId = t.anchor.kind === 'layer' ? t.anchor.shapeId : undefined;
    const live = shapeId ? board.doc.getState().shapes.get(shapeId) : undefined;
    const sid = live && !live.deleted ? live.id : undefined;
    if (t.state === 'answered') commentThreads.reopen(t.id);
    void deliverChat(t.chat, msg.text, { shapeId: sid, ctx: sid ? ctxLabel(board, sid) : undefined, pin: t.id })
      .then((ran) => { if (ran) commentThreads.markAnswered(t.id); });
  }, [board, deliverChat]);
  const forwardRef = useRef(forward);
  forwardRef.current = forward;
  useEffect(() => commentThreads.onHumanMessage((t, m) => forwardRef.current(t, m)), []);

  const send = useCallback((text: string, opts: SendOpts = {}) => {
    // Live board: the agents run in the agent process; the message goes to them through SpacetimeDB.
    if (sink.remote) {
      postText({ thread: 'general', from: YOU, name: 'You', color: YOU_COLOR, text });
      sink.remote(text, opts.thread ?? 'general');
      openThread('general');
      return;
    }
    const r = rtRef.current;
    const st = board.doc.getState();
    const found = opts.shapeId ? st.shapes.get(opts.shapeId) : undefined;
    const shape = found && !found.deleted ? found : undefined;
    const home = opts.thread ?? 'general';
    const mentions = parseMentions(text, routerInput(board, r).agents);

    // stopped agents that were mentioned: offer to start them, then plan again with the live set
    let plan: SendPlan = planMessage(text, routerInput(board, r, shape?.id));
    if (plan.stopped.length && r) {
      for (const a of plan.stopped) if (window.confirm(`${a.name} is stopped. Start it?`)) r.restart(a.id);
      plan = planMessage(text, routerInput(board, r, shape?.id));
    }
    if (plan.errors.length) { for (const e of plan.errors) note(home, e); openThread(home); return; }
    if (plan.confirmAll && !window.confirm(`Send this to all ${routerInput(board, r).agents.filter((a) => !a.stopped).length} agents?`)) return;

    // inside an agent's own chat, a message without @mentions stays with that agent
    const direct = !shape && home !== 'general' && !mentions.agents.length && !mentions.all;
    const deliveries = direct ? [{ decision: { to: home, why: 'author' as const, label: 'this chat' }, text }] : plan.deliveries;
    const first = deliveries[0]?.decision.to ?? GENERAL;

    if (shape) {
      const d = deliveries[0]?.decision;
      if (!d || d.to === GENERAL) {
        postText({ thread: 'general', from: YOU, name: 'You', color: YOU_COLOR, text, ctx: ctxLabel(board, shape.id), shapeId: shape.id });
        postText({ thread: 'general', from: 'claude', ...CLAUDE, text: 'No agents on the board yet. Add one with + Agent and I will route notes to it.' });
        openThread('general');
        return;
      }
      // claim unowned layers for the agent we routed to, so follow-ups land in the same chat
      if (d.why === 'nearest') board.exec({ actor: ROUTER, opId: opId(ROUTER), commands: [{ t: 'shape.update', ids: [shape.id], patch: { author: d.to } }] });
      const box = absRect(st, shape.id)!;
      const at = opts.at ?? { x: box.x + box.w - 4, y: box.y + 4 };
      const th = commentThreads.addOnLayer(st, shape.id, at, { chat: d.to, color: board.actors.get(d.to)?.color ?? CLAUDE.color });
      if (th) commentThreads.reply(th.id, { from: 'you', name: 'You', color: YOU_COLOR, text });   // -> forward()
      else void deliverChat(d.to, text, { shapeId: shape.id, ctx: ctxLabel(board, shape.id) });
      for (const x of deliveries.slice(1)) void deliverChat(x.decision.to, x.text, { shapeId: shape.id, ctx: ctxLabel(board, shape.id) });
      openThread(d.to);
      return;
    }

    if (home === 'general') postText({ thread: 'general', from: YOU, name: 'You', color: YOU_COLOR, text });
    if (!deliveries.length || first === GENERAL) {
      if (home !== 'general') postText({ thread: home, from: YOU, name: 'You', color: YOU_COLOR, text });
      postText({ thread: 'general', from: 'claude', ...CLAUDE, text: 'No agents on the board yet. Add one with + Agent and I will route notes to it.' });
      openThread('general');
      return;
    }
    for (const x of deliveries) {
      if (home === 'general' || x.decision.why === 'mention') {
        const card = routingCard(x.decision, nameOf);
        post({ thread: 'general', from: 'claude', ...CLAUDE, body: card.body, text: card.text, routedBy: { to: x.decision.to, why: x.decision.why }, ...(home !== 'general' ? { from_thread: home } : {}) });
      }
      void deliverChat(x.decision.to, x.text);
    }
    openThread(first);
  }, [board, sink, rtRef, post, postText, note, nameOf, deliverChat, openThread]);

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
