// Zoom pill in the top bar (CANVAS-11, SHELL-3): an editable percent field plus a caret that opens the zoom menu.
// The label is written from the camera (no React re-render while zooming). Menu items run the view.* actions by id.
import { useEffect, useRef, useState } from 'react';
import { camera, MAX_ZOOM, MIN_ZOOM, zoomAt } from '../core/camera';
import { getAction, runAction, shortcutLabels } from '../core/actions';
import { tweenCam } from '../core/tween';
import { stepZoom } from '../actions/view';
import { activeBoard } from './board/state';
import '../styles/zoom.css';

/** "150", "150%", " 1.5 % " -> 1.5 (a zoom factor), clamped to the camera range. null when it is not a number. */
export function parseZoomInput(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*%?\s*$/.exec(text);
  if (!m) return null;
  const pct = Number(m[1]);
  if (!(pct > 0)) return null;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pct / 100));
}
export const zoomLabel = (z: number): string => {
  const pct = z * 100;
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
};

type Item = { id: string; label: string } | 'sep';
const ITEMS: Item[] = [
  { id: 'view.zoomIn', label: 'Zoom in' },
  { id: 'view.zoomOut', label: 'Zoom out' },
  'sep',
  { id: 'view.zoomFit', label: 'Zoom to fit' },
  { id: 'view.zoomSelection', label: 'Zoom to selection' },
  'sep',
  { id: 'view.zoom50', label: 'Zoom to 50%' },
  { id: 'view.zoom100', label: 'Zoom to 100%' },
  { id: 'view.zoom200', label: 'Zoom to 200%' },
];

/** Zoom to `z` around the view centre (tweened; instant under reduced motion). */
function zoomCentered(z: number) {
  const cam = camera.getCam();
  const v = camera.getViewSize();
  tweenCam(camera, zoomAt(cam, { x: v.w / 2, y: v.h / 2 }, z / cam.z), { duration: 160 });
}

export function ZoomMenu() {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const sync = () => { if (input.current) input.current.value = zoomLabel(camera.getCam().z); };

  useEffect(() => camera.subscribeSelect((c) => zoomLabel(c.z), (label) => {
    if (input.current && document.activeElement !== input.current) input.current.value = label;
  }), []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    root.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  const commit = () => {
    const z = parseZoomInput(input.current?.value ?? '');
    if (z !== null) zoomCentered(z);
    sync();                                   // invalid reverts; a clamped value shows clamped (after the tween it re-syncs)
    if (z !== null && input.current) input.current.value = zoomLabel(z);
  };
  const onFieldKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') { commit(); input.current?.select(); }
    else if (e.key === 'Escape') { sync(); input.current?.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const z = stepZoom(camera.getCam().z, e.key === 'ArrowUp' ? 1 : -1);
      zoomCentered(z);
      if (input.current) { input.current.value = zoomLabel(z); input.current.select(); }
    }
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); (root.current?.querySelector('.pg-zoom-caret') as HTMLElement | null)?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  };
  const pick = (id: string) => { setOpen(false); runAction(id); };

  return (
    <div ref={root} className="pg-zoomwrap" data-pg-ctx="panel">
      <div className="pg-zoom">
        <input
          ref={input} className="pg-zoom-field" aria-label="Zoom percent" title="Zoom (type a percent)" spellCheck={false}
          defaultValue={zoomLabel(camera.getCam().z)}
          onFocus={(e) => e.currentTarget.select()} onBlur={sync} onKeyDown={onFieldKey}
        />
        <button className="pg-zoom-caret" aria-haspopup="menu" aria-expanded={open} aria-label="Zoom menu" onClick={() => setOpen((o) => !o)}>▾</button>
      </div>
      {open && (
        <div className="pg-zoom-menu" role="menu" onKeyDown={onMenuKey}>
          {ITEMS.map((it, n) => it === 'sep'
            ? <div key={n} className="pg-zoom-sep" role="separator" />
            : (
              <button key={it.id} role="menuitem" className="pg-zoom-item" onClick={() => pick(it.id)}>
                <span>{it.label}</span>
                <kbd>{(() => { const a = getAction(it.id); return a ? shortcutLabels(a)[0] ?? '' : ''; })()}</kbd>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
