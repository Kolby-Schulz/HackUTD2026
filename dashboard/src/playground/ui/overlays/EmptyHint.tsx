// Empty-board hint (CANVAS-27): centred note while the board has no layers.
import { useChildren } from '../../core/react';
import { useBoardEnv } from '../board/context';

export function EmptyHint() {
  const env = useBoardEnv();
  const roots = useChildren(env.board.doc, null);
  if (roots.length) return null;
  return (
    <div data-pg-empty="" style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', color: 'var(--pg-muted)', font: 'inherit', fontSize: 14, textAlign: 'center', padding: 24,
    }}>
      Nothing here yet. Draw a frame, or ask an agent in chat.
    </div>
  );
}
