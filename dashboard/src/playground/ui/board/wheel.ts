// Wheel, trackpad and pinch input (CANVAS-3, CANVAS-31). Scroll pans, Cmd/Ctrl + scroll and pinch
// zoom around the pointer, Safari gesture events zoom too. Every path writes the camera store only,
// so input re-renders no React. Any input cancels a running camera tween.
import type { CameraStore } from '../../core/camera';
import { zoomAt } from '../../core/camera';
import { cancelTween } from '../../core/tween';
import { prefs } from '../../core/prefs';
import type { Cam } from '../../core/types';

const LINE_PX = 16;          // deltaMode 1 (lines)
const NOTCH_PX = 48;         // one mouse notch in Firefox line mode, after normalising (3 lines)
const NOTCH_ZOOM = 1.15;     // zoom factor per mouse-wheel notch
const PINCH_RATE = 0.01;     // continuous zoom: exp(-delta * rate)
const STICKY_MS = 400;       // a trackpad stays a trackpad this long after its last clear sign
const LEAK_MS = 120;         // a modifier pressed mid-swipe does not turn the inertia tail into a zoom

export type WheelKind = 'mouse' | 'trackpad';
export interface WheelLike { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

/** Wheel deltas in px: lines x 16, pages x viewport height. */
export function normalizeDelta(e: Pick<WheelLike, 'deltaX' | 'deltaY' | 'deltaMode'>, pageH: number): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pageH : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

const isNotch = (dy: number) => Math.abs(dy) >= 100 && (dy % 100 === 0 || dy % 120 === 0);

/**
 * Mouse wheel or trackpad? Line/page mode and whole-number multiples of 100/120 mean a notched wheel;
 * fractional, small or sideways deltas mean a trackpad. Sticky for a moment so inertia does not flip it.
 */
export function createClassifier() {
  let kind: WheelKind = 'mouse';
  let lastTrackpad = -Infinity;
  return (e: WheelLike, now: number): WheelKind => {
    if (e.deltaMode !== 0) { kind = 'mouse'; return kind; }
    const trackpadSign = e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 50;
    if (trackpadSign && !(e.deltaX === 0 && e.deltaY === 0)) { kind = 'trackpad'; lastTrackpad = now; return kind; }
    if (kind === 'trackpad' && now - lastTrackpad < STICKY_MS && !isNotch(e.deltaY)) { lastTrackpad = now; return kind; }
    kind = isNotch(e.deltaY) || Math.abs(e.deltaY) >= 50 ? 'mouse' : kind;
    return kind;
  };
}

/** Zoom factor for one zooming wheel event. Pinch/trackpad is continuous; a mouse notch is ~1.15. */
export function zoomFactor(e: WheelLike, kind: WheelKind, pageH: number): number {
  const { dy } = normalizeDelta(e, pageH);
  if (kind === 'trackpad') return Math.exp(-Math.max(-100, Math.min(100, dy)) * PINCH_RATE);
  const per = e.deltaMode !== 0 ? NOTCH_PX : dy % 120 === 0 ? 120 : 100;
  const notches = Math.max(-3, Math.min(3, -dy / per));
  return Math.pow(NOTCH_ZOOM, notches);
}

export interface WheelOpts {
  /** "Mouse wheel: zoom" (Figma's "Zoom with mouse wheel"); default reads prefs.flags.wheelZoom. */
  mouseZooms?: () => boolean;
  now?: () => number;
}

export function attachWheel(el: HTMLElement, camera: CameraStore, opts: WheelOpts = {}): () => void {
  const now = opts.now ?? (() => performance.now());
  const mouseZooms = opts.mouseZooms ?? (() => !!prefs.get().flags.wheelZoom);
  const classify = createClassifier();
  const local = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  let lastPan = -Infinity;

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    cancelTween(camera);
    const t = now();
    const kind = classify(e, t);
    const { dx, dy } = normalizeDelta(e, el.clientHeight);
    const pinch = e.ctrlKey;                                     // pinch arrives as ctrl+wheel; so does Ctrl+wheel
    const cmd = e.metaKey && !pinch && !(kind === 'trackpad' && t - lastPan < LEAK_MS);
    if (pinch || cmd || (kind === 'mouse' && mouseZooms() && !e.shiftKey)) {
      camera.zoomAt(local(e), zoomFactor(e, kind, el.clientHeight));
      return;
    }
    if (kind === 'trackpad') lastPan = t;
    const c = camera.getCam();
    // Shift + a plain mouse wheel scrolls sideways (macOS already swaps the axes for us)
    const sideways = e.shiftKey && dx === 0;
    camera.setCam({ z: c.z, x: c.x - (sideways ? dy : dx), y: c.y - (sideways ? 0 : dy) });
  };

  // Safari reports pinch as gesture events instead of ctrl+wheel; scale is relative to gesturestart.
  let start: Cam | null = null;
  const onStart = (e: Event) => { e.preventDefault(); cancelTween(camera); start = camera.getCam(); };
  const onChange = (e: Event) => {
    e.preventDefault();
    const g = e as Event & { scale: number; clientX: number; clientY: number };
    if (!start || !(g.scale > 0)) return;
    camera.setCam(zoomAt(start, local(g), g.scale));
  };
  const onEnd = (e: Event) => { e.preventDefault(); start = null; };
  // middle button: no Windows autoscroll icon; the pan itself is the gesture pipeline's
  const onMouseDown = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };

  const prev = { html: document.documentElement.style.overscrollBehavior, body: document.body.style.overscrollBehavior };
  document.documentElement.style.overscrollBehavior = 'none';   // no two-finger swipe back/forward
  document.body.style.overscrollBehavior = 'none';

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('gesturestart', onStart);
  el.addEventListener('gesturechange', onChange);
  el.addEventListener('gestureend', onEnd);
  el.addEventListener('mousedown', onMouseDown);
  return () => {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('gesturestart', onStart);
    el.removeEventListener('gesturechange', onChange);
    el.removeEventListener('gestureend', onEnd);
    el.removeEventListener('mousedown', onMouseDown);
    document.documentElement.style.overscrollBehavior = prev.html;
    document.body.style.overscrollBehavior = prev.body;
  };
}
