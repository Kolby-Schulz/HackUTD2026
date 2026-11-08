// Text layer content and its in-place editor (initial version). Esc or click-away commits;
// Enter inserts a newline (REQUIREMENTS "Text editor keys"). Typography comes from the parent
// element (render/style.ts textStyle), so the editor matches the rendered text.
import { useCallback } from 'react';
import { useStoreValue } from '../../core/react';
import type { Shape } from '../../core/types';
import { useBoardEnv } from '../board/context';
import { commitText } from '../gestures/text';

export function TextView({ shape }: { shape: Shape }) {
  const env = useBoardEnv();
  const id = shape.id;
  const editing = useStoreValue(env.ui.subscribe, useCallback(() => env.ui.get().editing === id, [env, id]));
  if (!editing) return <>{shape.text}</>;
  return (
    <textarea
      autoFocus
      defaultValue={shape.text}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => commitText(env, id, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
      }}
    />
  );
}
