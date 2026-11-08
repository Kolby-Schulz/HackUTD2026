// One layer row: indent, chevron gutter, kind icon, name, lock-holder dot. Fixed height; pure in its props.
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getRenaming, renameShape, requestRename, soloVisible, subscribeRenaming, toggleFlag } from '../../actions/layers';
import { activeBoard } from '../board/state';
import type { ShapeId } from '../../core/types';
import { beginRowDrag, useRowDropState } from './dnd';
import { MAX_INDENT_DEPTH, type LayerRowData } from './treeView';

export const ROW_HEIGHT = 28;
const MAX_DOTS = 3;

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
  /** Colours of the agents holding a soft lock on this layer (stacked dots, max 3 then +n). */
  lockColors?: readonly string[];
  /** Colours of agents editing a descendant: shown as a hollow ring while this row is collapsed. */
  belowColors?: readonly string[];
  /** Ids the row drags along when it is part of the selection (the human's selection). */
  getSelection?: () => readonly ShapeId[];
  onPick: (id: ShapeId) => void;
  onToggle: (id: ShapeId, deep: boolean) => void;
  /** Double-click on the row (not the name, which renames): centre the camera on the layer. */
  onJump?: (id: ShapeId) => void;
}

const noop = () => () => {};
/** Pulse the editing dot (no keyframes in layers.css, which this package does not own). */
const pulse = (el: HTMLSpanElement | null) => { el?.animate?.([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 1000, iterations: Infinity }); };
const iconBtn = { width: 16, height: 16, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 0, background: 'transparent', color: 'var(--pg-muted)', cursor: 'pointer' } as const;

function RenameInput({ id, initial }: { id: ShapeId; initial: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const env = activeBoard();
    if (commit && env) renameShape(env.board, id, ref.current?.value ?? '');
    requestRename(null);
  };
  return (
    <input ref={ref} className="nm" defaultValue={initial} maxLength={256} spellCheck={false}
      style={{ flex: 1, minWidth: 0, font: 'inherit', color: 'var(--pg-ink)', background: 'var(--pg-panel)', border: '1px solid var(--pg-sel)', borderRadius: 4, padding: '0 4px', height: 20, outline: 'none' }}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); }}
      onBlur={() => finish(true)} />
  );
}

export const LayerRow = memo(function LayerRow({ row, selected, hiddenSelected, lockColors, belowColors, getSelection, onPick, onToggle, onJump }: LayerRowProps) {
  const env = activeBoard();
  // Per-row subscription to its own shape, so flags and author show without the panel passing them down.
  const shape = useSyncExternalStore(
    env ? (l) => env.board.doc.subscribeShape(row.id, l) : noop,
    () => env?.board.doc.getState().shapes.get(row.id),
  );
  const editing = useSyncExternalStore(subscribeRenaming, () => getRenaming() === row.id);
  const [hover, setHover] = useState(false);
  const drop = useRowDropState(row.id);
  const [dropMode, dropDepth] = drop.split(':');
  const locked = !!shape?.locked, hidden = !!shape?.hidden;
  const owner = env && shape ? env.board.actors.get(shape.author ?? shape.createdBy) : undefined;
  const ownerColor = owner && owner.kind !== 'human' ? owner.color : undefined;
  const cls = 'pg-layer' + (selected ? ' on' : hiddenSelected ? ' sub' : '') + (row.kind === 'component' || row.kind === 'instance' ? ' comp' : '');
  const apply = (flag: 'locked' | 'hidden', e: React.MouseEvent) => {
    e.stopPropagation();
    if (!env) return;
    if (flag === 'hidden' && e.altKey) { soloVisible(env.board, row.id); return; }
    const sel = env.board.selection.get(env.board.me).ids;
    toggleFlag(env.board, selected ? sel : [row.id], flag);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing || (e.target as HTMLElement).closest('button, input, .chev')) return;
    const selection = getSelection?.() ?? (env ? env.board.selection.get(env.board.me).ids : []);
    beginRowDrag(e, row.id, { selection, onExpand: (id) => onToggle(id, false) });
  };
  return (
    <div className={cls} style={{ height: ROW_HEIGHT, position: 'relative', paddingLeft: 6 + Math.min(row.depth, MAX_INDENT_DEPTH) * 16, opacity: drop === 'drag' ? 0.4 : hidden ? 0.5 : undefined, boxShadow: dropMode === 'into' ? 'inset 0 0 0 2px var(--pg-sel)' : undefined }}
      data-layer={row.id} data-expanded={row.expanded} data-haschildren={row.hasChildren} onPointerDown={onPointerDown} onClick={() => onPick(row.id)} onDoubleClick={() => onJump?.(row.id)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="chev" onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => { if (!row.hasChildren) return; e.stopPropagation(); onToggle(row.id, e.altKey); }}>
        {row.hasChildren && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: row.expanded ? 'rotate(90deg)' : undefined }}>
            <path d="M4.5 2.5L8 6 4.5 9.5" />
          </svg>
        )}
      </span>
      <span className="ic"><KindIcon kind={row.kind} /></span>
      {editing
        ? <RenameInput id={row.id} initial={shape?.name ?? row.name} />
        : <span className="nm" onDoubleClick={(e) => { e.stopPropagation(); onPick(row.id); requestRename(row.id); }}>{row.name}</span>}
      {!editing && (hover || locked || hidden) && (
        <>
          <button type="button" aria-label={locked ? 'Unlock layer' : 'Lock layer'} title={locked ? 'Unlock' : 'Lock'} style={{ ...iconBtn, opacity: locked || hover ? 1 : 0 }} onClick={(e) => apply('locked', e)} onDoubleClick={(e) => e.stopPropagation()}>
            <svg {...P} width={14} height={14}>{locked ? <><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></> : <><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 014.8-1" /></>}</svg>
          </button>
          <button type="button" aria-label={hidden ? 'Show layer' : 'Hide layer'} title={hidden ? 'Show (Alt: solo)' : 'Hide (Alt: solo)'} style={{ ...iconBtn, opacity: hidden || hover ? 1 : 0 }} onClick={(e) => apply('hidden', e)} onDoubleClick={(e) => e.stopPropagation()}>
            <svg {...P} width={14} height={14}>{hidden ? <path d="M2 8s2.3-4 6-4 6 4 6 4M3 13L13 3" /> : <><path d="M2 8s2.3-4 6-4 6 4 6 4-2.3 4-6 4-6-4-6-4z" /><circle cx="8" cy="8" r="1.8" /></>}</svg>
          </button>
        </>
      )}
      {(dropMode === 'before' || dropMode === 'after') && (
        <span aria-hidden style={{ position: 'absolute', height: 2, borderRadius: 1, background: 'var(--pg-sel)', pointerEvents: 'none', right: 4, left: 6 + Math.min(Number(dropDepth), MAX_INDENT_DEPTH) * 16, [dropMode === 'before' ? 'top' : 'bottom']: -1 }} />
      )}
      {lockColors?.length
        ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: 'none' }}>
            {lockColors.slice(0, MAX_DOTS).map((c) => <span key={c} className="dot" title="Editing now" ref={pulse} style={{ background: c }} />)}
            {lockColors.length > MAX_DOTS && <span style={{ fontSize: 10, color: 'var(--pg-muted)' }}>+{lockColors.length - MAX_DOTS}</span>}
          </span>
        )
        : !row.expanded && belowColors?.length
          ? <span className="dot" title="Editing inside" style={{ background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${belowColors[0]}`, width: 7, height: 7 }} />
          : ownerColor && <span className="dot" title={`Created by ${owner?.name}`} style={{ background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${ownerColor}`, width: 7, height: 7 }} />}
    </div>
  );
});
