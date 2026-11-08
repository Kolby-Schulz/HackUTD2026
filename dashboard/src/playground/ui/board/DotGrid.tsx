// The dotted background (CANVAS-14). Two layers of dots at adjacent power-of-two gaps cross-fade as
// the zoom changes, so on-screen spacing stays within 14-28 px and density never pops. Dots sit on
// world multiples of the gap. Painted from the camera frame, never through React state.
import { useRef } from 'react';
import type { Cam } from '../../core/types';
import { usePainter } from './context';

export const DOT_GAP = 24;
const MIN_PX = 14;

/** Screen spacing of the dots at zoom z, always in [14, 28). */
export function dotSpacing(z: number): number {
  let d = DOT_GAP * z;
  if (!(d > 0)) return DOT_GAP;
  while (d < MIN_PX) d *= 2;
  while (d >= MIN_PX * 2) d /= 2;
  return d;
}

const ramp = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));

export interface GridLevels {
  /** Screen spacing of the two layers: `fine` is in [14, 28), `coarse` is twice that. */
  fine: number; coarse: number;
  /** Opacity of each layer. fine rises 0 -> 1 across the band while coarse falls 1 -> 0, so each rollover is seamless. */
  fineAlpha: number; coarseAlpha: number;
}

/** Layer spacings and opacities at zoom z (pure). Everything fades out at the zoom extremes. */
export function gridLevels(z: number): GridLevels {
  const fine = dotSpacing(z);
  const t = (fine - MIN_PX) / MIN_PX;
  // far out the grid is noise; far in (z > 8..16) the pixel grid takes over
  const extreme = ramp(z, 0.02, 0.05) * (1 - ramp(z, 8, 16));
  return { fine, coarse: fine * 2, fineAlpha: t * extreme, coarseAlpha: (1 - t) * extreme };
}

/** Where a layer's tiles start so a dot falls on every world multiple of its gap (device-pixel rounded). */
export function layerOffset(camPos: number, spacing: number, dpr = 1): number {
  const o = (((camPos - spacing / 2) % spacing) + spacing) % spacing;   // dots are drawn at the tile centre
  return Math.round(o * dpr) / dpr;
}

function paintLayer(el: HTMLElement, spacing: number, alpha: number, cam: Cam, dpr: number) {
  el.style.opacity = alpha < 0.005 ? '0' : String(alpha);
  el.style.backgroundSize = `${spacing}px ${spacing}px`;
  el.style.backgroundPosition = `${layerOffset(cam.x, spacing, dpr)}px ${layerOffset(cam.y, spacing, dpr)}px`;
}

export function paintDotGrid(root: HTMLElement, cam: Cam) {
  const [a, b] = Array.from(root.children) as HTMLElement[];
  if (!a || !b) return;
  const g = gridLevels(cam.z);
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  paintLayer(a, g.fine, g.fineAlpha, cam, dpr);
  paintLayer(b, g.coarse, g.coarseAlpha, cam, dpr);
}

const layer = { position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, var(--pg-dot) 1.2px, transparent 1.4px)' } as const;

export function DotGrid() {
  const ref = useRef<HTMLDivElement>(null);
  usePainter((cam) => { if (ref.current) paintDotGrid(ref.current, cam); });
  return (
    <div ref={ref} className="pg-grid" style={{ backgroundImage: 'none' }} aria-hidden="true">
      <div style={layer} />
      <div style={layer} />
    </div>
  );
}
