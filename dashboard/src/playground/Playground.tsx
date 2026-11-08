// Temporary playground (#/playground): a Figma / Claude-Design style dotted board where many
// cursors (you, scripted agents, or anything calling window.board) design at the same time.
// Proof of concept only; not wired to SpacetimeDB.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEngine, uid, COLORS, type CursorMeta, type Kind, type Msg, type Shape } from './engine.ts';
import { ChatPanel, type Thread } from './ChatPanel.tsx';
import './playground.css';

type Tool = 'select' | 'frame' | 'rect' | 'ellipse' | 'text' | 'hand' | 'comment';
/** A comment pin, anchored to a layer so it follows the layer around. */
export type Pin = { id: string; n: number; shapeId: string; dx: number; dy: number; thread: string; done: boolean };
type Route = { thread: string; how: 'author' | 'nearest' | 'none' };
type Popover = { shapeId: string; wx: number; wy: number; route: Route };
type Cam = { x: number; y: number; z: number };
type Drag =
  | { mode: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { mode: 'move'; px: number; py: number; orig: Map<string, { x: number; y: number }> }
  | { mode: 'resize'; id: string; corner: string; orig: Shape }
  | { mode: 'create'; id: string; ox: number; oy: number };

const HUMAN = { id: 'you', name: 'You', color: '#0d99ff' };
const DOT_GAP = 24;

const BUBBLE = 'M12 4c4.4 0 8 3.1 8 7s-3.6 7-8 7c-1 0-2-.2-2.9-.5L4.5 19l1.3-3.6C4.7 14.2 4 12.7 4 11c0-3.9 3.6-7 8-7z';
const TOOLS: { id: Tool; key: string; label: string; icon: string }[] = [
  { id: 'select', key: 'V', label: 'Move', icon: 'M5 3l14 8-6.5 1.5L10 19z' },
  { id: 'frame', key: 'F', label: 'Frame', icon: 'M8 3v18M16 3v18M3 8h18M3 16h18' },
  { id: 'rect', key: 'R', label: 'Rectangle', icon: 'M4 5h16v14H4z' },
  { id: 'ellipse', key: 'O', label: 'Ellipse', icon: 'M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16z' },
  { id: 'text', key: 'T', label: 'Text', icon: 'M5 5h14M12 5v14M9 19h6' },
  { id: 'comment', key: 'C', label: 'Comment: point at a layer, the note goes to its agent', icon: BUBBLE },
  { id: 'hand', key: 'H', label: 'Hand', icon: 'M8 13V6a1.5 1.5 0 0 1 3 0v5m0-6a1.5 1.5 0 0 1 3 0v6m0-5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.5L8 15' },
];
const KIND_ICON: Record<Kind, string> = { frame: '#', rect: '▢', ellipse: '◯', text: 'T' };

const norm = (x1: number, y1: number, x2: number, y2: number) => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
const inside = (a: Shape, b: Shape) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const frameOf = (s: Shape, all: Shape[]) =>
  all.filter((f) => f.kind === 'frame' && f.id !== s.id && inside(s, f)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
const ctxLabel = (s: Shape, all: Shape[]) => { const f = frameOf(s, all); return f ? `${f.name} › ${s.name}` : s.name; };

export function Playground() {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [cursors, setCursors] = useState<CursorMeta[]>([]);
  const [cam, setCam] = useState<Cam>({ x: 60, y: 90, z: 0.55 });
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [panning, setPanning] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [thread, setThread] = useState('general');
  const [leftTab, setLeftTab] = useState<'chat' | 'layers'>('chat');
  const [pins, setPins] = useState<Pin[]>([]);
  const [showPins, setShowPins] = useState(true);
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [pop, setPop] = useState<Popover | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [focusMsg, setFocusMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const shapesRef = useRef(shapes); shapesRef.current = shapes;
  const engine = useMemo(() => createEngine({
    setShapes, setCursors,
    getShapes: () => shapesRef.current,
    post: (m) => setMessages((ms) => [...ms, m]),
    resolvePin: (id) => setPins((ps) => ps.map((p) => (p.id === id ? { ...p, done: true } : p))),
  }), []);
  const camRef = useRef(cam); camRef.current = cam;
  const hoverRef = useRef(hover); hoverRef.current = hover;
  const pinCount = useRef(0);
  const popInput = useRef<HTMLTextAreaElement>(null);
  // focus the comment box once the click that opened it has finished (mousedown would steal it)
  useEffect(() => { if (pop) { const t = setTimeout(() => popInput.current?.focus(), 0); return () => clearTimeout(t); } }, [pop]);
  const toolRef = useRef(tool); toolRef.current = tool;
  const viewRef = useRef<HTMLDivElement>(null);
  const cursorEls = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);

  // boot: you + three agents. StrictMode double-mount is handled by reset() in cleanup.
  useEffect(() => {
    engine.addCursor({ ...HUMAN, kind: 'human', status: 'here' });
    for (let i = 0; i < 3; i++) engine.spawnAgent();
    return () => { engine.reset(); setMessages([]); setPins([]); pinCount.current = 0; };
  }, [engine]);

  // animation loop: advance cursor tweens, then paint cursors straight to the DOM (no React render).
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      engine.tick(now);
      const c = camRef.current;
      for (const p of engine.pos.values()) {
        const el = cursorEls.current.get(p.id);
        if (!el) continue;
        const sx = p.human ? engine.human.x : p.x * c.z + c.x;
        const sy = p.human ? engine.human.y : p.y * c.z + c.y;
        el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
        el.classList.toggle('down', p.down);
        if (p.human) el.style.opacity = engine.human.visible ? '1' : '0';
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = viewRef.current!.getBoundingClientRect();
    const c = camRef.current;
    return { x: (cx - r.left - c.x) / c.z, y: (cy - r.top - c.y) / c.z };
  }, []);

  const viewCenter = useCallback(() => {
    const r = viewRef.current?.getBoundingClientRect();
    const c = camRef.current;
    return r ? { x: (r.width / 2 - c.x) / c.z, y: (r.height / 2 - c.y) / c.z } : { x: 600, y: 300 };
  }, []);

  const fit = useCallback(() => {
    const ss = shapesRef.current;
    const r = viewRef.current!.getBoundingClientRect();
    if (!ss.length) return setCam({ x: 60, y: 90, z: 0.55 });
    const x1 = Math.min(...ss.map((s) => s.x)), y1 = Math.min(...ss.map((s) => s.y));
    const x2 = Math.max(...ss.map((s) => s.x + s.w)), y2 = Math.max(...ss.map((s) => s.y + s.h));
    const z = Math.min(1.5, (r.width - 120) / (x2 - x1), (r.height - 120) / (y2 - y1));
    setCam({ z, x: r.width / 2 - ((x1 + x2) / 2) * z, y: r.height / 2 - ((y1 + y2) / 2) * z });
  }, []);

  // public API so anything (console, another process via a bridge) can drive cursors
  useEffect(() => {
    let api = 0;
    (window as any).board = {
      spawnAgent: () => engine.spawnAgent(viewCenter()),
      addCursor: (name = `Bot ${++api}`, color = COLORS[(api + 5) % COLORS.length]) =>
        engine.addCursor({ id: uid('api-'), name, color, kind: 'api', status: 'API-controlled' }, viewCenter().x, viewCenter().y),
      moveCursor: (id: string, x: number, y: number, ms?: number) => engine.moveTo(id, x, y, { dur: ms }),
      press: (id: string, down: boolean) => engine.press(id, down),
      removeCursor: (id: string) => engine.removeCursor(id),
      addShape: (s: Partial<Shape>) => { const id = s.id ?? uid(); engine.addShape({ kind: 'rect', name: 'Shape', x: 0, y: 0, w: 100, h: 100, fill: '#e7e5e0', ...s, id }); return id; },
      updateShape: (id: string, p: Partial<Shape>) => engine.patch(id, p),
      shapes: () => shapesRef.current,
      cursors: () => [...engine.pos.values()].map(({ id, x, y, down }) => ({ id, x, y, down })),
    };
    return () => { delete (window as any).board; };
  }, [engine, viewCenter]);

  // wheel: pan, ctrl/cmd (or pinch) to zoom around the pointer
  useEffect(() => {
    const el = viewRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        const z = Math.min(4, Math.max(0.08, c.z * Math.exp(-e.deltaY * 0.01)));
        setCam({ z, x: sx - (sx - c.x) * (z / c.z), y: sy - (sy - c.y) * (z / c.z) });
      } else {
        setCam({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.code === 'Space') { spaceRef.current = true; setPanning(true); e.preventDefault(); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
        const sel = shapesRef.current.find((s) => s.id === selected);
        const kids = sel?.kind === 'frame' ? new Set(shapesRef.current.filter((s) => s !== sel && inside(s, sel)).map((s) => s.id)) : new Set<string>();
        setShapes((ss) => ss.filter((s) => s.id !== selected && !kids.has(s.id)));
        setSelected(null);
        return;
      }
      if (e.key === 'Escape') { setPop(null); setMenu(false); setSelected(null); setTool('select'); return; }
      if (e.shiftKey && e.code === 'Digit1') { fit(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); setCam((c) => ({ ...c, z: 1 })); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = TOOLS.find((t) => t.key === e.key.toUpperCase());
      if (t) setTool(t.id);
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { spaceRef.current = false; setPanning(false); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [selected, fit]);

  // ---- routing: a note about a layer goes to the agent that made it (or the nearest one) ----
  const routeFor = useCallback((s: Shape): Route => {
    const live = new Set(engine.agentIds());
    const f = frameOf(s, shapesRef.current);
    const owner = [s.author, f?.author].find((a) => a && live.has(a));
    if (owner) return { thread: owner, how: 'author' };
    let best: string | null = null, bd = Infinity;
    for (const id of live) {
      const p = engine.pos.get(id);
      if (!p) continue;
      const d = Math.hypot(p.x - (s.x + s.w / 2), p.y - (s.y + s.h / 2));
      if (d < bd) { bd = d; best = id; }
    }
    return best ? { thread: best, how: 'nearest' } : { thread: 'general', how: 'none' };
  }, [engine]);

  const openThread = useCallback((t: string, msgId?: string) => {
    setThread(t);
    setLeftTab('chat');
    setFlash(t);
    setTimeout(() => setFlash((f) => (f === t ? null : f)), 1400);
    if (msgId) setFocusMsg(msgId);
  }, []);

  const send = useCallback((text: string, opts: { thread?: string; shapeId?: string; at?: { x: number; y: number } } = {}) => {
    const shape = opts.shapeId ? shapesRef.current.find((s) => s.id === opts.shapeId) : undefined;
    let target = opts.thread ?? 'general';
    if (shape) {
      const r = routeFor(shape);
      target = r.thread;
      // claim unowned layers for the agent we routed to, so follow-ups land in the same chat
      if (r.how === 'nearest') setShapes((ss) => ss.map((s) => (s.id === shape.id ? { ...s, author: r.thread } : s)));
    } else if (target === 'general') {
      const live = engine.agentIds();
      if (live.length) {
        const pick = live[Math.floor(Math.random() * live.length)];
        setMessages((ms) => [...ms, { id: uid('m'), thread: 'general', from: 'you', name: 'You', color: HUMAN.color, text, t: Date.now() },
          { id: uid('m'), thread: 'general', from: 'claude', name: 'Claude', color: '#d97757', text: `Routing that to ${engine.names().get(pick)} →`, t: Date.now() }]);
        target = pick;
      }
    }
    const ctx = shape ? ctxLabel(shape, shapesRef.current) : undefined;
    let pinId: string | undefined;
    if (shape) {
      pinId = uid('p');
      const at = opts.at ?? { x: shape.x + shape.w - 4, y: shape.y + 4 };
      const pin: Pin = { id: pinId, n: ++pinCount.current, shapeId: shape.id, dx: at.x - shape.x, dy: at.y - shape.y, thread: target, done: false };
      setPins((ps) => [...ps, pin]);
    }
    const mid = uid('m');
    setMessages((ms) => [...ms, { id: mid, thread: target, from: 'you', name: 'You', color: HUMAN.color, text, ctx, pin: pinId, shapeId: shape?.id, t: Date.now() }]);
    if (target === 'general') {
      setMessages((ms) => [...ms, { id: uid('m'), thread: 'general', from: 'claude', name: 'Claude', color: '#d97757', text: 'No agents on the board yet. Add one with + Agent and I will route notes to it.', t: Date.now() }]);
      if (pinId) setPins((ps) => ps.map((p) => (p.id === pinId ? { ...p, done: true } : p)));
    } else {
      engine.request(target, { text, shapeId: shape?.id, ctx, pin: pinId });
    }
    openThread(target);
  }, [engine, routeFor, openThread]);

  const focusShape = useCallback((id: string) => {
    const s = shapesRef.current.find((x) => x.id === id);
    const r = viewRef.current?.getBoundingClientRect();
    if (!s || !r) return;
    setSelected(id);
    const z = Math.max(camRef.current.z, 0.8);
    setCam({ z, x: r.width / 2 - (s.x + s.w / 2) * z, y: r.height / 2 - (s.y + s.h / 2) * z });
  }, []);

  const share = () => {
    navigator.clipboard?.writeText(location.href).catch(() => {});
    setToast('Link copied');
    setTimeout(() => setToast(null), 1600);
  };

  const hitTest = (x: number, y: number) => {
    const ss = shapesRef.current;
    for (let i = ss.length - 1; i >= 0; i--) {
      const s = ss[i];
      if (x >= s.x && y >= s.y && x <= s.x + s.w && y <= s.y + s.h) return s;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('textarea, .pg-pop, .pg-pin, .pg-toolbar')) return;
    viewRef.current!.setPointerCapture(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    const t = toolRef.current;
    if (e.button === 1 || t === 'hand' || spaceRef.current) {
      const c = camRef.current;
      dragRef.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: c.x, cy: c.y };
      return;
    }
    if (t === 'frame' || t === 'rect' || t === 'ellipse') {
      const id = uid();
      const n = shapesRef.current.filter((s) => s.kind === t).length + 1;
      setShapes((ss) => [...ss, { id, kind: t, name: `${t[0].toUpperCase()}${t.slice(1)} ${n}`, x: p.x, y: p.y, w: 0, h: 0, fill: t === 'frame' ? '#ffffff' : '#d9d6cf', radius: t === 'frame' ? 12 : 4 }]);
      setSelected(id);
      dragRef.current = { mode: 'create', id, ox: p.x, oy: p.y };
      return;
    }
    if (t === 'comment') {
      const hit = hitTest(p.x, p.y);
      setPop(hit ? { shapeId: hit.id, wx: p.x, wy: p.y, route: routeFor(hit) } : null);
      return;
    }
    if (t === 'text') {
      const id = uid();
      setShapes((ss) => [...ss, { id, kind: 'text', name: 'Text', x: p.x, y: p.y - 10, w: 200, h: 24, fill: 'transparent', text: '', fontSize: 18, color: '#1c1917' }]);
      setSelected(id); setEditing(id); setTool('select');
      return;
    }
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]');
    if (handle && selected) {
      const s = shapesRef.current.find((s) => s.id === selected);
      if (s) dragRef.current = { mode: 'resize', id: s.id, corner: handle.dataset.handle!, orig: s };
      return;
    }
    const hit = hitTest(p.x, p.y);
    if (hit) {
      setSelected(hit.id);
      const group = hit.kind === 'frame' ? shapesRef.current.filter((s) => s === hit || inside(s, hit)) : [hit];
      dragRef.current = { mode: 'move', px: p.x, py: p.y, orig: new Map(group.map((s) => [s.id, { x: s.x, y: s.y }])) };
    } else {
      setSelected(null);
      const c = camRef.current;
      dragRef.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: c.x, cy: c.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = viewRef.current!.getBoundingClientRect();
    engine.human.x = e.clientX - r.left;
    engine.human.y = e.clientY - r.top;
    engine.human.visible = true;
    const p = toWorld(e.clientX, e.clientY);
    const you = engine.pos.get(HUMAN.id);
    if (you) { you.x = p.x; you.y = p.y; you.down = e.buttons === 1; }
    const d = dragRef.current;
    if (toolRef.current === 'comment' && !d) {
      const id = hitTest(p.x, p.y)?.id ?? null;
      if (id !== hoverRef.current) setHover(id);
    }
    if (!d) return;
    if (d.mode === 'pan') setCam((c) => ({ ...c, x: d.cx + e.clientX - d.sx, y: d.cy + e.clientY - d.sy }));
    else if (d.mode === 'create') { const n = norm(d.ox, d.oy, p.x, p.y); setShapes((ss) => ss.map((s) => (s.id === d.id ? { ...s, ...n } : s))); }
    else if (d.mode === 'move') {
      const dx = p.x - d.px, dy = p.y - d.py;
      setShapes((ss) => ss.map((s) => { const o = d.orig.get(s.id); return o ? { ...s, x: o.x + dx, y: o.y + dy } : s; }));
    } else if (d.mode === 'resize') {
      const o = d.orig;
      const ax = d.corner.includes('w') ? o.x + o.w : o.x;
      const ay = d.corner.includes('n') ? o.y + o.h : o.y;
      const n = norm(ax, ay, p.x, p.y);
      setShapes((ss) => ss.map((s) => (s.id === d.id ? { ...s, ...n } : s)));
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.mode === 'create') {
      const def = toolRef.current === 'frame' ? { w: 320, h: 240 } : { w: 120, h: 120 };
      setShapes((ss) => ss.map((s) => (s.id === d.id && s.w < 4 && s.h < 4 ? { ...s, ...def } : s)));
      setTool('select');
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    const hit = hitTest(p.x, p.y);
    if (hit?.kind === 'text') setEditing(hit.id);
  };

  const ownerOf = useMemo(() => new Map(cursors.map((c) => [c.id, c])), [cursors]);
  const sel = shapes.find((s) => s.id === selected);
  const agents = cursors.filter((c) => c.kind !== 'human');
  const allPaused = agents.length > 0 && agents.every((c) => c.paused);
  const threads: Thread[] = useMemo(() => {
    const live = cursors.filter((c) => c.kind === 'agent');
    const list: Thread[] = [{ id: 'general', name: 'General', color: '#d97757', status: 'everyone', live: true }];
    for (const c of live) list.push({ id: c.id, name: c.name, color: c.color, status: c.paused ? 'paused' : c.status, live: true });
    const known = new Set(list.map((t) => t.id));
    for (const m of messages) {
      if (known.has(m.thread)) continue;
      const a = messages.find((x) => x.thread === m.thread && x.from === m.thread);
      list.push({ id: m.thread, name: a?.name ?? m.thread, color: a?.color ?? '#999', status: 'left the board', live: false });
      known.add(m.thread);
    }
    return list;
  }, [cursors, messages]);
  const hoverShape = tool === 'comment' && hover && !pop ? shapes.find((s) => s.id === hover) : undefined;
  const hoverRoute = hoverShape ? routeFor(hoverShape) : null;
  const threadOf = (id: string) => threads.find((t) => t.id === id);
  const popShape = pop ? shapes.find((s) => s.id === pop.shapeId) : undefined;
  const shapeById = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);
  let dot = DOT_GAP * cam.z;
  while (dot < 14) dot *= 2; // thin the grid out when zoomed far out

  return (
    <div className="pg">
      <header className="pg-top">
        <a className="pg-back" href="#/live" title="Back to dashboard">←</a>
        <span className="pg-logo">◆</span>
        <strong>Playground</strong>
        <span className="pg-sub">multi-agent design board · proof of concept</span>
        <span className="pg-grow" />
        <div className="pg-avatars">
          {cursors.slice(0, 8).map((c) => <span key={c.id} title={c.name} style={{ background: c.color }}>{c.name[0]}</span>)}
          {cursors.length > 8 && <span className="more">+{cursors.length - 8}</span>}
        </div>
        <div className="pg-cbtn">
          <button className={'pg-icon' + (tool === 'comment' ? ' on' : '')} title="Comment (C)" onClick={() => { setTool(tool === 'comment' ? 'select' : 'comment'); setPop(null); }}>
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
        <button className="pg-zoom" onClick={fit} title="Zoom to fit (Shift+1)">{Math.round(cam.z * 100)}%</button>
      </header>

      <div className="pg-body">
        <aside className="pg-panel pg-left">
          <div className="pg-tabs">
            <button className={leftTab === 'chat' ? 'on' : ''} onClick={() => setLeftTab('chat')}>Chat</button>
            <button className={leftTab === 'layers' ? 'on' : ''} onClick={() => setLeftTab('layers')}>Layers <span>{shapes.length}</span></button>
          </div>
          {leftTab === 'chat' ? (
            <ChatPanel threads={threads} active={thread} onPick={setThread} flash={flash} messages={messages}
              focusMsg={focusMsg} onFocused={() => setFocusMsg(null)}
              attached={sel && sel.id !== editing ? { id: sel.id, label: ctxLabel(sel, shapes), to: threadOf(routeFor(sel).thread) } : undefined}
              onDetach={() => setSelected(null)}
              onSend={(text, shapeId) => send(text, { thread, shapeId })}
              onShowShape={focusShape}
              commentOn={tool === 'comment'}
              onCommentTool={() => setTool('comment')} />
          ) : (
          <div className="pg-layers">
            {shapes.slice().reverse().slice(0, 400).map((s) => (
              <LayerRow key={s.id} s={s} active={s.id === selected} owner={s.owner ? ownerOf.get(s.owner)?.color : undefined} onPick={setSelected} />
            ))}
            {!shapes.length && <div className="pg-empty">Agents are warming up…</div>}
          </div>
          )}
        </aside>

        <div
          ref={viewRef}
          className={'pg-view' + (panning || tool === 'hand' ? ' panning' : '') + (tool === 'comment' ? ' commenting' : '')}
          style={{ backgroundSize: `${dot}px ${dot}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { engine.human.visible = false; setHover(null); }}
          onDoubleClick={onDoubleClick}
        >
          <div className="pg-world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
            {shapes.map((s) => (
              <ShapeView key={s.id} s={s} z={cam.z} owner={s.owner ? ownerOf.get(s.owner) : undefined}
                editing={editing === s.id}
                onCommit={(text) => {
                  setEditing(null);
                  setShapes((ss) => (text.trim() ? ss.map((x) => (x.id === s.id ? { ...x, text, name: text.slice(0, 24) } : x)) : ss.filter((x) => x.id !== s.id)));
                }} />
            ))}
            {sel && !editing && tool !== 'comment' && <Selection s={sel} z={cam.z} />}
            {hoverShape && hoverRoute && (() => {
              const t = threadOf(hoverRoute.thread);
              return (
                <div className="pg-target" style={{ transform: `translate(${hoverShape.x}px, ${hoverShape.y}px)`, width: hoverShape.w, height: hoverShape.h, borderWidth: 2 / cam.z, ['--c' as string]: t?.color ?? '#d97757', borderRadius: hoverShape.kind === 'ellipse' ? '50%' : hoverShape.radius ?? 0 }}>
                  <span style={{ fontSize: 11 / cam.z, padding: `${2 / cam.z}px ${6 / cam.z}px`, top: -20 / cam.z, borderRadius: 4 / cam.z }}>
                    {hoverShape.name} → {t?.name ?? 'General'}
                  </span>
                </div>
              );
            })()}
          </div>

          {showPins && (
            <div className="pg-pins">
              {pins.map((p) => {
                const s = shapeById.get(p.shapeId);
                if (!s) return null;
                const t = threadOf(p.thread);
                const msg = messages.find((m) => m.pin === p.id);
                return (
                  <button key={p.id} className={'pg-pin' + (p.done ? ' done' : '')} title={msg?.text}
                    style={{ left: (s.x + p.dx) * cam.z + cam.x, top: (s.y + p.dy) * cam.z + cam.y, ['--c' as string]: t?.color ?? '#d97757' }}
                    onClick={() => openThread(p.thread, msg?.id)}>
                    <span>{p.done ? '✓' : p.n}</span>
                  </button>
                );
              })}
            </div>
          )}

          {pop && popShape && (() => {
            const t = threadOf(pop.route.thread);
            return (
              <form className="pg-pop" style={{ left: pop.wx * cam.z + cam.x + 14, top: pop.wy * cam.z + cam.y - 8, ['--c' as string]: t?.color ?? '#d97757' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = new FormData(e.currentTarget).get('note')?.toString().trim();
                  if (v) send(v, { shapeId: pop.shapeId, at: { x: pop.wx, y: pop.wy } });
                  setPop(null);
                }}>
                <div className="pg-pop-to">
                  <i style={{ background: t?.color ?? '#d97757' }} />
                  <b>{t?.name ?? 'General'}</b>
                  <small>{pop.route.how === 'author' ? 'made this' : pop.route.how === 'nearest' ? 'nearest agent' : 'no agents yet'}</small>
                </div>
                <div className="pg-pop-ctx">{ctxLabel(popShape, shapes)}</div>
                <textarea name="note" rows={2} ref={popInput} placeholder={`Ask ${t?.name ?? 'Claude'} to change this…`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
                    if (e.key === 'Escape') setPop(null);
                  }} />
                <div className="pg-pop-foot">
                  <span>Enter to send · auto-routed</span>
                  <button type="submit" aria-label="Send">↑</button>
                </div>
              </form>
            );
          })()}
          {toast && <div className="pg-toast">{toast}</div>}

          <div className="pg-cursors">
            {cursors.map((c) => (
              <div key={c.id} className={'pg-cursor' + (c.kind === 'human' ? ' human' : '') + (c.kind === 'human' && tool === 'comment' ? ' bubble' : '')}
                ref={(el) => { if (el) cursorEls.current.set(c.id, el); else cursorEls.current.delete(c.id); }}
                style={{ ['--c' as string]: c.color }}>
                <svg className="arrow" width="22" height="24" viewBox="0 0 22 24" aria-hidden="true">
                  <path d="M2.5 2.2 L2.5 19.5 L7.4 15.1 L10.7 22.2 L14.1 20.7 L10.9 13.7 L17.6 13.4 Z" />
                </svg>
                {c.kind === 'human' && <svg className="bub" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V11a8 8 0 1 1 8 8H3z" /></svg>}
                <span className="pg-tag">{c.name}{c.kind !== 'human' && c.status && c.status !== 'idle' ? <em> · {c.status}</em> : null}</span>
              </div>
            ))}
          </div>

          <div className="pg-toolbar">
            {TOOLS.map((t) => (
              <button key={t.id} className={tool === t.id ? 'on' : ''} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
                <svg viewBox="0 0 24 24" width="18" height="18"><path d={t.icon} /></svg>
              </button>
            ))}
          </div>
          <div className="pg-hint">Scroll to pan · ⌘/Ctrl + scroll to zoom · Space-drag to pan · Shift+1 fit</div>
        </div>

        <aside className="pg-panel pg-right">
          <div className="pg-h">Cursors <span>{cursors.length}</span></div>
          <div className="pg-actions">
            <button className="primary" onClick={() => engine.spawnAgent(viewCenter())}>+ Agent</button>
            <button onClick={() => { for (let i = 0; i < 5; i++) engine.spawnAgent(viewCenter()); }}>+5</button>
            <button onClick={() => agents.forEach((c) => c.kind === 'agent' && engine.setPaused(c.id, !allPaused))}>{allPaused ? 'Resume' : 'Pause'} all</button>
          </div>
          <div className="pg-row">
            <label>Speed</label>
            <div className="pg-seg">
              {[0.5, 1, 2, 4].map((v) => (
                <button key={v} className={speed === v ? 'on' : ''} onClick={() => { setSpeed(v); engine.setSpeed(v); }}>{v}×</button>
              ))}
            </div>
          </div>
          <div className="pg-cursorlist">
            {cursors.map((c) => (
              <div key={c.id} className="pg-crow">
                <svg width="14" height="15" viewBox="0 0 22 24" style={{ ['--c' as string]: c.color }} className="pg-mini"><path d="M2.5 2.2 L2.5 19.5 L7.4 15.1 L10.7 22.2 L14.1 20.7 L10.9 13.7 L17.6 13.4 Z" /></svg>
                <div className="pg-cname">
                  <b>{c.name}</b>
                  <small>{c.kind === 'human' ? 'you · mouse' : c.kind === 'api' ? 'window.board' : c.status}</small>
                </div>
                {c.kind === 'agent' && (
                  <button className="ghost" title={c.paused ? 'Resume' : 'Pause'} onClick={() => engine.setPaused(c.id, !c.paused)}>{c.paused ? '▶' : '❚❚'}</button>
                )}
                {c.kind !== 'human' && <button className="ghost" title="Remove" onClick={() => engine.removeCursor(c.id)}>✕</button>}
              </div>
            ))}
          </div>
          <div className="pg-foot">
            <button onClick={() => { setSelected(null); engine.clearBoard(); }}>Clear board</button>
            <details>
              <summary>Drive a cursor from code</summary>
              <pre>{`const id = board.addCursor('Claude')
await board.moveCursor(id, 400, 200)
board.press(id, true)
board.addShape({ x: 400, y: 200,
  w: 160, h: 90, fill: '#a259ff' })
board.spawnAgent()`}</pre>
            </details>
          </div>
        </aside>
      </div>
    </div>
  );
}

const ShapeView = memo(function ShapeView({ s, z, owner, editing, onCommit }: { s: Shape; z: number; owner?: CursorMeta; editing: boolean; onCommit: (t: string) => void }) {
  const style: React.CSSProperties = {
    transform: `translate(${s.x}px, ${s.y}px)`,
    width: s.w, height: s.h,
    background: s.fill,
    borderRadius: s.kind === 'ellipse' ? '50%' : s.radius ?? 0,
  };
  if (s.kind === 'text') Object.assign(style, { fontSize: s.fontSize, fontWeight: s.weight ?? 400, color: s.color, height: 'auto', minHeight: s.h });
  return (
    <div className={`pg-shape k-${s.kind}`} style={style}>
      {s.kind === 'frame' && <div className="pg-fname" style={{ fontSize: 12 / z, top: -18 / z }}>{s.name}</div>}
      {s.kind === 'text' && (editing
        ? <textarea autoFocus defaultValue={s.text} onBlur={(e) => onCommit(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); } }}
            style={{ fontSize: s.fontSize, fontWeight: s.weight ?? 400, color: s.color }} />
        : s.text)}
      {owner && (
        <div className="pg-owned" style={{ ['--c' as string]: owner.color, borderWidth: 1.5 / z, borderRadius: style.borderRadius }}>
          <span style={{ fontSize: 10 / z, padding: `${1 / z}px ${5 / z}px`, top: -16 / z, borderRadius: 3 / z }}>{owner.name}</span>
        </div>
      )}
    </div>
  );
});

function Selection({ s, z }: { s: Shape; z: number }) {
  const hs = 8 / z;
  return (
    <div className="pg-sel" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h, borderWidth: 1.5 / z }}>
      {['nw', 'ne', 'sw', 'se'].map((c) => (
        <div key={c} data-handle={c} className="pg-handle"
          style={{ width: hs, height: hs, borderWidth: 1.5 / z, left: c.includes('w') ? -hs / 2 : undefined, right: c.includes('e') ? -hs / 2 : undefined, top: c.includes('n') ? -hs / 2 : undefined, bottom: c.includes('s') ? -hs / 2 : undefined, cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize' }} />
      ))}
      <div className="pg-dims" style={{ fontSize: 10 / z, bottom: -20 / z, padding: `${1 / z}px ${5 / z}px`, borderRadius: 3 / z }}>
        {Math.round(s.w)} × {Math.round(s.h)}
      </div>
    </div>
  );
}

const LayerRow = memo(function LayerRow({ s, active, owner, onPick }: { s: Shape; active: boolean; owner?: string; onPick: (id: string) => void }) {
  return (
    <div className={'pg-layer' + (active ? ' on' : '') + (s.kind === 'frame' ? ' frame' : '')} onClick={() => onPick(s.id)}>
      <span className="ic">{KIND_ICON[s.kind]}</span>
      <span className="nm">{s.kind === 'text' && s.text ? s.text : s.name}</span>
      {owner && <span className="dot" style={{ background: owner }} />}
    </div>
  );
});

