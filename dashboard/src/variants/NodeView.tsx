// Renders one node (code variant, mix or draft) at a design width inside a zoomable frame.
// Slots are click targets: clicking a slot takes it from this pane. Nothing is drawn over the
// design itself except a thin outline; the pane shows what is under the pointer in its header row.
import { Component, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { resolveAll } from './model.ts';
import type { Graph } from './model.ts';
import type { Screen } from './registry.ts';
import type { NodeId, SlotId } from './types.ts';

class Boundary extends Component<{ label: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  render() {
    if (this.state.error) return <div className="vx-broken">{this.props.label} crashed: {this.state.error}</div>;
    return this.props.children;
  }
}

/** fit = fit width, page = fit the whole page in view, number = exact scale (pane scrolls). */
export type Zoom = 'fit' | 'page' | number;

/**
 * Lays children out at `width` px. `fit` scales down to the frame's available width (never up);
 * a number renders at exactly that scale and lets the pane scroll in both directions.
 */
export function Frame({ width, zoom, onScale, children }: { width: number; zoom: Zoom; onScale?: (s: number) => void; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, h: 0 });
  const scaleCb = useRef(onScale);
  scaleCb.current = onScale;
  useLayoutEffect(() => {
    const o = outer.current!;
    const i = inner.current!;
    const measure = () => {
      // Measure the scrolling area, not the direct parent: overlay mode stacks frames in a shrink-wrapped box.
      const par = (o.closest('.vx-canvas-area') as HTMLElement | null) ?? o.parentElement;
      const cs = par ? getComputedStyle(par) : null;
      const availW = par && cs ? par.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : width;
      const availH = par && cs ? par.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) : Infinity;
      const scale =
        zoom === 'fit' ? Math.min(1, availW / width) || 1
        : zoom === 'page' ? Math.min(1, availW / width, availH / Math.max(1, i.offsetHeight)) || 1
        : zoom;
      const h = i.offsetHeight * scale;
      setBox((b) => (b.scale === scale && b.h === h ? b : { scale, h }));
      scaleCb.current?.(scale);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(i);
    const area = (o.closest('.vx-canvas-area') as HTMLElement | null) ?? o.parentElement;
    if (area) ro.observe(area);
    measure();
    return () => ro.disconnect();
  }, [width, zoom]);
  return (
    <div ref={outer} className="vx-frame" style={{ height: box.h, width: width * box.scale }}>
      <div ref={inner} className="vx-canvas" style={{ width, transform: `scale(${box.scale})`, '--vx-inv': 1 / box.scale } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

export interface NodeViewProps {
  screen: Screen;
  graph: Graph;
  nodeId: NodeId;
  comp: (variant: NodeId, slot: SlotId) => ComponentType | undefined;
  isolate: SlotId | null;
  color: string;
  /** Slots the user explicitly took from this pane (defaults are not outlined). */
  picked: ReadonlySet<SlotId>;
  onTake?: (slot: SlotId) => void;
  onHover?: (slot: SlotId | null) => void;
}

export function NodeView(p: NodeViewProps) {
  const pending = p.graph.nodes.get(p.nodeId)?.pending;
  if (pending) return <div className="vx-absent vx-pending" role="status">{pending}</div>;
  const { sources } = resolveAll(p.graph, p.nodeId);
  const box = (slot: SlotId) => {
    const src = sources[slot];
    const C = src ? p.comp(src, slot) : undefined;
    const label = p.screen.slots[slot] ?? slot;
    const picked = p.picked.has(slot);
    const interactive = !!p.onTake;
    return (
      <div
        key={slot}
        className={`vx-slot${picked ? ' picked' : ''}${interactive ? ' takeable' : ''}`}
        data-slot={slot}
        style={{ '--c': p.color } as CSSProperties}
        onMouseEnter={() => p.onHover?.(slot)}
        onMouseLeave={() => p.onHover?.(null)}
        onClickCapture={interactive ? (e) => { e.preventDefault(); e.stopPropagation(); p.onTake!(slot); } : undefined}
      >
        {C ? <Boundary key={src} label={label}><C /></Boundary> : <div className="vx-missing">Nothing fills “{label}”</div>}
      </div>
    );
  };
  if (p.isolate) return <div className="vx-isolated">{box(p.isolate)}</div>;
  const Layout = p.screen.Layout;
  return (
    <Boundary label="Layout">
      <Layout slots={Object.fromEntries(p.screen.slotIds.map((s) => [s, box(s)]))} />
    </Boundary>
  );
}
