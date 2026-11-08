// The layer tree: nested rows in z-order (top first), owner dot per agent, click to select.
import { memo } from 'react';
import { useDoc } from '../../core/react';
import type { ShapeId } from '../../core/types';
import { selectIds } from '../board/state';
import { useSelection } from '../hooks';
import type { SlotProps } from '../slotProps';
import '../../styles/layers.css';

const KIND_ICON: Record<string, string> = { frame: '#', group: '⧉', rect: '▢', ellipse: '◯', text: 'T', line: '／', image: '▣' };

export function LayersPanel({ board, cursors }: SlotProps) {
  const st = useDoc(board.doc);
  const selected = useSelection(board);
  const color = new Map(cursors.map((a) => [a.id, a.color]));
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
