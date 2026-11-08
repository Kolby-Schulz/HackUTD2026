// Zoom % in the top bar: written from the camera, so zooming never re-renders the page. Click = fit.
// SHELL-3 turns this into the full zoom menu.
import { useEffect, useRef } from 'react';
import { camera } from '../core/camera';
import { activeBoard } from './board/state';
import { zoomToFit } from './board/viewActions';
import '../styles/zoom.css';

export function ZoomMenu() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => camera.subscribeSelect((c) => Math.round(c.z * 100), (pct) => { if (ref.current) ref.current.textContent = `${pct}%`; }), []);
  return (
    <button ref={ref} className="pg-zoom" title="Zoom to fit (Shift+1)" onClick={() => { const e = activeBoard(); if (e) zoomToFit(e); }}>
      {Math.round(camera.getCam().z * 100)}%
    </button>
  );
}
