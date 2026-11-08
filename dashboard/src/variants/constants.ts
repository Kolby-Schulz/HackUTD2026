// Shared constants, URL state and labels for #/variants.
import type { Zoom } from './NodeView.tsx';
import type { NodeId } from './types.ts';

export const LETTERS = ['A', 'B', 'C', 'D'];
// Pane letters use the first four agent colours from DESIGN.md (all pass AA with white letters).
export const COLORS = ['#bf3989', '#1a7f37', '#8250df', '#bc4c00'];
export const MAX_PANES = 4;
export const DRAFT = '~draft';
export const HINT_KEY = 'vx.hint.take.v1';
export type Viewport = 'desktop' | 'tablet' | 'mobile';
export const VIEWPORTS: Record<Viewport, number | null> = { desktop: null, tablet: 768, mobile: 390 };
/** Zoom steps for -/= keys. Fit is the default; numbers render at that exact scale and scroll. */
export const ZOOMS: Zoom[] = ['page', 'fit', 0.25, 0.5, 0.75, 1];
export const zoomName = (z: Zoom) => (z === 'fit' ? 'Fit width' : z === 'page' ? 'Fit page' : `${Math.round(z * 100)}%`);
/** A pane's own width: null follows the title-bar device, a number is a custom width in px. */
export type PaneWidth = Viewport | number | null;
export const widthName = (w: PaneWidth) => (w === null ? 'Same as others' : typeof w === 'number' ? `${w}px` : w[0].toUpperCase() + w.slice(1));

export interface HashState { screen?: string; panes?: NodeId[]; viewport?: Viewport; zoom?: Zoom }

export function readHash(): HashState {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const v = q.get('v');
  return {
    screen: q.get('screen') ?? undefined,
    panes: q.get('p')?.split(',').filter(Boolean).slice(0, MAX_PANES),
    viewport: v === 'tablet' || v === 'mobile' || v === 'desktop' ? v : undefined,
    zoom: ZOOMS.find((z) => String(z) === q.get('z')),
  };
}

export function writeHash(s: Required<HashState>) {
  const q = new URLSearchParams({ screen: s.screen, p: s.panes.join(','), v: s.viewport, z: String(s.zoom) });
  history.replaceState(null, '', `#/variants?${q.toString().replace(/%2C/g, ',')}`);
}
