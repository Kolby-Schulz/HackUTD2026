// Code map (spec section 13): symbols as nodes, call edges as arrows, React Flow.
// Agents show on the nodes they hold or plan (colored outline + letter badges, dashed when only
// planned). The coordinator shows as a named cursor on the symbol it is deciding.
// While agents work, the map shows only the functions they touch (plus faded callers); links that
// pass through collapsed functions are dashed with a "⋯". "Expand all" brings back every function,
// animated, with the agents' section highlighted and the function you were looking at held still.
// Clicking a function opens a details widget next to it (Overview / History).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { getViewportForBounds, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Edge, type Node, type NodeProps, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MapEdge, MapNode, NodeState } from './model.ts';
import { H, inPlay, langOf, layoutMap, W, type MapItem } from './mapLayout.ts';

const TAG: Record<string, [string, string]> = { conflict: ['Conflict', 'var(--danger)'], changed: ['Changed', 'var(--warn)'] };

export interface CoordMark { symbolId: string; conflict: string; resolving: boolean }

type SymNode = Node<{ n: MapNode; selected: boolean; faded: boolean; dim: boolean; spot: boolean; coord?: CoordMark }, 'sym'>;

function SymbolNode({ data }: NodeProps<SymNode>) {
  const { n, selected, faded, dim, spot, coord } = data;
  const holder = !n.ghost && n.owner && n.state !== 'conflict' && n.state !== 'changed' ? n.owner.color : undefined;
  const cls = ['node', n.ghost && 'ghost', selected && 'selected', n.state === 'conflict' && 'conflict', n.state === 'changed' && 'changed',
    (n.fading || faded) && 'fading', dim && 'dim', spot && 'spot'].filter(Boolean).join(' ');
  const lang = langOf(n.file);
  return (
    <div className={cls} style={holder ? { borderColor: holder, boxShadow: `0 0 0 4px color-mix(in srgb, ${holder} 14%, transparent)` } : undefined} title={faded ? `${n.id} (calls a function an agent is working on)` : n.id}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
      {TAG[n.state] && <span className="ntag" style={{ background: TAG[n.state][1] }}>{TAG[n.state][0]}{coord?.symbolId === n.id ? ` #${coord.conflict}` : ''}</span>}
      <div className="nn">
        {lang && <span className="lang" style={{ background: lang.bg, color: lang.fg }} title={lang.name} aria-label={lang.name}>{lang.label}</span>}
        <span className="ellipsis grow">{n.name}</span>
        {n.version > 1 && <span style={{ fontSize: 10.5, color: 'var(--warn)' }}>v{n.version}</span>}
        {n.owners.map((p) => <span key={p.id} className="sq own" style={{ background: p.color }} title={p.name}>{p.letter}</span>)}
      </div>
      <div className="nf ellipsis">{n.ghost ? `planned by ${n.owners.map((p) => p.letter).join(' and ') || '?'}` : n.file}</div>
      {coord?.symbolId === n.id && (
        <div className="cursor" aria-label={`Coordinator is ${coord.resolving ? 'deciding' : 'queued on'} conflict #${coord.conflict}`}>
          <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><path d="M1.5 1.5l14 7.2-6 1.6-2.6 6.2z" fill="#64748b" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" /></svg>
          <div className="lbl">Coordinator <span>· {coord.resolving ? 'deciding' : 'queued'} #{coord.conflict}</span></div>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { sym: SymbolNode };

interface Props {
  nodes: MapNode[];
  edges: MapEdge[];
  selected?: string;
  coord?: CoordMark;
  onSelect: (id: string | undefined) => void;
  /** The details widget for the selected node; positioned next to it on screen. */
  widget?: ReactNode;
  /** Bump to glide the camera to the selected node (the Savings numbers use it to show a conflict). */
  reveal?: number;
}

export function CodeMap(props: Props) {
  return <ReactFlowProvider><CodeMapView {...props} /></ReactFlowProvider>;
}

/** One box as drawn this frame: where it is and how visible, mid-animation or settled. */
interface Drawn { it: MapItem; x: number; y: number; o: number }
interface Pin { id: string; sx: number; sy: number; zoom: number }

const MOVE_MS = 520;
const SPOT_MS = 1700;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function CodeMapView({ nodes, edges, selected, coord, onSelect, widget, reveal }: Props) {
  const rf = useReactFlow();
  // Expanded = the user asked for the whole map while agents work. Reset once work stops, so the
  // next burst of activity is focused again.
  const [expanded, setExpanded] = useState(false);
  const anyActive = nodes.some((n) => n.active);
  useEffect(() => { if (!anyActive) setExpanded(false); }, [anyActive]);
  // The camera follows agent activity until the user pans or zooms; then it stays put and
  // offers a button to follow again.
  const [follow, setFollow] = useState(true);
  const moveFrom = useRef<Viewport | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  // set by expand / collapse: hold this function still on screen while the layout changes
  const pin = useRef<Pin | null>(null);
  const hold = useRef(false);
  // the agents' functions pulse after each expand / collapse; a counter so every click restarts it
  const [spot, setSpot] = useState(false);
  const [spotRun, setSpotRun] = useState(0);

  // The dashboard re-renders every second (T+ clock), and `nodes` is rebuilt each time. React Flow
  // treats a new node object as unmeasured and hides it until a ResizeObserver re-measures it,
  // which browsers pause in background tabs, so the map could come back blank. So: only rebuild
  // the layout when what it shows changes, and give every node its fixed size up front.
  const nodeSig = JSON.stringify([nodes, edges, expanded]);
  const layout = useMemo(() => layoutMap(nodes, edges, expanded), [nodeSig]);

  // Animate between layouts: boxes glide from where they are drawn now to their new place, new
  // ones fade in, departing ones fade out where they stand.
  const [drawn, setDrawn] = useState<Drawn[]>(() => layout.items.map((it) => ({ it, x: it.x, y: it.y, o: 1 })));
  const now = useRef(new Map<string, Drawn>(drawn.map((d) => [d.it.id, d])));
  const run = useRef(0);
  useLayoutEffect(() => {
    const from = now.current;
    const to = new Map(layout.items.map((it) => [it.id, it]));
    const leaving = [...from.values()].filter((d) => !to.has(d.it.id));
    const p = pin.current;
    pin.current = null;
    const at = (t: number): Drawn[] => {
      const k = ease(t);
      return [
        ...layout.items.map((it) => {
          const f = from.get(it.id);
          return f
            ? { it, x: f.x + (it.x - f.x) * k, y: f.y + (it.y - f.y) * k, o: f.o + (1 - f.o) * k }
            : { it, x: it.x, y: it.y, o: k };
        }),
        ...leaving.map((d) => ({ ...d, o: d.o * (1 - k) })),
      ];
    };
    const show = (t: number) => {
      const list = at(t);
      now.current = new Map(list.filter((d) => t < 1 || to.has(d.it.id)).map((d) => [d.it.id, d]));
      setDrawn(t < 1 ? list : list.filter((d) => to.has(d.it.id)));
      // keep the pinned function on its screen spot as everything moves around it
      const pd = p && now.current.get(p.id);
      if (p && pd) void rf.setViewport({ x: p.sx - pd.x * p.zoom, y: p.sy - pd.y * p.zoom, zoom: p.zoom }, { duration: 0 });
    };
    const changed = leaving.length || layout.items.some((it) => { const f = from.get(it.id); return !f || f.x !== it.x || f.y !== it.y || f.o !== 1; });
    if (!changed) { setDrawn(layout.items.map((it) => ({ it, x: it.x, y: it.y, o: 1 }))); return; }
    const id = ++run.current;
    const start = performance.now();
    show(0);
    const step = () => {
      if (run.current !== id) return;
      const t = Math.min(1, (performance.now() - start) / MOVE_MS);
      show(t);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // requestAnimationFrame pauses while the page is not painting: land on the end state anyway
    setTimeout(() => { if (run.current === id) { run.current++; show(1); } }, MOVE_MS + 120);
  }, [layout]);

  const toggle = (next: boolean) => {
    const v = rf.getViewport(), el = box.current;
    if (el) {
      const cx = (el.clientWidth / 2 - v.x) / v.zoom, cy = (el.clientHeight / 2 - v.y) / v.zoom;
      // only functions drawn in both layouts (the ones in play) can hold the view
      const near = [...now.current.values()].filter((d) => inPlay(d.it.n))
        .sort((a, b) => Math.hypot(a.x + W / 2 - cx, a.y + H / 2 - cy) - Math.hypot(b.x + W / 2 - cx, b.y + H / 2 - cy))[0];
      if (near) { pin.current = { id: near.it.id, sx: near.x * v.zoom + v.x, sy: near.y * v.zoom + v.y, zoom: v.zoom }; hold.current = true; }
    }
    setExpanded(next);
    setSpot(true);
    setSpotRun((r) => r + 1);
  };
  useEffect(() => {
    if (!spotRun) return;
    const t = setTimeout(() => setSpot(false), SPOT_MS);
    return () => clearTimeout(t);
  }, [spotRun]);

  const rfNodes = useMemo<SymNode[]>(() => drawn.map((d) => ({
    id: d.it.id, type: 'sym', position: { x: d.x, y: d.y }, width: d.it.w, height: d.it.h, measured: { width: d.it.w, height: d.it.h },
    style: d.o < 1 ? { opacity: d.o, pointerEvents: d.o < 0.5 ? 'none' : undefined } : undefined,
    data: { n: d.it.n, selected: d.it.id === selected, faded: d.it.faded, dim: d.it.dim, spot: spot && inPlay(d.it.n), coord },
    draggable: false, connectable: false,
  })), [drawn, selected, spot, JSON.stringify(coord)]);
  const rfEdges = useMemo<Edge[]>(() => {
    const op = new Map(drawn.map((d) => [d.it.id, d.o]));
    return layout.edges.filter((e) => op.has(e.source) && op.has(e.target)).map((e) => {
      const o = Math.min(op.get(e.source)!, op.get(e.target)!);
      const color = e.hot ? 'var(--danger)' : e.via ? 'var(--text3)' : 'var(--faint)';
      return { id: e.id, source: e.source, target: e.target, type: 'smoothstep', animated: e.hot,
        style: { stroke: color, strokeWidth: e.hot ? 2 : 1.4, opacity: o, ...(e.via ? { strokeDasharray: '5 4' } : {}) },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        ...(e.via ? { label: '⋯', labelShowBg: true, labelBgPadding: [6, 1] as [number, number], labelBgBorderRadius: 8,
          labelStyle: { fill: 'var(--text2)', fontSize: 14, fontWeight: 800, letterSpacing: '0.05em' }, labelBgStyle: { fill: 'var(--chrome)', stroke: 'var(--border)', opacity: o } } : {}) };
    });
  }, [drawn, layout]);
  const sel = layout.items.find((it) => it.id === selected);
  // Reveal: glide to the selected function and stop following activity ("Follow activity" resumes).
  // If it is folded away in the focused layout, expand first; the next layout brings it here again.
  const revealed = useRef(0);
  useEffect(() => {
    if (!reveal || revealed.current === reveal || !selected) return;
    if (!sel) { if (!expanded) setExpanded(true); return; }
    revealed.current = reveal;
    setFollow(false);
    // a map that has just opened measures its size a frame late; centre after that
    // (no cleanup: a re-render after this must not cancel it, and the reveal is already marked done)
    setTimeout(() => void rf.setCenter(sel.x + sel.w / 2, sel.y + sel.h / 2, { zoom: Math.max(rf.getZoom(), 1), duration: 500 }), 120);
  }, [reveal, selected, sel, expanded, rf]);
  const all = boundsOf(layout.items);
  const focus = boundsOf(focusItems(layout.items, coord));

  return (
    <div className="map" ref={box}>
      {nodes.length === 0 ? (
        <div className="map-empty"><p style={{ maxWidth: 340, margin: 0 }}>No symbols yet. Run the mapper (npm run mapper) to load the code map.</p></div>
      ) : (
        <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
          minZoom={0.3} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}
          onMoveStart={(_e, v) => { moveFrom.current = v; }}
          onMoveEnd={(e, v) => { if (e && moved(moveFrom.current, v)) setFollow(false); }}
          onNodeClick={(_e, n) => onSelect(n.id === selected ? undefined : n.id)}
          onPaneClick={() => onSelect(undefined)} aria-label="Code map">
          <Camera all={all} focus={focus} follow={follow} hold={hold} />
          {anyActive && (
            <div className="map-scope" role="group" aria-label="Code map scope">
              {layout.focused
                ? <><span>Agent work · {layout.shown} of {nodes.length} functions</span>
                    <button type="button" onClick={() => toggle(true)} title="Show every function, with the agents' work highlighted">
                      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6l3-3 3 3M5 10l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span className="ellipsis">Expand all ({nodes.length - layout.shown} collapsed)</span>
                    </button></>
                : <><span>All {nodes.length} functions</span>
                    <button type="button" onClick={() => toggle(false)} title="Collapse back to the functions agents are working on">
                      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l3 3 3-3M5 13l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span className="ellipsis">Collapse to agent work</span>
                    </button></>}
            </div>
          )}
          {!follow && (
            <button type="button" className="map-follow" onClick={() => setFollow(true)} title="Zoom back to where the agents are working">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.5" fill="currentColor" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              Follow activity
            </button>
          )}
          {sel && widget && <Anchored x={sel.x} y={sel.y}>{widget}</Anchored>}
        </ReactFlow>
      )}
    </div>
  );
}

const FIT = { padding: 0.14, maxZoom: 1.1 };
/** Below this zoom node text gets hard to read, so the camera never frames the map smaller. */
const READABLE = 0.8;
const GLIDE_MS = 400;
const RANK: Record<NodeState, number> = { conflict: 0, changed: 1, claimed: 2, planned: 3, idle: 4 };

interface Box { x: number; y: number; width: number; height: number }

function boundsOf(items: MapItem[]): Box | undefined {
  if (!items.length) return undefined;
  const x = Math.min(...items.map((i) => i.x)), y = Math.min(...items.map((i) => i.y));
  return { x, y, width: Math.max(...items.map((i) => i.x + i.w)) - x, height: Math.max(...items.map((i) => i.y + i.h)) - y };
}

/** Where to look when the map does not fit at a readable size: the symbol the coordinator is
 *  deciding, else the most urgent worked-on symbols (conflicts, then changes, claims, plans).
 *  Nothing (frame the top-left corner) when no agent is working. */
function focusItems(items: MapItem[], coord?: CoordMark): MapItem[] {
  const syms = items.filter((i) => i.n.active);
  const c = coord && syms.find((i) => i.id === coord.symbolId);
  if (c) return [c];
  if (!syms.length) return [];
  const best = Math.min(...syms.map((i) => RANK[i.n.state]));
  return syms.filter((i) => RANK[i.n.state] === best);
}

/** Slides a viewport so it does not show empty canvas past the map's edges (when the map is bigger
 *  than the pane on that axis), e.g. a focus on the top row stays pinned to the top. */
function inside(v: Viewport, b: Box, w: number, h: number): Viewport {
  const pad = 24;
  const clamp = (t: number, start: number, size: number, view: number) =>
    size * v.zoom + 2 * pad <= view ? t : Math.min(pad - start * v.zoom, Math.max(view - pad - (start + size) * v.zoom, t));
  return { zoom: v.zoom, x: clamp(v.x, b.x, b.width, w), y: clamp(v.y, b.y, b.height, h) };
}

const moved = (a: Viewport | undefined, b: Viewport) =>
  !a || Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2 || Math.abs(a.zoom - b.zoom) > 0.01;

/** Frames the map: all of it when it fits at a readable zoom, otherwise the focus at that zoom
 *  (or the top-left corner when nothing is in focus). While following, it re-frames when the
 *  boxes on the map change, the pane is resized, or the browser tab comes back into view (sizes
 *  read while hidden can be zero). Right after expand / collapse it holds still. */
function Camera({ all, focus, follow, hold }: { all?: Box; focus?: Box; follow: boolean; hold: RefObject<boolean> }) {
  const { setViewport } = useReactFlow();
  const w = useStore((s) => s.width);
  const h = useStore((s) => s.height);
  const framed = useRef(false);
  const seq = useRef(0);
  const following = useRef(follow);
  following.current = follow;
  const key = JSON.stringify([all, focus]);
  const frame = useCallback((animate: boolean) => {
    if (!w || !h || !all || document.hidden) return;
    const whole = getViewportForBounds(all, w, h, 0.1, FIT.maxZoom, FIT.padding);
    const target = focus ?? { x: all.x, y: all.y, width: 1, height: 1 };
    const v = whole.zoom >= READABLE ? whole : inside(getViewportForBounds(target, w, h, READABLE, focus ? 1 : READABLE, FIT.padding), all, w, h);
    const glide = animate && framed.current;
    const n = ++seq.current;
    void setViewport(v, glide ? { duration: GLIDE_MS, interpolate: 'linear' } : { duration: 0 });
    framed.current = true;
    // The glide runs on requestAnimationFrame, which some browsers pause while the page is not
    // painting. If it has not landed by now, snap there, unless the user took over or a newer
    // frame started meanwhile.
    if (glide) setTimeout(() => { if (seq.current === n && following.current) void setViewport(v, { duration: 0 }); }, GLIDE_MS + 150);
  }, [key, w, h, setViewport]);
  // boxes arriving or leaving, or the user asking to follow again: glide there
  useEffect(() => {
    if (hold.current) { hold.current = false; return; }
    if (follow) frame(true);
  }, [key, follow]);
  // the pane resized: jump, so the map does not lag behind the sash
  useEffect(() => { if (follow) frame(false); }, [w, h]);
  useEffect(() => {
    // a timer, not requestAnimationFrame: rAF stays paused until the page paints again
    const onShow = () => { if (!document.hidden && follow) setTimeout(() => frame(false), 50); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [frame, follow]);
  return null;
}

const WIDGET_W = 320;

/** Places the widget beside a node in screen space, so it stays readable at any zoom. It opens
 *  to the right of the node, or to the left when there is no room, and stays inside the editor. */
function Anchored({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const left = x * zoom + tx, top = y * zoom + ty, right = left + W * zoom;
  const fitsRight = right + 12 + WIDGET_W <= width;
  const fitsLeft = left - 12 - WIDGET_W >= 8;
  // no room on either side: drop it below the node instead of covering it
  const below = !fitsRight && !fitsLeft;
  const sx = fitsRight ? right + 12 : fitsLeft ? left - 12 - WIDGET_W : Math.max(8, Math.min(left, width - WIDGET_W - 8));
  const sy = below ? Math.max(8, Math.min(top + H * zoom + 12, height - 300)) : Math.max(8, Math.min(top - 8, height - 340));
  // never taller than the room left under it, so a short map scrolls the widget instead of cutting it off
  return <div className="widget" style={{ left: sx, top: sy, maxHeight: Math.max(120, height - sy - 8) }} onClick={(e) => e.stopPropagation()}>{children}</div>;
}
