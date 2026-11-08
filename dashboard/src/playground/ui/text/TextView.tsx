// Text layer content and its in-place editor (initial version). Esc or click-away commits;
// Enter inserts a newline (REQUIREMENTS "Text editor keys"). Typography comes from the parent
// element (render/style.ts textStyle), so the editor matches the rendered text.
import { useCallback, useEffect, useState } from 'react';
import { useStoreValue } from '../../core/react';
import { isOverflowing, onFontsLoaded } from '../../render/measure';
import type { Shape } from '../../core/types';
import { useBoardEnv } from '../board/context';
import { TextEditor } from './TextEditor';

export function TextView({ shape }: { shape: Shape }) {
  const env = useBoardEnv();
  const id = shape.id;
  const editing = useStoreValue(env.ui.subscribe, useCallback(() => env.ui.get().editing === id, [env, id]));
  const wrap = shape.textMode === 'auto-w' ? 'pre' : 'pre-wrap';
  // re-measure once web fonts arrive, so the overflow bracket reflects real glyph widths (TEXT-21)
  const [, setFonts] = useState(0);
  useEffect(() => onFontsLoaded(() => setFonts((n) => n + 1)), []);
  // a boolean selector: only this layer re-renders when its own selection state flips
  const selSub = useCallback((l: () => void) => env.board.selection.subscribe(() => l()), [env]);
  const selected = useStoreValue(selSub, useCallback(() => env.board.selection.get(env.board.me).ids.includes(id), [env, id]));
  const fixed = shape.textMode === 'fixed';
  if (!editing) {
    if (shape.text) {
      const over = fixed && selected && isOverflowing(shape);
      return (
        <>
          <span style={{ whiteSpace: wrap, overflowWrap: 'anywhere', ...(fixed ? { display: 'block', width: '100%', height: '100%', overflow: 'hidden' } : null) }}>{shape.text}</span>
          {over && <span className="pg-text-over" data-export-ignore="" title="Text overflows the box" />}
        </>
      );
    }
    return <span className="pg-text-ph" data-export-ignore="" style={{ color: 'var(--pg-muted)', fontStyle: 'italic', whiteSpace: 'pre', pointerEvents: 'none' }}>Type something</span>;
  }
  return <TextEditor shape={shape} />;
}
