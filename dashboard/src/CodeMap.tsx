// Code map (spec section 13): symbols as nodes, call edges as arrows, React Flow.
// Agents show on the nodes they hold or plan (colored outline + letter badges, dashed when only
// planned). The coordinator shows as a named cursor on the symbol it is deciding.
// Clicking a node opens a details widget next to it (Overview / History).
import { useEffect, useMemo, type ReactNode } from 'react';
import { Handle, MarkerType, Position, ReactFlow, useReactFlow, useStore, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MapEdge, MapNode } from './model.ts';

const W = 172, H = 48, GX = 76, GY = 30;
const TAG: Record<string, [string, string]> = { conflict: ['Conflict', 'var(--danger)'], changed: ['Changed', 'var(--warn)'] };

export interface CoordMark { symbolId: string; conflict: string; resolving: boolean }

type SymNode = Node<{ n: MapNode; selected: boolean; coord?: CoordMark }, 'sym'>;

function SymbolNode({ data }: NodeProps<SymNode>) {
  const { n, selected, coord } = data;
  const holder = !n.ghost && n.owner && n.state !== 'conflict' && n.state !== 'changed' ? n.owner.color : undefined;
  const cls = ['node', n.ghost && 'ghost', selected && 'selected', n.state === 'conflict' && 'conflict', n.state === 'changed' && 'changed'].filter(Boolean).join(' ');
  return (
    <div className={cls} style={holder ? { borderColor: holder, boxShadow: `0 0 0 4px color-mix(in srgb, ${holder} 14%, transparent)` } : undefined} title={n.id}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
      {TAG[n.state] && <span className="ntag" style={{ background: TAG[n.state][1] }}>{TAG[n.state][0]}{coord?.symbolId === n.id ? ` #${coord.conflict}` : ''}</span>}
      <div className="nn">
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
}

export function CodeMap({ nodes, edges, selected, coord, onSelect, widget }: Props) {
  // The dashboard re-renders every second (T+ clock), and `nodes` is rebuilt each time. React Flow
  // treats a new node object as unmeasured and hides it until a ResizeObserver re-measures it,
  // which browsers pause in background tabs, so the map could come back blank. So: only rebuild
  // the React Flow arrays when what they show changes, and give every node its fixed size up front.
  const nodeSig = JSON.stringify([nodes, selected, coord]);
  const edgeSig = JSON.stringify(edges);
  const rfNodes = useMemo<SymNode[]>(() => nodes.map((n) => ({
    id: n.id, type: 'sym', position: { x: n.col * (W + GX), y: n.row * (H + GY) },
    width: W, height: H, measured: { width: W, height: H },
    data: { n, selected: n.id === selected, coord }, draggable: false, connectable: false,
  })), [nodeSig]);
  const rfEdges = useMemo<Edge[]>(() => edges.map((e) => {
    const color = e.hot ? 'var(--danger)' : 'var(--faint)';
    return { id: e.id, source: e.source, target: e.target, type: 'smoothstep', animated: e.hot,
      style: { stroke: color, strokeWidth: e.hot ? 2 : 1.4 }, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 } };
  }), [edgeSig]);
  // re-fit when the set of symbols changes, not on every claim or color change
  const shape = nodes.map((n) => n.id).join('|');
  const sel = nodes.find((n) => n.id === selected);

  return (
    <div className="map">
      {nodes.length === 0 ? (
        <div className="map-empty">No symbols yet. Run the mapper (npm run mapper) to load demo-repo's code map.</div>
      ) : (
        <ReactFlow key={shape} nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView fitViewOptions={FIT}
          minZoom={0.3} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}
          onNodeClick={(_e, n) => onSelect(n.id === selected ? undefined : n.id)} onPaneClick={() => onSelect(undefined)} aria-label="Code map">
          <FitOnResize />
          {sel && widget && <Anchored x={sel.col * (W + GX)} y={sel.row * (H + GY)}>{widget}</Anchored>}
        </ReactFlow>
      )}
    </div>
  );
}

const FIT = { padding: 0.14, maxZoom: 1.1 };
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
  return <div className="widget" style={{ left: sx, top: sy }} onClick={(e) => e.stopPropagation()}>{children}</div>;
}

/** The map's size follows its pane, so re-fit whenever the pane is resized, and again when the
 *  browser tab comes back into view (sizes read while hidden can be zero). */
function FitOnResize() {
  const { fitView } = useReactFlow();
  const w = useStore((s) => s.width);
  const h = useStore((s) => s.height);
  useEffect(() => {
    if (w && h && !document.hidden) void fitView(FIT);
  }, [w, h, fitView]);
  useEffect(() => {
    // a timer, not requestAnimationFrame: rAF stays paused until the page paints again
    const onShow = () => { if (!document.hidden) setTimeout(() => void fitView(FIT), 50); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [fitView]);
  return null;
}
