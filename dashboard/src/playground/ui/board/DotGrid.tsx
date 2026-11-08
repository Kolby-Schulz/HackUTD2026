// The dotted background. Spacing follows the zoom and thins out (doubles) when dots get closer
// than 14 px. Painted from the camera frame, never through React state.
import { useRef } from 'react';
import type { Cam } from '../../core/types';
import { usePainter } from './context';

export const DOT_GAP = 24;

/** Screen spacing of the dots at zoom z. */
export function dotSpacing(z: number): number {
  let d = DOT_GAP * z;
  if (!(d > 0)) return DOT_GAP;
  while (d < 14) d *= 2;
  return d;
}

export function paintDotGrid(el: HTMLElement, cam: Cam) {
  const d = dotSpacing(cam.z);
  el.style.backgroundSize = `${d}px ${d}px`;
  el.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
}

export function DotGrid() {
  const ref = useRef<HTMLDivElement>(null);
  usePainter((cam) => { if (ref.current) paintDotGrid(ref.current, cam); });
  return <div ref={ref} className="pg-grid" aria-hidden="true" />;
}
