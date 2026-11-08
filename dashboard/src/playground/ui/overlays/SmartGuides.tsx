// Smart guides (ALIGN-2): 1 px red lines with little x marks where a drag snapped, plus equal-gap brackets with a
// distance label. Reads the snap guide store (world space) and paints in screen space, so widths never scale with zoom.
import { useEffect, useRef } from 'react';
import { snapResult } from '../../core/snap';
import type { SnapGap, SnapLine } from '../../core/snap';
import type { Cam } from '../../core/types';
import { useBoardEnv, usePainter } from '../board/context';
import '../../styles/guides.css';

const GUIDE_RED = '#F24822'; // ALIGN-2 smart-guide red; move to a --pg-guide token when tokens.css allows
const X = 3;           // half size of the 6 px x mark
const MARGIN = 50;     // lines are clipped to the viewport plus this margin

const sx = (cam: Cam, x: number) => Math.round(x * cam.z + cam.x) + 0.5;
const sy = (cam: Cam, y: number) => Math.round(y * cam.z + cam.y) + 0.5;
const cross = (x: number, y: number) => `M${x - X} ${y - X}L${x + X} ${y + X}M${x - X} ${y + X}L${x + X} ${y - X}`;

function lineSvg(l: SnapLine, cam: Cam, w: number, h: number): string {
  const v = l.axis === 'x';
  const at = v ? sx(cam, l.at) : sy(cam, l.at);
  const a = v ? sy(cam, l.from) : sx(cam, l.from);
  const b = v ? sy(cam, l.to) : sx(cam, l.to);
  const lim = v ? h : w;
  if (at < -MARGIN || at > (v ? w : h) + MARGIN) return '';
  const lo = Math.max(a, -MARGIN), hi = Math.min(b, lim + MARGIN);
  if (hi < lo) return '';
  let s = v ? `<line x1="${at}" y1="${lo}" x2="${at}" y2="${hi}"/>` : `<line x1="${lo}" y1="${at}" x2="${hi}" y2="${at}"/>`;
  // x marks only at endpoints that are actually visible
  const marks: string[] = [];
  if (a >= -MARGIN && a <= lim + MARGIN) marks.push(v ? cross(at, a) : cross(a, at));
  if (b >= -MARGIN && b <= lim + MARGIN && b !== a) marks.push(v ? cross(at, b) : cross(b, at));
  if (marks.length) s += `<path d="${marks.join('')}"/>`;
  return s;
}

function gapSvg(g: SnapGap, cam: Cam): string {
  const h = g.axis === 'x';           // gap measured along x: bracket is horizontal
  const a = h ? sx(cam, g.from) : sy(cam, g.from);
  const b = h ? sx(cam, g.to) : sy(cam, g.to);
  const at = h ? sy(cam, g.at) : sx(cam, g.at);
  let s = h
    ? `<line x1="${a}" y1="${at}" x2="${b}" y2="${at}"/><line x1="${a}" y1="${at - 4}" x2="${a}" y2="${at + 4}"/><line x1="${b}" y1="${at - 4}" x2="${b}" y2="${at + 4}"/>`
    : `<line x1="${at}" y1="${a}" x2="${at}" y2="${b}"/><line x1="${at - 4}" y1="${a}" x2="${at + 4}" y2="${a}"/><line x1="${at - 4}" y1="${b}" x2="${at + 4}" y2="${b}"/>`;
  if (Math.abs(b - a) >= 6) {        // ALIGN-15: label hides when the bar is too cramped
    const t = String(Math.round(g.size));
    const cx = h ? (a + b) / 2 : at, cy = h ? at : (a + b) / 2, w = t.length * 6 + 10;
    s += `<rect class="pg-gl-label" x="${cx - w / 2}" y="${cy - 7}" width="${w}" height="14" rx="3"/><text x="${cx}" y="${cy}">${t}</text>`;
  }
  return s;
}

export function SmartGuides() {
  const env = useBoardEnv();
  const g = useRef<SVGGElement>(null);
  // new guides arrive without the camera or document changing: ask for a paint frame
  useEffect(() => snapResult.subscribe(() => env.paint.wake()), [env]);
  usePainter((cam) => {
    const el = g.current;
    if (!el) return;
    const { lines, gaps } = snapResult.get();
    if (!lines.length && !gaps.length) { if (el.firstChild) el.innerHTML = ''; return; }
    const root = el.ownerSVGElement?.parentElement;
    const w = root?.clientWidth || 4000, h = root?.clientHeight || 4000;
    el.innerHTML = lines.map((l) => lineSvg(l, cam, w, h)).join('') + gaps.map((q) => gapSvg(q, cam)).join('');
  });
  return (
    <svg className="pg-guides" style={{ color: GUIDE_RED }} aria-hidden="true"><g ref={g} /></svg>
  );
}
