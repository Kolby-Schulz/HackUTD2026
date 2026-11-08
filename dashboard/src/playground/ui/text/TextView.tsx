// Text layer content and its in-place editor (initial version). Esc or click-away commits;
// Enter inserts a newline (REQUIREMENTS "Text editor keys"). Typography comes from the parent
// element (render/style.ts textStyle), so the editor matches the rendered text.
import { useCallback } from 'react';
import { useStoreValue } from '../../core/react';
import type { Shape } from '../../core/types';
import { useBoardEnv } from '../board/context';
import { TextEditor } from './TextEditor';

export function TextView({ shape }: { shape: Shape }) {
  const env = useBoardEnv();
  const id = shape.id;
  const editing = useStoreValue(env.ui.subscribe, useCallback(() => env.ui.get().editing === id, [env, id]));
  const wrap = shape.textMode === 'auto-w' ? 'pre' : 'pre-wrap';
  if (!editing) {
    if (shape.text) return <span style={{ whiteSpace: wrap, overflowWrap: 'anywhere' }}>{shape.text}</span>;
    return <span className="pg-text-ph" data-export-ignore="" style={{ color: 'var(--pg-muted)', fontStyle: 'italic', whiteSpace: 'pre', pointerEvents: 'none' }}>Type something</span>;
  }
  return <TextEditor shape={shape} />;
}
