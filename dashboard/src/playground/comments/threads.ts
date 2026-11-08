// Comment pins as threads (COMMENT-2..5). Framework-free: a pin is anchored to a layer (offset kept as
// fractions of the layer box, so it follows moves and resizes) or to a canvas point. A deleted layer
// turns its pins into orphans at their last known world position; undo brings the layer back and the
// pin re-anchors on its own because the anchor still names the layer.
import { absRect } from '../core/tree';
import type { TreeView } from '../core/tree';
import type { Pt } from '../core/types';

export type ThreadState = 'open' | 'answered' | 'resolved';
export type Anchor = { kind: 'layer'; shapeId: string; fx: number; fy: number } | { kind: 'point'; x: number; y: number };
export type ThreadMsg = { id: string; from: string; name: string; color: string; text: string; at: number };
export type CommentThread = {
  id: string; n: number; anchor: Anchor;
  /** Last world position seen while anchored; where an orphan pin stays. */
  last: Pt;
  /** Chat thread (agent id or 'general') this conversation lives in. */
  chat: string;
  color: string;
  state: ThreadState;
  messages: ThreadMsg[];
};
export type ThreadFilter = {
  /** 'open' = not resolved (open + answered); 'resolved'; 'all'. */
  state?: 'all' | 'open' | 'resolved';
  /** Only threads you started (first message from you). */
  mine?: boolean;
  /** Only threads in these chats (agent ids). Empty / undefined = every agent. */
  agents?: readonly string[];
  /** Only threads whose layer is gone. */
  orphaned?: boolean;
};
export type PinPlace = { x: number; y: number; orphan: boolean; hidden: boolean };

let uid = 0;
const mkId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

export function createThreadStore() {
  let threads: CommentThread[] = [];
  let counter = 0;
  let openId: string | null = null;
  let version = 0;
  let hoverId: string | null = null;
  const subs = new Set<() => void>();
  const sends = new Set<(thread: CommentThread, msg: ThreadMsg) => void>();
  const emit = () => { version++; subs.forEach((f) => f()); };
  const patch = (id: string, f: (t: CommentThread) => CommentThread) => {
    if (!threads.some((t) => t.id === id)) return;
    threads = threads.map((t) => (t.id === id ? f(t) : t));
    emit();
  };

  /** World position of a layer anchor, or null if the layer is gone (deleted, or an ancestor deleted). */
  function layerPoint(view: TreeView, a: Extract<Anchor, { kind: 'layer' }>): Pt | null {
    const s = view.shapes.get(a.shapeId);
    if (!s || s.deleted) return null;
    let p = s.parent;
    while (p) { const ps = view.shapes.get(p); if (!ps || ps.deleted) return null; p = ps.parent; }
    const r = absRect(view, a.shapeId);
    return r ? { x: r.x + a.fx * r.w, y: r.y + a.fy * r.h } : null;
  }
  function hiddenLayer(view: TreeView, id: string): boolean {
    for (let s = view.shapes.get(id); s; s = s.parent ? view.shapes.get(s.parent) : undefined) if (s.hidden) return true;
    return false;
  }

  function reanchor(view: TreeView, id: string, shapeId: string, at?: Pt): boolean {
      const t = threads.find((x) => x.id === id);
      const r = absRect(view, shapeId);
      if (!t || !r) return false;
      const w = at ?? (t.anchor.kind === 'point' ? { x: t.anchor.x, y: t.anchor.y } : layerPoint(view, t.anchor) ?? t.last);
      patch(id, (c) => ({ ...c, last: w, anchor: { kind: 'layer', shapeId, fx: r.w ? (w.x - r.x) / r.w : 0, fy: r.h ? (w.y - r.y) / r.h : 0 } }));
      return true;
    }

  return {
    get version() { return version; },
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
    list: () => threads,
    get: (id: string) => threads.find((t) => t.id === id),
    get openId() { return openId; },
    /** Thread whose pin / list row the pointer is over (drives the preview card and highlight). */
    get hoverId() { return hoverId; },
    hover(id: string | null) { if (hoverId !== id) { hoverId = id; emit(); } },
    /** Threads matching every given filter (AND), in creation order. `view` is needed only for `orphaned`. */
    filter(f: ThreadFilter, view?: TreeView): CommentThread[] {
      return threads.filter((t) => {
        if (f.state === 'open' && t.state === 'resolved') return false;
        if (f.state === 'resolved' && t.state !== 'resolved') return false;
        if (f.mine && t.messages[0]?.from !== 'you') return false;
        if (f.agents?.length && !f.agents.includes(t.chat)) return false;
        if (f.orphaned && (!view || t.anchor.kind !== 'layer' || layerPoint(view, t.anchor))) return false;
        return true;
      });
    },
    open(id: string | null) { if (openId !== id) { openId = id; emit(); } },

    /** New pin on a layer; `at` is the clicked world point. Returns the thread. */
    addOnLayer(view: TreeView, shapeId: string, at: Pt, o: { chat: string; color: string; id?: string }): CommentThread | null {
      const r = absRect(view, shapeId);
      if (!r) return null;
      const t: CommentThread = {
        id: o.id ?? mkId('c'), n: ++counter, chat: o.chat, color: o.color, state: 'open', messages: [], last: at,
        anchor: { kind: 'layer', shapeId, fx: r.w ? (at.x - r.x) / r.w : 0, fy: r.h ? (at.y - r.y) / r.h : 0 },
      };
      threads = [...threads, t]; emit();
      return t;
    },
    /** New free pin at a world point (stays put under pan and zoom). */
    addAtPoint(at: Pt, o: { chat: string; color: string; id?: string }): CommentThread {
      const t: CommentThread = { id: o.id ?? mkId('c'), n: ++counter, chat: o.chat, color: o.color, state: 'open', messages: [], last: at, anchor: { kind: 'point', x: at.x, y: at.y } };
      threads = [...threads, t]; emit();
      return t;
    },
    /** Add a message. A reply on a resolved thread reopens it. */
    reply(id: string, m: Omit<ThreadMsg, 'id' | 'at'> & { id?: string; at?: number }) {
      const msg = { ...m, id: m.id ?? mkId('m'), at: m.at ?? Date.now() };
      patch(id, (t) => ({ ...t, state: t.state === 'resolved' ? 'open' : t.state, messages: [...t.messages, msg] }));
      const t = threads.find((x) => x.id === id);
      if (t && m.from === 'you') sends.forEach((f) => f(t, msg));
    },
    /** Called after a human message is added (the shell forwards it to the thread's chat / agent). */
    onHumanMessage(fn: (thread: CommentThread, msg: ThreadMsg) => void) { sends.add(fn); return () => { sends.delete(fn); }; },
    /** The agent finished its task: the human confirms by resolving. */
    markAnswered(id: string) { patch(id, (t) => (t.state === 'open' ? { ...t, state: 'answered' } : t)); },
    resolve(id: string) { patch(id, (t) => ({ ...t, state: 'resolved' })); },
    reopen(id: string) { patch(id, (t) => ({ ...t, state: 'open' })); },
    remove(id: string) { threads = threads.filter((t) => t.id !== id); if (openId === id) openId = null; if (hoverId === id) hoverId = null; emit(); },
    /** Drop pins nobody wrote on (a popover opened and closed without sending). */
    discardEmpty() {
      const keep = threads.filter((t) => t.messages.length > 0);
      if (keep.length !== threads.length) { threads = keep; emit(); }
    },
    resolveOrphans(view: TreeView) {
      let any = false;
      threads = threads.map((t) => {
        if (t.state === 'resolved' || t.anchor.kind !== 'layer' || layerPoint(view, t.anchor)) return t;
        any = true; return { ...t, state: 'resolved' as const };
      });
      if (any) emit();
    },

    /**
     * Where a pin is drawn. Uses absRect, so layers nested in moved frames anchor correctly. Remembers
     * the last live position (no notify: safe to call every frame) for when the layer is deleted.
     */
    place(view: TreeView, id: string): PinPlace | null {
      const t = threads.find((x) => x.id === id);
      if (!t) return null;
      if (t.anchor.kind === 'point') return { x: t.anchor.x, y: t.anchor.y, orphan: false, hidden: false };
      const p = layerPoint(view, t.anchor);
      if (!p) return { ...t.last, orphan: true, hidden: false };
      t.last = p;
      return { ...p, orphan: false, hidden: hiddenLayer(view, t.anchor.shapeId) };
    },
    /**
     * Re-anchor a pin (free, orphaned or live) onto a layer, keeping its world position, or the dropped
     * point `at` when given. Returns false if the layer is missing.
     */
    reanchor,
    /** Re-anchor a free pin onto a layer (drag a point pin onto a frame), keeping its world position. */
    anchorTo(view: TreeView, id: string, shapeId: string) {
      const t = threads.find((x) => x.id === id);
      if (t?.anchor.kind === 'point') reanchor(view, id, shapeId);
    },
    /** Turn any pin into a free pin at a world point (orphan dropped on empty canvas). */
    pinAt(id: string, at: Pt) {
      patch(id, (t) => ({ ...t, last: at, anchor: { kind: 'point', x: at.x, y: at.y } }));
    },
    /** Move a free pin. */
    movePoint(id: string, at: Pt) {
      patch(id, (t) => (t.anchor.kind === 'point' ? { ...t, last: at, anchor: { kind: 'point', x: at.x, y: at.y } } : t));
    },

    toJSON() { return { v: 1, counter, threads: threads.map((t) => ({ ...t, last: { ...t.last } })) }; },
    load(raw: unknown) {
      const r = raw as { counter?: number; threads?: CommentThread[] } | null;
      if (!r || !Array.isArray(r.threads)) return;
      threads = r.threads.filter((t) => t && typeof t.id === 'string' && t.anchor);
      counter = Math.max(typeof r.counter === 'number' ? r.counter : 0, ...threads.map((t) => t.n));
      openId = null;
      emit();
    },
  };
}
export type ThreadStore = ReturnType<typeof createThreadStore>;

/** Page-wide store. The orchestrator registers it with persistence: registerExtra('comments', { get: () => commentThreads.toJSON(), set: (v) => commentThreads.load(v) }). */
export const commentThreads: ThreadStore = createThreadStore();
