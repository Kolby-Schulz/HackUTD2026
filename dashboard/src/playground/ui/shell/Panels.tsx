// The two side panels. Each wraps its content in an ErrorBoundary so a broken panel shows a notice
// instead of taking the page down.
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import type { BoardKit } from '../../core/commands';
import { flatten } from '../../core/tree';
import { useStoreValue } from '../../core/react';
import { ErrorBoundary } from './ErrorBoundary';
import '../../styles/panels.css';

export type LeftTab = 'chat' | 'layers';

function LayerCount({ board }: { board: BoardKit }) {
  const n = useStoreValue(board.doc.subscribe, useCallback(() => flatten(board.doc.getState()).length, [board]));
  return <span>{n}</span>;
}

export function LeftPanel({ board, tab, onTab, children }: { board: BoardKit; tab: LeftTab; onTab: (t: LeftTab) => void; children: ReactNode }) {
  return (
    <aside className="pg-panel pg-left" data-pg-ctx="panel">
      <div className="pg-tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => onTab('chat')}>Chat</button>
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => onTab('layers')}>Layers <LayerCount board={board} /></button>
      </div>
      <ErrorBoundary name="Left panel">{children}</ErrorBoundary>
    </aside>
  );
}

export function RightPanel({ children }: { children: ReactNode }) {
  return (
    <aside className="pg-panel pg-right" data-pg-ctx="panel">
      <ErrorBoundary name="Right panel">{children}</ErrorBoundary>
    </aside>
  );
}
