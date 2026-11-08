// Renders playground shapes as static DOM, using the playground's own pure style functions so a frame
// looks the same here as on the board. Also the hook that keeps a live board in sync with the playground.
import { useEffect, useMemo, useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';
import { boardKey, parseBoard } from './boards.ts';
import type { BoardData, Shape } from './boards.ts';

// The playground's pure style functions, loaded only if the playground is in this build (see boards.ts).
type Css = Record<string, string | number | undefined>;
const styleMods = import.meta.glob<{ boxStyle: (s: Shape) => Css; shapeStyle: (s: Shape) => Css }>('../playground/render/style.ts', { eager: true });
const style = Object.values(styleMods)[0];

function ShapeNode({ b, id, root }: { b: BoardData; id: string; root?: boolean }) {
  const s = b.shapes.get(id);
  if (!s || !style) return null;
  const at = root ? { ...s, x: 0, y: 0, rotation: 0 } : s;
  const kids = (b.kids.get(id) ?? []).map((k) => <ShapeNode key={k} b={b} id={k} />);
  const css = (s.kind === 'group' ? style.boxStyle(at) : style.shapeStyle(at)) as CSSProperties;
  return (
    <div className={`vx-bshape k-${s.kind}`} style={css}>
      {s.kind === 'text' ? s.text : kids}
    </div>
  );
}

/** One shape and its subtree, laid out as a block of its own size (centred in the slot). */
export function BoardBlock({ b, id }: { b: BoardData; id: string }) {
  const s = b.shapes.get(id);
  if (!s) return <div className="vx-missing">This layer was deleted in the playground</div>;
  return (
    <div className="vx-bblock" style={{ width: s.w, height: s.h }}>
      <ShapeNode b={b} id={id} root />
    </div>
  );
}

/** Components for a board design: one per matched part, plus the whole frame. Callers memoise per board change. */
export function boardComponents(b: BoardData | null, frameId: string, matches: Record<string, string>) {
  const slots: Record<string, ComponentType> = {};
  if (b) for (const [slot, id] of Object.entries(matches)) slots[slot] = () => <BoardBlock b={b} id={id} />;
  const Whole: ComponentType = () =>
    b?.shapes.has(frameId) ? <BoardBlock b={b} id={frameId} />
    : <div className="vx-missing">{b ? 'This frame was deleted in the playground' : 'No playground board in this browser yet'}</div>;
  return { slots, Whole };
}

/**
 * The playground's saved board, kept current: the `storage` event fires when the playground (another tab)
 * autosaves; a light poll while visible covers the same tab and browsers that skip the event.
 */
export function usePlaygroundBoard(boardId: string) {
  const key = boardKey(boardId);
  const read = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const [raw, setRaw] = useState<string | null>(read);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => { const r = read(); setRaw((old) => (old === r ? old : r)); setCheckedAt(Date.now()); };
    const onStorage = (e: StorageEvent) => { if (e.key === key || e.key === null) refresh(); };
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, [key]);
  const board = useMemo(() => parseBoard(raw), [raw]);
  return { board, checkedAt };
}
