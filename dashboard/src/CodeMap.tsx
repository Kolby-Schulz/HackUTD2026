// Code map (spec section 13): symbols as nodes, call edges as arrows, React Flow.
// Flat layout from storyboard row G: no outline, plain background.
import { useEffect, useMemo } from 'react';
import { Handle, MarkerType, Position, ReactFlow, useReactFlow, useStore, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MapEdge, MapNode } from './model.ts';

const W = 168, H = 48, GX = 72, GY = 26;
const STATE_COLOR: Record<string, string> = { conflict: 'var(--danger)', changed: 'var(--warn)', planned: 'var(--text2)' };
const TAG: Record<string, string> = { conflict: 'Conflict', changed: 'Changed', planned: 'Planned' };

type SymNode = Node<{ n: MapNode; selected: boolean }, 'sym'>;

function SymbolNode({ data }: NodeProps<SymNode>) {
  const { n, selected } = data;
  const border = n.state === 'conflict' ? 'var(--danger)' : n.state === 'changed' ? 'var(--warn)' : n.owner && !n.ghost ? n.owner.color : undefined;
  const glow = n.state === 'conflict' ? '0 0 0 3px rgba(248,81,73,0.2), 0 0 20px rgba(248,81,73,0.33)'
    : n.state === 'changed' ? '0 0 0 3px rgba(210,153,34,0.2), 0 0 20px rgba(210,153,34,0.33)'
    : n.owner && !n.ghost ? `0 0 0 2px ${n.owner.color}22, 0 0 12px ${n.owner.color}33` : 'none';
  return (
    <div className={'node' + (n.ghost ? ' ghost' : '') + (selected ? ' selected' : '')} style={{ borderColor: border, borderWidth: border ? 2 : undefined, boxShadow: glow }} title={n.id}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
      {TAG[n.state] && <span className="tag" style={{ background: STATE_COLOR[n.state] }}>{TAG[n.state]}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="mono ellipsis" style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{n.name}</span>
        {n.version > 1 && <span className="mono" style={{ fontSize: 11, color: 'var(--warn)' }}>v{n.version}</span>}
        {n.owner && <span className="avatar owner" style={{ background: n.owner.color }}>{n.owner.letter}</span>}
      </div>
      <div className="mono muted ellipsis" style={{ fontSize: 11 }}>{n.file}</div>
    </div>
  );
}

const nodeTypes = { sym: SymbolNode };

export function CodeMap({ nodes, edges, selected, onSelect }: { nodes: MapNode[]; edges: MapEdge[]; selected?: string; onSelect: (id: string) => void }) {
  // The dashboard re-renders every second (T+ clock), and `nodes` is rebuilt each time. React Flow
  // treats a new node object as unmeasured and hides it until a ResizeObserver re-measures it,
  // which browsers pause in background tabs, so the map could come back blank. So: only rebuild
  // the React Flow arrays when what they show changes, and give every node its fixed size up front.
  const nodeSig = JSON.stringify([nodes, selected]);
  const edgeSig = JSON.stringify(edges);
  const rfNodes = useMemo<SymNode[]>(() => nodes.map((n) => ({
    id: n.id, type: 'sym', position: { x: n.col * (W + GX), y: n.row * (H + GY) },
    width: W, height: H, measured: { width: W, height: H },
    data: { n, selected: n.id === selected }, draggable: false, connectable: false,
  })), [nodeSig]);
  const rfEdges = useMemo<Edge[]>(() => edges.map((e) => {
    const color = e.hot ? '#f85149' : '#656c76';
    return { id: e.id, source: e.source, target: e.target, type: 'smoothstep', animated: e.hot,
      style: { stroke: color, strokeWidth: e.hot ? 2 : 1.25 }, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 } };
  }), [edgeSig]);
  // re-fit when the set of symbols changes, not on every claim or color change
  const shape = nodes.map((n) => n.id).join('|');

  return (
    <div className="map">
      {nodes.length === 0 ? (
        <div className="map-empty">No symbols yet. Run the mapper (npm run mapper) to load demo-repo's code map.</div>
      ) : (
        <ReactFlow key={shape} nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView fitViewOptions={FIT}
          minZoom={0.3} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}
          onNodeClick={(_e, n) => onSelect(n.id)} aria-label="Code map">
          <FitOnResize />
        </ReactFlow>
      )}
    </div>
  );
}

const FIT = { padding: 0.12, maxZoom: 1.1 };

/** The map's height follows the window, so re-fit whenever the panel changes size, and again
 *  when the browser tab comes back into view (sizes read while hidden can be zero). */
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
