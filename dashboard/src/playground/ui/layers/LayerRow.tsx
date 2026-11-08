// One layer row: indent, chevron gutter, kind icon, name, lock-holder dot. Fixed height; pure in its props.
import { memo } from 'react';
import type { ShapeId } from '../../core/types';
import { MAX_INDENT_DEPTH, type LayerRowData } from './treeView';

export const ROW_HEIGHT = 28;

const P = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
function KindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'frame': return <svg {...P}><path d="M5.5 2v12M10.5 2v12M2 5.5h12M2 10.5h12" /></svg>;
    case 'group': return <svg {...P}><rect x="2.5" y="4" width="11" height="8.5" rx="1.5" strokeDasharray="2 1.6" /></svg>;
    case 'rect': return <svg {...P}><rect x="2.5" y="3.5" width="11" height="9" rx="1" /></svg>;
    case 'ellipse': return <svg {...P}><circle cx="8" cy="8" r="5.5" /></svg>;
    case 'text': return <svg {...P}><path d="M3.5 4.5v-1h9v1M8 3.5v9M6.5 12.5h3" /></svg>;
    case 'line': return <svg {...P}><path d="M3 13L13 3" /></svg>;
    case 'image': return <svg {...P}><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M3 11.5l3.2-3 2.3 2 1.5-1.5 3 2.5" /></svg>;
    case 'component': return <svg {...P}><path d="M8 2.5l5.5 5.5L8 13.5 2.5 8z" fill="currentColor" /></svg>;
    case 'instance': return <svg {...P}><path d="M8 2.5l5.5 5.5L8 13.5 2.5 8z" /></svg>;
    default: return <svg {...P}><rect x="3.5" y="3.5" width="9" height="9" /></svg>;
  }
}

export interface LayerRowProps {
  row: LayerRowData;
  selected: boolean;
  /** A collapsed descendant of this row is selected (lighter tint). */
  hiddenSelected: boolean;
  /** Colour of an agent holding a soft lock on this layer. */
  lockColor?: string;
  onPick: (id: ShapeId) => void;
  onToggle: (id: ShapeId, deep: boolean) => void;
}

export const LayerRow = memo(function LayerRow({ row, selected, hiddenSelected, lockColor, onPick, onToggle }: LayerRowProps) {
  const cls = 'pg-layer' + (selected ? ' on' : hiddenSelected ? ' sub' : '') + (row.kind === 'component' || row.kind === 'instance' ? ' comp' : '');
  return (
    <div className={cls} style={{ height: ROW_HEIGHT, paddingLeft: 6 + Math.min(row.depth, MAX_INDENT_DEPTH) * 16 }} data-layer={row.id} onClick={() => onPick(row.id)}>
      <span className="chev" onClick={(e) => { if (!row.hasChildren) return; e.stopPropagation(); onToggle(row.id, e.altKey); }}>
        {row.hasChildren && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: row.expanded ? 'rotate(90deg)' : undefined }}>
            <path d="M4.5 2.5L8 6 4.5 9.5" />
          </svg>
        )}
      </span>
      <span className="ic"><KindIcon kind={row.kind} /></span>
      <span className="nm">{row.name}</span>
      {lockColor && <span className="dot" style={{ background: lockColor }} />}
    </div>
  );
});
