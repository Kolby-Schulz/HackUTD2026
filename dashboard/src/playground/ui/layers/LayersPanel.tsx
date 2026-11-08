// The layer tree: nested rows in z-order (top first), expand/collapse, kind icons, click to select.
import { useCallback, useMemo, useState } from 'react';
import { useDoc } from '../../core/react';
import type { ShapeId } from '../../core/types';
import { selectIds } from '../board/state';
import { useSelection } from '../hooks';
import type { SlotProps } from '../slotProps';
import { LayerRow } from './LayerRow';
import { flattenTree, hiddenSelectionParents, isExpanded, subtreeParents, type ExpandedMap } from './treeView';
import '../../styles/layers.css';

// Expand/collapse choices live for the browser session (per viewer, not synced).
let overrides: ExpandedMap = new Map();

export function LayersPanel({ board, cursors }: SlotProps) {
  const st = useDoc(board.doc);
  const selected = useSelection(board);
  const [exp, setExp] = useState<ExpandedMap>(overrides);

  const rows = useMemo(() => flattenTree(st.children, st.shapes, exp), [st.children, st.shapes, exp]);
  const selSet = useMemo(() => new Set(selected), [selected]);
  const hidden = useMemo(() => hiddenSelectionParents(rows, st.shapes, selected), [rows, st.shapes, selected]);
  const colors = new Map(cursors.map((a) => [a.id, a.color]));
  const locks = new Map(board.locks.list().map((l) => [l.shapeId, colors.get(l.holder)]));

  const onPick = useCallback((id: ShapeId) => selectIds(board, [id]), [board]);
  const onToggle = useCallback((id: ShapeId, deep: boolean) => {
    const s = st.shapes.get(id);
    if (!s) return;
    const open = !isExpanded(s, overrides);
    const next = new Map(overrides);
    for (const p of deep ? subtreeParents(st.children, id) : [id]) next.set(p, open);
    overrides = next;
    setExp(next);
  }, [st.children, st.shapes]);

  return (
    <div className="pg-layers">
      {rows.map((row) => (
        <LayerRow key={row.id} row={row} selected={selSet.has(row.id)} hiddenSelected={hidden.has(row.id)}
          lockColor={locks.get(row.id)} onPick={onPick} onToggle={onToggle} />
      ))}
      {!rows.length && <div className="pg-empty">Agents are warming up…</div>}
    </div>
  );
}
