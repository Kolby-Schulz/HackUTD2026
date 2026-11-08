// One shape, rendered as nested DOM (D1, D5): children render inside their parent's element in
// local coordinates, so moving a frame is one write; frames clip their children.
// Each view subscribes to its own record and child list only.
import { memo } from 'react';
import type { CSSProperties } from 'react';
import { useChildren, useShape } from '../../core/react';
import type { ShapeId } from '../../core/types';
import { boxStyle, shapeStyle } from '../../render/style';
import { TextView } from '../text/TextView';
import { useBoardEnv } from './context';
import { isVisible } from './culling';

export const ShapeView = memo(function ShapeView({ id, depth }: { id: ShapeId; depth: number }) {
  const env = useBoardEnv();
  const store = env.board.doc;
  const s = useShape(store, id);
  const kids = useChildren(store, id);
  if (!s || s.deleted) return null;

  const children = kids.filter(isVisible).map((k) => <ShapeView key={k} id={k} depth={depth + 1} />);

  if (s.kind === 'group') {
    return <div className="pg-shape k-group" data-id={id} style={boxStyle(s) as CSSProperties}>{children}</div>;
  }
  if (s.kind === 'frame') {
    // the frame element itself paints and clips its children; the name label is a sibling so the clip never hides it
    const frame = <div className="pg-shape k-frame" data-id={id} style={shapeStyle(s) as CSSProperties}>{children}</div>;
    if (depth > 0) return frame;
    return (
      <>
        <div className="pg-fname" style={{ transform: `translate(${s.x}px, ${s.y}px)`, display: s.hidden ? 'none' : undefined }}>{s.name}</div>
        {frame}
      </>
    );
  }
  return (
    <div className={`pg-shape k-${s.kind}`} data-id={id} style={shapeStyle(s) as CSSProperties}>
      {s.kind === 'text' && <TextView shape={s} />}
      {children}
    </div>
  );
});
