// The two side panels. Each wraps its content in an ErrorBoundary so a broken panel shows a notice
// instead of taking the page down.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { BoardKit } from '../../core/commands';
import { flatten } from '../../core/tree';
import { useStoreValue } from '../../core/react';
import { prefs } from '../../core/prefs';
import { PANEL_MAX, PANEL_MIN, layoutStore, panelViews, resetPanelWidth, setPanel, setPanelWidth, setViewport } from '../../actions/panels';
import type { PanelView, Side } from '../../actions/panels';
import { ErrorBoundary } from './ErrorBoundary';
import '../../styles/panels.css';
import '../../styles/shell.css';

export type LeftTab = 'chat' | 'layers';

function LayerCount({ board }: { board: BoardKit }) {
  const n = useStoreValue(board.doc.subscribe, useCallback(() => flatten(board.doc.getState()).length, [board]));
  return <span>{n}</span>;
}

/** Open state, overlay flag and width for one side, from prefs, the window width and the narrow overrides. */
function usePanelView(side: Side): PanelView {
  const p = useStoreValue(prefs.subscribe, prefs.get);
  const l = useStoreValue(layoutStore.subscribe, layoutStore.get);
  useEffect(() => {
    const on = () => setViewport(window.innerWidth);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return useMemo(() => panelViews({ prefs: p, vw: l.vw, narrowOpen: l.narrowOpen })[side], [p, l, side]);
}

/** 6px drag handle on the inner edge: pointer drag, arrow keys (16px), double-click resets. */
function Handle({ side, width }: { side: Side; width: number }) {
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const edge = el.parentElement!.getBoundingClientRect();
    const move = (m: globalThis.PointerEvent) => setPanelWidth(side, side === 'left' ? m.clientX - edge.left : edge.right - m.clientX);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    e.preventDefault();
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault(); e.stopPropagation();
    setPanelWidth(side, width + (e.key === grow ? 16 : -16));
  };
  return (
    <div className="pg-resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${side} panel`} tabIndex={0}
      aria-valuenow={width} aria-valuemin={PANEL_MIN} aria-valuemax={PANEL_MAX}
      onPointerDown={down} onKeyDown={key} onDoubleClick={() => resetPanelWidth(side)} />
  );
}

function Shell({ side, className, v, children }: { side: Side; className: string; v: PanelView; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const label = side === 'left' ? 'left panel' : 'right panel';
  const shortcut = side === 'left' ? '⌘\\ / Ctrl+\\' : '⌘. / Ctrl+.';
  return (
    <aside ref={ref} className={`pg-panel ${className}`} data-pg-ctx="panel" data-open={v.open} data-overlay={v.overlay}
      style={{ [side === 'left' ? '--left-w' : '--right-w']: `${v.width}px` } as CSSProperties}>
      <div className="pg-panel-in">{children}</div>
      {v.open && <Handle side={side} width={v.width} />}
      <button className="pg-edge" aria-expanded={v.open} aria-label={`${v.open ? 'Collapse' : 'Expand'} ${label}`}
        title={`${v.open ? 'Collapse' : 'Expand'} ${label} (${shortcut})`} onClick={() => setPanel(side, !v.open)}>
        {(side === 'left') === v.open ? '‹' : '›'}
      </button>
    </aside>
  );
}

export function LeftPanel({ board, tab, onTab, children }: { board: BoardKit; tab: LeftTab; onTab: (t: LeftTab) => void; children: ReactNode }) {
  const v = usePanelView('left');
  return (
    <Shell side="left" className="pg-left" v={v}>
      <div className="pg-tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => onTab('chat')}>Chat</button>
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => onTab('layers')}>Layers <LayerCount board={board} /></button>
      </div>
      <ErrorBoundary name="Left panel">{children}</ErrorBoundary>
    </Shell>
  );
}

export function RightPanel({ children }: { children: ReactNode }) {
  const v = usePanelView('right');
  return (
    <Shell side="right" className="pg-right" v={v}>
      <ErrorBoundary name="Right panel">{children}</ErrorBoundary>
    </Shell>
  );
}
