// React context carrying the BoardEnv to shape views, overlays and shell children of the board.
import { createContext, useContext, useEffect, useRef } from 'react';
import type { Cam } from '../../core/types';
import type { BoardEnv } from './state';

export const BoardEnvContext = createContext<BoardEnv | null>(null);

export function useBoardEnv(): BoardEnv {
  const env = useContext(BoardEnvContext);
  if (!env) throw new Error('useBoardEnv outside <Board>');
  return env;
}

/** Run `fn` in the board's paint frame (after camera, document or presence changes). Latest fn wins. */
export function usePainter(fn: (cam: Cam, env: BoardEnv) => void) {
  const env = useBoardEnv();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const off = env.paint.add((cam) => ref.current(cam, env));
    env.paint.wake();
    return off;
  }, [env]);
  // a re-render may have changed what the painter shows (new element, new target): repaint
  useEffect(() => { env.paint.wake(); });
}
