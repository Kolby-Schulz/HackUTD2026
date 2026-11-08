// Temporary playground (#/playground): a Figma / Claude-Design style dotted board where many
// cursors (you, scripted agents, or anything calling window.board) design at the same time.
// Proof of concept only; not wired to SpacetimeDB.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEngine, uid, COLORS, type CursorMeta, type Kind, type Shape } from './engine.ts';
import './playground.css';

type Tool = 'select' | 'frame' | 'rect' | 'ellipse' | 'text' | 'hand';
type Cam = { x: number; y: number; z: number };
type Drag =
  | { mode: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { mode: 'move'; px: number; py: number; orig: Map<string, { x: number; y: number }> }
  | { mode: 'resize'; id: string; corner: string; orig: Shape }
  | { mode: 'create'; id: string; ox: number; oy: number };

const HUMAN = { id: 'you', name: 'You', color: '#0d99ff' };
const DOT_GAP = 24;

const TOOLS: { id: Tool; key: string; label: string; icon: string }[] = [
  { id: 'select', key: 'V', label: 'Move', icon: 'M5 3l14 8-6.5 1.5L10 19z' },
  { id: 'frame', key: 'F', label: 'Frame', icon: 'M8 3v18M16 3v18M3 8h18M3 16h18' },
  { id: 'rect', key: 'R', label: 'Rectangle', icon: 'M4 5h16v14H4z' },
  { id: 'ellipse', key: 'O', label: 'Ellipse', icon: 'M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16z' },
  { id: 'text', key: 'T', label: 'Text', icon: 'M5 5h14M12 5v14M9 19h6' },
  { id: 'hand', key: 'H', label: 'Hand', icon: 'M8 13V6a1.5 1.5 0 0 1 3 0v5m0-6a1.5 1.5 0 0 1 3 0v6m0-5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.5L8 15' },
];
const KIND_ICON: Record<Kind, string> = { frame: '#', rect: '▢', ellipse: '◯', text: 'T' };

const norm = (x1: number, y1: number, x2: number, y2: number) => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
const inside = (a: Shape, b: Shape) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

export function Playground() {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [cursors, setCursors] = useState<CursorMeta[]>([]);
  const [cam, setCam] = useState<Cam>({ x: 60, y: 90, z: 0.55 });
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [panning, setPanning] = useState(false);

  const engine = useMemo(() => createEngine({ setShapes, setCursors }), []);
  const camRef = useRef(cam); camRef.current = cam;
  const shapesRef = useRef(shapes); shapesRef.current = shapes;
  const toolRef = useRef(tool); toolRef.current = tool;
  const viewRef = useRef<HTMLDivElement>(null);
  const cursorEls = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);

  // boot: you + three agents. StrictMode double-mount is handled by reset() in cleanup.
  useEffect(() => {
    engine.addCursor({ ...HUMAN, kind: 'human', status: 'here' });
    for (let i = 0; i < 3; i++) engine.spawnAgent();
    return () => engine.reset();
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
      if (e.key === 'Escape') { setSelected(null); setTool('select'); return; }
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

  const hitTest = (x: number, y: number) => {
    const ss = shapesRef.current;
    for (let i = ss.length - 1; i >= 0; i--) {
      const s = ss[i];
      if (x >= s.x && y >= s.y && x <= s.x + s.w && y <= s.y + s.h) return s;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('textarea')) return;
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
        <button className="pg-zoom" onClick={fit} title="Zoom to fit (Shift+1)">{Math.round(cam.z * 100)}%</button>
      </header>

      <div className="pg-body">
        <aside className="pg-panel pg-left">
          <div className="pg-h">Layers <span>{shapes.length}</span></div>
          <div className="pg-layers">
            {shapes.slice().reverse().slice(0, 400).map((s) => (
              <LayerRow key={s.id} s={s} active={s.id === selected} owner={s.owner ? ownerOf.get(s.owner)?.color : undefined} onPick={setSelected} />
            ))}
            {!shapes.length && <div className="pg-empty">Agents are warming up…</div>}
          </div>
        </aside>

        <div
          ref={viewRef}
          className={'pg-view' + (panning || tool === 'hand' ? ' panning' : '')}
          style={{ backgroundSize: `${dot}px ${dot}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { engine.human.visible = false; }}
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
            {sel && !editing && <Selection s={sel} z={cam.z} />}
          </div>

          <div className="pg-cursors">
            {cursors.map((c) => (
              <div key={c.id} className={'pg-cursor' + (c.kind === 'human' ? ' human' : '')}
                ref={(el) => { if (el) cursorEls.current.set(c.id, el); else cursorEls.current.delete(c.id); }}
                style={{ ['--c' as string]: c.color }}>
                <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true">
                  <path d="M2.5 2.2 L2.5 19.5 L7.4 15.1 L10.7 22.2 L14.1 20.7 L10.9 13.7 L17.6 13.4 Z" />
                </svg>
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

