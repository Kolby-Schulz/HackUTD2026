// Playground (#/playground): a Figma / Claude-Design style board where you and several scripted
// agent cursors design at once. Each agent has a chat; the comment tool routes a note on a layer to
// the agent that made it. Not wired to SpacetimeDB.
//
// This file is the shell and composition root: it creates the board, the UI store and the agent
// runtime, and draws the panels. The board itself (rendering, pointer gestures, camera) lives in
// ui/board and ui/gestures; every document change goes through board.exec / board.gesture.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { makeActorId } from './core/actors';
import { camera } from './core/camera';
import { createBoard } from './core/commands';
import type { BoardKit } from './core/commands';
import { installDevtools } from './core/devtools';
import { newId, opId } from './core/ids';
import { install as installKeys } from './core/keys';
import { useDoc, useShape, useStoreValue } from './core/react';
import { absRect, ancestors, flatten } from './core/tree';
import type { Actor, ActorId, ActorKind, AgentState, ShapeId } from './core/types';
import { startAgents } from './agents/runtime';
import type { AgentRuntime } from './agents/runtime';
import { createChoreographer } from './agents/choreographer';
import type { Choreographer } from './agents/choreographer';
import './actions/index';
import { TOOL_KEYS } from './actions/tools';
import { Board } from './ui/board/Board';
import { useBoardEnv, usePainter } from './ui/board/context';
import { activeBoard, createUiStore, selectIds, w2v } from './ui/board/state';
import type { Popover, Tool, UiStore } from './ui/board/state';
import { registerViewFallbacks, zoomToFit } from './ui/board/viewActions';
import { ChatPanel } from './ChatPanel.tsx';
import type { Msg, Thread } from './ChatPanel.tsx';
import './playground.css';

// ---- identity and hosting: one place each ----

/**
 * The local human's actor id. This is the ONLY place it is made: unique per person and per tab,
 * which a networked board needs. Everything else reads `board.me`.
 */
export function humanId(): ActorId {
  return makeActorId('human');
}
/** This browser runs the scripted agents (a networked viewer would pass false). */
const HOST_AGENTS = true;
/** Actor that reassigns an unowned layer to the agent a note was routed to (kept off the human's undo stack). */
const ROUTER: ActorId = 'system-router';


/** A comment pin, anchored to a layer (offset from its top-left) so it follows the layer around. */
export type Pin = { id: string; n: number; shapeId: string; dx: number; dy: number; thread: string; done: boolean };
type Route = { thread: string; how: 'author' | 'nearest' | 'none' };
type Meta = { id: ActorId; name: string; color: string; kind: ActorKind; state?: AgentState; detail?: string };

const YOU_COLOR = '#0d99ff';
const CLAUDE = { name: 'Claude', color: '#d97757' };
const BUBBLE = 'M12 4c4.4 0 8 3.1 8 7s-3.6 7-8 7c-1 0-2-.2-2.9-.5L4.5 19l1.3-3.6C4.7 14.2 4 12.7 4 11c0-3.9 3.6-7 8-7z';
const ARROW = 'M2.5 2.2 L2.5 19.5 L7.4 15.1 L10.7 22.2 L14.1 20.7 L10.9 13.7 L17.6 13.4 Z';
const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Move', icon: 'M5 3l14 8-6.5 1.5L10 19z' },
  { id: 'frame', label: 'Frame', icon: 'M8 3v18M16 3v18M3 8h18M3 16h18' },
  { id: 'rect', label: 'Rectangle', icon: 'M4 5h16v14H4z' },
  { id: 'ellipse', label: 'Ellipse', icon: 'M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16z' },
  { id: 'text', label: 'Text', icon: 'M5 5h14M12 5v14M9 19h6' },
  { id: 'comment', label: 'Comment: point at a layer, the note goes to its agent', icon: BUBBLE },
  { id: 'hand', label: 'Hand', icon: 'M8 13V6a1.5 1.5 0 0 1 3 0v5m0-6a1.5 1.5 0 0 1 3 0v6m0-5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.5L8 15' },
];
const KIND_ICON: Record<string, string> = { frame: '#', group: '⧉', rect: '▢', ellipse: '◯', text: 'T', line: '／', image: '▣' };

const statusOf = (m: Meta) => (m.state === 'paused' ? 'paused' : m.state === 'stopped' ? 'stopped' : m.detail ?? m.state ?? 'idle');

/** "Frame › Layer" for the nearest frame above a layer. */
function ctxLabel(board: BoardKit, id: ShapeId): string {
  const st = board.doc.getState();
  const s = st.shapes.get(id);
  if (!s) return '';
  const f = ancestors(st, id).map((a) => st.shapes.get(a)!).find((a) => a.kind === 'frame');
  return f ? `${f.name} › ${s.name}` : s.name;
}

/** A note about a layer goes to the agent that made it, else its frame's maker, else the nearest agent. */
function routeFor(board: BoardKit, rt: AgentRuntime | null, id: ShapeId): Route {
  const live = new Set(rt?.agentIds() ?? []);
  const st = board.doc.getState();
  for (const sid of [id, ...ancestors(st, id)]) {
    const s = st.shapes.get(sid);
    const owner = [s?.author, s?.createdBy].find((a) => a && live.has(a));
    if (owner) return { thread: owner, how: 'author' };
  }
  const r = absRect(st, id);
  let best: ActorId | null = null, bd = Infinity;
  for (const a of live) {
    const p = board.presence.get(a);
    if (!r || p?.x === undefined || p.y === undefined) continue;
    const d = Math.hypot(p.x - (r.x + r.w / 2), p.y - (r.y + r.h / 2));
    if (d < bd) { bd = d; best = a; }
  }
  return best ? { thread: best, how: 'nearest' } : { thread: 'general', how: 'none' };
}

/** Actors with their presence state; re-renders only when names, colours or statuses change. */
function useActorMeta(board: BoardKit): Meta[] {
  const compute = useCallback((): Meta[] => board.actors.list()
    .filter((a) => a.id === board.me || board.presence.get(a.id))
    .map((a) => { const p = board.presence.get(a.id); return { id: a.id, name: a.name, color: a.color, kind: a.kind, state: p?.state, detail: p?.detail }; }), [board]);
  const [list, setList] = useState(compute);
  useEffect(() => {
    let key = '';
    const update = () => { const next = compute(); const k = JSON.stringify(next); if (k !== key) { key = k; setList(next); } };
    update();
    const offs = [board.actors.subscribe(update), board.presence.subscribe(update)];
    return () => offs.forEach((f) => f());
  }, [board, compute]);
  return list;
}

function createKit() {
  const sink: { say: ((actor: ActorId, text: string) => void) | null } = { say: null };
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

const viewCenter = () => { const r = camera.visibleRect(); return r.w > 0 ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 600, y: 300 }; };

export function Playground() {
  const [{ board, ui, sink }] = useState(createKit);
  const me = board.me;
  const [rt, setRt] = useState<AgentRuntime | null>(null);
  const rtRef = useRef<AgentRuntime | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [thread, setThread] = useState('general');
  const [leftTab, setLeftTab] = useState<'chat' | 'layers'>('chat');
  const [pins, setPins] = useState<Pin[]>([]);
  const [showPins, setShowPins] = useState(true);
  const [menu, setMenu] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [focusMsg, setFocusMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const pinCount = useRef(0);
  /** Notes waiting on each agent, oldest first: its replies are tagged with the head note's layer. */
  const pending = useRef(new Map<ActorId, Array<{ ctx?: string; shapeId?: string }>>());

  const tool = useStoreValue(ui.subscribe, useCallback(() => ui.get().tool, [ui]));
  const editing = useStoreValue(ui.subscribe, useCallback(() => ui.get().editing, [ui]));
  const pop = useStoreValue(ui.subscribe, useCallback(() => ui.get().pop, [ui]));
  const subSel = useCallback((l: () => void) => board.selection.subscribe(() => l()), [board]);
  const selIds = useStoreValue(subSel, useCallback(() => board.selection.get(board.me).ids, [board]));
  const selId = selIds.length ? selIds[selIds.length - 1] : '';
  const sel = useShape(board.doc, selId);
  const cursors = useActorMeta(board);

  const post = useCallback((m: Omit<Msg, 'id' | 't'>) => setMessages((ms) => [...ms, { ...m, id: newId('m'), t: Date.now() }]), []);
  const resolvePin = useCallback((id: string) => setPins((ps) => ps.map((p) => (p.id === id ? { ...p, done: true } : p))), []);

  // agent chat lines land in the agent's own thread
  sink.say = (actor, text) => {
    const a = board.actors.get(actor);
    const head = pending.current.get(actor)?.[0];
    const tag = head && !/^(Starting a |Finished the )/.test(text) ? head : undefined;
    post({ thread: actor, from: actor, name: a?.name ?? actor, color: a?.color ?? '#999', text, ctx: tag?.ctx, shapeId: tag?.shapeId });
  };

  // boot: keys, view shortcuts, the agent runtime with three agents, window.board
  useEffect(() => {
    // core/keys install() types its target with `(e: never)` listeners, which Window does not satisfy
    const offKeys = installKeys(window as unknown as Parameters<typeof installKeys>[0]);
    const offView = registerViewFallbacks();
    const r = startAgents(board, { host: HOST_AGENTS, onSay: (a, text) => sink.say?.(a.id, text) });
    rtRef.current = r;
    setRt(r);
    for (let i = 0; i < 3; i++) r.spawn({ at: viewCenter() });

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
      pending.current.clear();
      setMessages([]); setPins([]); pinCount.current = 0;
    };
  }, [board, sink]);

  useEffect(() => ui.onEscape(() => setMenu(false)), [ui]);

  const pickTool = (t: Tool) => ui.set({ tool: t, pop: null, hover: null });

  const openThread = useCallback((t: string, msgId?: string) => {
    setThread(t);
    setLeftTab('chat');
    setFlash(t);
    setTimeout(() => setFlash((f) => (f === t ? null : f)), 1400);
    if (msgId) setFocusMsg(msgId);
  }, []);

  const send = useCallback((text: string, opts: { thread?: string; shapeId?: string; at?: { x: number; y: number } } = {}) => {
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
        post({ thread: 'general', from: 'you', name: 'You', color: YOU_COLOR, text });
        post({ thread: 'general', from: 'claude', ...CLAUDE, text: `Routing that to ${board.actors.get(pick)?.name ?? pick} →` });
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
    post({ thread: target, from: 'you', name: 'You', color: YOU_COLOR, text, ctx, pin: pinId, shapeId: shape?.id });
    if (target === 'general' || !r) {
      post({ thread: 'general', from: 'claude', ...CLAUDE, text: 'No agents on the board yet. Add one with + Agent and I will route notes to it.' });
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
  }, [board, me, post, resolvePin, openThread]);

  const focusShape = useCallback((id: string) => {
    const st = board.doc.getState();
    const s = st.shapes.get(id);
    const r = s && !s.deleted ? absRect(st, id) : null;
    if (!r) return;
    selectIds(board, [id]);
    const z = Math.max(camera.getCam().z, 0.8);
    const v = camera.getViewSize();
    camera.setCam({ z, x: v.w / 2 - (r.x + r.w / 2) * z, y: v.h / 2 - (r.y + r.h / 2) * z });
  }, [board]);

  const share = () => {
    navigator.clipboard?.writeText(location.href).catch(() => {});
    setToast('Link copied');
    setTimeout(() => setToast(null), 1600);
  };

  const clearBoard = () => {
    const r = rtRef.current;
    if (!r) return;
    const n = r.agentIds().length;
    selectIds(board, []);
    r.reset();   // stops every agent; an interrupted build commits what it drew on its next tick
    setTimeout(() => {
      const roots = [...(board.doc.getState().children.get(null) ?? [])];
      if (roots.length) board.exec({ actor: me, opId: opId(me), commands: [{ t: 'shape.delete', ids: roots }], label: 'Clear board' });
      r.resetSlots();
      for (let i = 0; i < n; i++) r.spawn({ at: viewCenter() });
    }, 200);
  };

  const agents = cursors.filter((c) => c.kind === 'agent');
  const allPaused = agents.length > 0 && agents.every((c) => c.state === 'paused');
  const threads: Thread[] = useMemo(() => {
    const list: Thread[] = [{ id: 'general', name: 'General', color: CLAUDE.color, status: 'everyone', live: true }];
    for (const c of agents) list.push({ id: c.id, name: c.name, color: c.color, status: statusOf(c), live: true });
    const known = new Set(list.map((t) => t.id));
    for (const m of messages) {
      if (known.has(m.thread)) continue;
      const a = messages.find((x) => x.thread === m.thread && x.from === m.thread);
      list.push({ id: m.thread, name: a?.name ?? m.thread, color: a?.color ?? '#999', status: 'left the board', live: false });
      known.add(m.thread);
    }
    return list;
  }, [agents, messages]);
  const threadOf = (id: string) => threads.find((t) => t.id === id);
  const describeTarget = (id: ShapeId) => {
    const t = threadOf(routeFor(board, rt, id).thread);
    return { label: `${board.doc.getState().shapes.get(id)?.name ?? ''} → ${t?.name ?? 'General'}`, color: t?.color ?? CLAUDE.color };
  };

  return (
    <div className="pg">
      <header className="pg-top">
        <a className="pg-back" href="#/live" title="Back to dashboard">←</a>
        <span className="pg-logo">◆</span>
        <strong>Playground</strong>
        <span className="pg-sub">multi-agent design board · proof of concept</span>
        <span className="pg-grow" />
        <div className="pg-avatars">
          {cursors.slice(0, 8).map((c) => <span key={c.id} title={c.name} style={{ background: c.kind === 'human' ? YOU_COLOR : c.color }}>{c.name[0]}</span>)}
          {cursors.length > 8 && <span className="more">+{cursors.length - 8}</span>}
        </div>
        <div className="pg-cbtn">
          <button className={'pg-icon' + (tool === 'comment' ? ' on' : '')} title={`Comment (${TOOL_KEYS.comment.toUpperCase()})`} onClick={() => pickTool(tool === 'comment' ? 'select' : 'comment')}>
            <svg viewBox="0 0 24 24" width="20" height="20"><path d={BUBBLE} /></svg>
          </button>
          <button className="pg-chev" title="Comment options" onClick={() => setMenu((m) => !m)}>▾</button>
          {menu && (
            <div className="pg-menu" onMouseLeave={() => setMenu(false)}>
              <label><input type="checkbox" checked={showPins} onChange={(e) => setShowPins(e.target.checked)} /> Show comment pins</label>
              <button onClick={() => { setPins((ps) => ps.filter((p) => !p.done)); setMenu(false); }}>Clear resolved pins</button>
            </div>
          )}
        </div>
        <button className="pg-share" onClick={share} title="Copy link">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z" /></svg>
          Share
        </button>
        <ZoomButton />
      </header>

      <div className="pg-body">
        <aside className="pg-panel pg-left" data-pg-ctx="panel">
          <div className="pg-tabs">
            <button className={leftTab === 'chat' ? 'on' : ''} onClick={() => setLeftTab('chat')}>Chat</button>
            <button className={leftTab === 'layers' ? 'on' : ''} onClick={() => setLeftTab('layers')}>Layers <LayerCount board={board} /></button>
          </div>
          {leftTab === 'chat' ? (
            <ChatPanel threads={threads} active={thread} onPick={setThread} flash={flash} messages={messages}
              focusMsg={focusMsg} onFocused={() => setFocusMsg(null)}
              attached={sel && !sel.deleted && sel.id !== editing ? { id: sel.id, label: ctxLabel(board, sel.id), to: threadOf(routeFor(board, rt, sel.id).thread) } : undefined}
              onDetach={() => selectIds(board, [])}
              onSend={(text, shapeId) => send(text, { thread, shapeId })}
              onShowShape={focusShape}
              commentOn={tool === 'comment'}
              onCommentTool={() => pickTool('comment')} />
          ) : (
            <LayersPanel board={board} selected={selIds} agents={cursors} />
          )}
        </aside>

        <Board board={board} camera={camera} ui={ui} describeTarget={describeTarget}>
          {showPins && <Pins pins={pins} threads={threads} messages={messages} onOpen={openThread} />}
          {pop && <CommentPopover pop={pop} ui={ui} board={board} rt={rt} threadOf={threadOf} onSend={send} />}
          {toast && <div className="pg-toast">{toast}</div>}
          <Cursors cursors={cursors} tool={tool} />
          <div className="pg-toolbar">
            {TOOLS.map((t) => (
              <button key={t.id} className={tool === t.id ? 'on' : ''} title={`${t.label} (${TOOL_KEYS[t.id].toUpperCase()})`} onClick={() => pickTool(t.id)}>
                <svg viewBox="0 0 24 24" width="18" height="18"><path d={t.icon} /></svg>
              </button>
            ))}
          </div>
          <div className="pg-hint">Scroll to pan · ⌘/Ctrl + scroll to zoom · Space-drag to pan · Shift+1 fit</div>
        </Board>

        <aside className="pg-panel pg-right" data-pg-ctx="panel">
          <div className="pg-h">Cursors <span>{cursors.length}</span></div>
          <div className="pg-actions">
            <button className="primary" onClick={() => rt?.spawn({ at: viewCenter() })}>+ Agent</button>
            <button onClick={() => { for (let i = 0; i < 5; i++) rt?.spawn({ at: viewCenter() }); }}>+5</button>
            <button onClick={() => rt?.setAllPaused(!allPaused)}>{allPaused ? 'Resume' : 'Pause'} all</button>
          </div>
          <div className="pg-row">
            <label>Speed</label>
            <div className="pg-seg">
              {[0.5, 1, 2, 4].map((v) => (
                <button key={v} className={speed === v ? 'on' : ''} onClick={() => { setSpeed(v); rt?.setSpeed(v); }}>{v}×</button>
              ))}
            </div>
          </div>
          <div className="pg-cursorlist">
            {cursors.map((c) => (
              <div key={c.id} className="pg-crow">
                <svg width="14" height="15" viewBox="0 0 22 24" style={{ ['--c' as string]: c.kind === 'human' ? YOU_COLOR : c.color }} className="pg-mini"><path d={ARROW} /></svg>
                <div className="pg-cname">
                  <b>{c.name}</b>
                  <small>{c.kind === 'human' ? 'you · mouse' : c.kind === 'api' ? 'window.board' : statusOf(c)}</small>
                </div>
                {c.kind === 'agent' && (
                  <button className="ghost" title={c.state === 'paused' ? 'Resume' : 'Pause'} onClick={() => rt?.setPaused(c.id, c.state !== 'paused')}>{c.state === 'paused' ? '▶' : '❚❚'}</button>
                )}
                {c.kind !== 'human' && (
                  <button className="ghost" title="Remove" onClick={() => {
                    if (c.kind === 'agent') rt?.remove(c.id); else board.actors.remove(c.id);
                    board.presence.remove(c.id);
                  }}>✕</button>
                )}
              </div>
            ))}
          </div>
          <div className="pg-foot">
            <button onClick={clearBoard}>Clear board</button>
            <details>
              <summary>Drive a cursor from code</summary>
              <pre>{`const id = board.addCursor('Claude')
await board.moveCursor(id, 400, 200)
board.press(id, true)
board.addShape({ x: 400, y: 200,
  w: 160, h: 90, fill: '#a259ff' })
board.exec({ t: 'shape.update',
  ids: [id], patch: { opacity: .5 } })
board.spawnAgent()`}</pre>
            </details>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Zoom % in the top bar: written from the camera, so zooming never re-renders the page. Click = fit. */
function ZoomButton() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => camera.subscribeSelect((c) => Math.round(c.z * 100), (pct) => { if (ref.current) ref.current.textContent = `${pct}%`; }), []);
  return (
    <button ref={ref} className="pg-zoom" title="Zoom to fit (Shift+1)" onClick={() => { const e = activeBoard(); if (e) zoomToFit(e); }}>
      {Math.round(camera.getCam().z * 100)}%
    </button>
  );
}

function LayerCount({ board }: { board: BoardKit }) {
  const n = useStoreValue(board.doc.subscribe, useCallback(() => flatten(board.doc.getState()).length, [board]));
  return <span>{n}</span>;
}

function LayersPanel({ board, selected, agents }: { board: BoardKit; selected: readonly ShapeId[]; agents: Meta[] }) {
  const st = useDoc(board.doc);
  const color = new Map(agents.map((a) => [a.id, a.color]));
  const rows: Array<{ id: ShapeId; depth: number }> = [];
  const walk = (p: ShapeId | null, depth: number) => {
    const kids = st.children.get(p) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) { rows.push({ id: kids[i], depth }); walk(kids[i], depth + 1); }
  };
  walk(null, 0);
  return (
    <div className="pg-layers">
      {rows.slice(0, 400).map(({ id, depth }) => {
        const s = st.shapes.get(id)!;
        return <LayerRow key={id} name={s.kind === 'text' && s.text ? s.text : s.name} kind={s.kind} depth={depth} active={selected.includes(id)}
          owner={s.author ? color.get(s.author) : undefined} onPick={() => selectIds(board, [id])} />;
      })}
      {!rows.length && <div className="pg-empty">Agents are warming up…</div>}
    </div>
  );
}

const LayerRow = memo(function LayerRow({ name, kind, depth, active, owner, onPick }: { name: string; kind: string; depth: number; active: boolean; owner?: string; onPick: () => void }) {
  return (
    <div className={'pg-layer' + (active ? ' on' : '') + (kind === 'frame' ? ' frame' : '')} style={{ paddingLeft: 8 + depth * 14 }} onClick={onPick}>
      <span className="ic">{KIND_ICON[kind] ?? '•'}</span>
      <span className="nm">{name}</span>
      {owner && <span className="dot" style={{ background: owner }} />}
    </div>
  );
});

/** Every cursor: agents and API cursors from presence (world coords), yours from the pointer. */
function Cursors({ cursors, tool }: { cursors: Meta[]; tool: Tool }) {
  const env = useBoardEnv();
  const els = useRef(new Map<string, HTMLDivElement>());
  usePainter((cam) => {
    for (const [id, el] of els.current) {
      const p = env.board.presence.get(id);
      if (id === env.board.me) {
        el.style.transform = `translate3d(${env.pointer.x}px, ${env.pointer.y}px, 0)`;
        el.style.opacity = env.pointer.inside ? '1' : '0';
        el.classList.toggle('down', !!p?.down);
        continue;
      }
      if (p?.x === undefined || p.y === undefined) { el.style.opacity = '0'; continue; }
      const v = w2v(cam, { x: p.x, y: p.y });
      el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0)`;
      el.style.opacity = '1';
      el.classList.toggle('down', !!p.down);
    }
  });
  return (
    <div className="pg-cursors">
      {cursors.map((c) => {
        const human = c.kind === 'human';
        const status = statusOf(c);
        return (
          <div key={c.id} className={'pg-cursor' + (human ? ' human' : '') + (human && tool === 'comment' ? ' bubble' : '')}
            ref={(el) => { if (el) els.current.set(c.id, el); else els.current.delete(c.id); }}
            style={{ ['--c' as string]: human ? YOU_COLOR : c.color, opacity: 0 }}>
            <svg className="arrow" width="22" height="24" viewBox="0 0 22 24" aria-hidden="true"><path d={ARROW} /></svg>
            {human && <svg className="bub" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V11a8 8 0 1 1 8 8H3z" /></svg>}
            <span className="pg-tag">{c.name}{!human && status !== 'idle' ? <em> · {status}</em> : null}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Numbered comment pins that follow their layer; a check once the agent has handled the note. */
function Pins({ pins, threads, messages, onOpen }: { pins: Pin[]; threads: Thread[]; messages: Msg[]; onOpen: (thread: string, msgId?: string) => void }) {
  const env = useBoardEnv();
  const els = useRef(new Map<string, HTMLButtonElement>());
  usePainter((cam) => {
    const st = env.board.doc.getState();
    for (const p of pins) {
      const el = els.current.get(p.id);
      if (!el) continue;
      const s = st.shapes.get(p.shapeId);
      const r = s && !s.deleted ? absRect(st, p.shapeId) : null;
      if (!r) { el.style.display = 'none'; continue; }
      const v = w2v(cam, { x: r.x + p.dx, y: r.y + p.dy });
      el.style.display = '';
      el.style.left = `${v.x}px`;
      el.style.top = `${v.y}px`;
    }
  });
  return (
    <div className="pg-pins">
      {pins.map((p) => {
        const t = threads.find((x) => x.id === p.thread);
        const msg = messages.find((m) => m.pin === p.id);
        return (
          <button key={p.id} className={'pg-pin' + (p.done ? ' done' : '')} title={msg?.text}
            ref={(el) => { if (el) els.current.set(p.id, el); else els.current.delete(p.id); }}
            style={{ ['--c' as string]: t?.color ?? CLAUDE.color }}
            onClick={() => onOpen(p.thread, msg?.id)}>
            <span>{p.done ? '✓' : p.n}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The comment box next to the clicked point; Enter sends to the routed agent. */
function CommentPopover({ pop, ui, board, rt, threadOf, onSend }: {
  pop: Popover; ui: UiStore; board: BoardKit; rt: AgentRuntime | null;
  threadOf: (id: string) => Thread | undefined;
  onSend: (text: string, o: { shapeId: string; at: { x: number; y: number } }) => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const route = useMemo(() => routeFor(board, rt, pop.shapeId), [board, rt, pop]);
  // Focus now (the board prevents the mousedown default, so nothing steals it), and again once the
  // click that opened it has finished, in case something else took focus in between.
  useLayoutEffect(() => {
    input.current?.focus();
    const again = () => { if (document.activeElement !== input.current) input.current?.focus(); };
    const t = setTimeout(again, 0);
    window.addEventListener('pointerup', again, { once: true });
    window.addEventListener('click', again, { once: true });
    return () => { clearTimeout(t); window.removeEventListener('pointerup', again); window.removeEventListener('click', again); };
  }, [pop]);
  usePainter((cam) => {
    if (!ref.current) return;
    const v = w2v(cam, { x: pop.wx, y: pop.wy });
    ref.current.style.left = `${v.x + 14}px`;
    ref.current.style.top = `${v.y - 8}px`;
  });
  const s = board.doc.getState().shapes.get(pop.shapeId);
  if (!s) return null;
  const t = threadOf(route.thread);
  const close = () => ui.set({ pop: null });
  return (
    <form ref={ref} className="pg-pop" style={{ ['--c' as string]: t?.color ?? CLAUDE.color }}
      onSubmit={(e) => {
        e.preventDefault();
        const v = new FormData(e.currentTarget).get('note')?.toString().trim();
        if (v) onSend(v, { shapeId: pop.shapeId, at: { x: pop.wx, y: pop.wy } });
        close();
      }}>
      <div className="pg-pop-to">
        <i style={{ background: t?.color ?? CLAUDE.color }} />
        <b>{t?.name ?? 'General'}</b>
        <small>{route.how === 'author' ? 'made this' : route.how === 'nearest' ? 'nearest agent' : 'no agents yet'}</small>
      </div>
      <div className="pg-pop-ctx">{ctxLabel(board, pop.shapeId)}</div>
      <textarea name="note" rows={2} ref={input} placeholder={`Ask ${t?.name ?? 'Claude'} to change this…`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
          if (e.key === 'Escape') close();
        }} />
      <div className="pg-pop-foot">
        <span>Enter to send · auto-routed</span>
        <button type="submit" aria-label="Send">↑</button>
      </div>
    </form>
  );
}
