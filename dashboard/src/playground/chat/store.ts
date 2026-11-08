// Chat store (COMMENT-1, COMMENT-11): threads, typed messages and unread counts. Pure TS, no React.
// The React hook (ui/chat/useChat.ts) subscribes through `subscribe` / `version`.
import type { ActorId, BoardEvent, Command, Message, MsgBody, Result, ShapeId } from '../core/types';
import type { EventBus } from '../core/events';
import { newId } from '../core/ids';

/** The human's messages use this sender id (the page's composer). Everything else is an actor id. */
export const YOU = 'you';
export const GENERAL = 'general';

/** A stored message: the protocol `Message` plus what the panel needs to draw it without a registry. */
export type ChatMsg = Message & {
  name: string;
  color: string;
  /** Plain text of the body (text, status, system, error) or the summary (action). Kept for pins and search. */
  text: string;
  /** "Frame › Layer" label for the layer this line is about. */
  ctx?: string;
  /** Comment pin this message created. */
  pin?: string;
};

export type NewMsg = {
  thread: string; from: ActorId; name: string; color: string; body: MsgBody;
  shapeId?: ShapeId; ctx?: string; pin?: string; id?: string; at?: number;
};

export function bodyText(b: MsgBody): string {
  switch (b.kind) {
    case 'text': case 'status': case 'system': case 'error': return b.text;
    case 'action': return b.summary;
    case 'routing': return `routed to ${b.to} · ${b.why}`;
    case 'conflict': return 'Conflict';
    default: return '';
  }
}

/** Kinds that count as "new" for a thread's unread badge: status chatter, routing and system lines do not. */
const LOUD = new Set<string>(['text', 'action', 'conflict', 'error']);
const counts = (m: ChatMsg) => m.from !== YOU && LOUD.has(m.body.kind);

export interface ChatStoreJSON { v: 1; messages: ChatMsg[]; seen: Record<string, number> }

export interface ChatStore {
  /** Immutable snapshot: a new array on every change, so React can compare by identity. */
  messages(): ChatMsg[];
  /** Messages of one thread, in arrival order. */
  thread(id: string): ChatMsg[];
  post(m: NewMsg): ChatMsg;
  /** Patch a stored message (for example an action card marked undone). */
  update(id: string, patch: Partial<Pick<ChatMsg, 'body' | 'text' | 'ctx'>>): void;
  /** Unread count per thread (only threads with unread appear). */
  unread(): Record<string, number>;
  /** Mark a thread read; while a thread is `active`, its new messages are read on arrival. */
  markRead(thread: string): void;
  setActive(thread: string | null): void;
  subscribe(cb: () => void): () => void;
  /** Forget everything (page teardown). */
  reset(): void;
  toJSON(): ChatStoreJSON;
  /** Replace the contents from `toJSON()` output. Unknown or malformed input is ignored. */
  load(json: unknown): void;
}

export function createChatStore(): ChatStore {
  let msgs: ChatMsg[] = [];
  let seen: Record<string, number> = {};
  let active: string | null = null;
  let unreadCache: Record<string, number> | null = {};
  const subs = new Set<() => void>();
  const notify = () => { unreadCache = null; for (const f of [...subs]) f(); };

  const total = (thread: string) => { let n = 0; for (const m of msgs) if (m.thread === thread && counts(m)) n++; return n; };
  const readActive = () => { if (active !== null) seen = { ...seen, [active]: total(active) }; };

  return {
    messages: () => msgs,
    thread: (id) => msgs.filter((m) => m.thread === id),
    post(m) {
      const msg: ChatMsg = {
        id: m.id ?? newId('m'), thread: m.thread, from: m.from, at: m.at ?? Date.now(), body: m.body,
        name: m.name, color: m.color, text: bodyText(m.body),
        ...(m.shapeId ? { shapeId: m.shapeId } : {}), ...(m.ctx ? { ctx: m.ctx } : {}), ...(m.pin ? { pin: m.pin } : {}),
      };
      msgs = [...msgs, msg];
      readActive();
      notify();
      return msg;
    },
    update(id, patch) {
      if (!msgs.some((m) => m.id === id)) return;
      msgs = msgs.map((m) => (m.id === id ? { ...m, ...patch } : m));
      notify();
    },
    unread() {
      if (!unreadCache) {
        const out: Record<string, number> = {};
        for (const t of new Set(msgs.map((m) => m.thread))) {
          const n = total(t) - (seen[t] ?? 0);
          if (n > 0) out[t] = n;
        }
        unreadCache = out;
      }
      return unreadCache;
    },
    markRead(thread) {
      if ((seen[thread] ?? 0) === total(thread)) return;
      seen = { ...seen, [thread]: total(thread) };
      notify();
    },
    setActive(thread) {
      if (active === thread) return;
      active = thread;
      const before = seen;
      readActive();
      if (seen !== before) notify();
    },
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    reset() { msgs = []; seen = {}; notify(); },
    toJSON() { return { v: 1, messages: msgs.map((m) => ({ ...m })), seen: { ...seen } }; },
    load(json) {
      const j = json as Partial<ChatStoreJSON> | null | undefined;
      if (!j || j.v !== 1 || !Array.isArray(j.messages)) return;
      msgs = j.messages.filter((m) => m && typeof m.id === 'string' && typeof m.thread === 'string' && m.body && typeof m.body.kind === 'string');
      seen = j.seen && typeof j.seen === 'object' ? { ...j.seen } : {};
      readActive();
      notify();
    },
  };
}

/**
 * Board `extra` handler for `chat.say`: appends the message to the store, then emits `message.created`
 * (with `to`) on the board's event bus. Other command kinds are left to other handlers (returns undefined).
 */
export function chatSayHandler(
  store: ChatStore,
  events: Pick<EventBus, 'emit'>,
  who: (actor: ActorId) => { name: string; color: string } | undefined,
) {
  return (actor: ActorId, cmd: Command): Result | undefined => {
    if (cmd.t !== 'chat.say') return undefined;
    const a = who(actor);
    const msg = store.post({ thread: cmd.thread, from: actor, name: a?.name ?? actor, color: a?.color ?? '#999', body: cmd.body });
    const e: Omit<Extract<BoardEvent, { t: 'message.created' }>, 'seq' | 'at'> = {
      t: 'message.created', actor, messageId: msg.id, thread: msg.thread, ...(cmd.to ? { to: cmd.to } : {}),
    };
    events.emit(e);
    return { ok: true };
  };
}
