// One shape, rendered as nested DOM (D1, D5): children render inside their parent's element in
// local coordinates, so moving a frame is one write; frames clip their children.
// Each view subscribes to its own record and child list only.
import { memo } from 'react';
import type { CSSProperties } from 'react';
import { useChildren, useShape } from '../../core/react';
import type { ShapeId } from '../../core/types';
import { boxStyle, paintStyle, shapeStyle } from '../../render/style';
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

  if (s.kind === 'frame' || s.kind === 'group') {
    // outer box positions (and is not clipped, so the frame name can sit above it); inner surface paints and clips
    return (
      <div className={`pg-shape k-${s.kind}`} data-id={id} style={boxStyle(s) as CSSProperties}>
        {s.kind === 'frame' && depth === 0 && <div className="pg-fname">{s.name}</div>}
        <div className="pg-surface" style={paintStyle(s) as CSSProperties}>{children}</div>
      </div>
    );
  }
  return (
    <div className={`pg-shape k-${s.kind}`} data-id={id} style={shapeStyle(s) as CSSProperties}>
      {s.kind === 'text' && <TextView shape={s} />}
      {children}
    </div>
  );
});
