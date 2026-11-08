// Pan: drag with the hand tool, Space held, the middle button, or on empty canvas. Mutates the
// camera store only (no React state); Escape puts the camera back.
import type { BoardEnv, UiStore } from '../board/state';
import { cancelTween } from '../../core/tween';
import type { Mode, PointerInfo } from './pipeline';

export function startPan(env: BoardEnv, p0: PointerInfo): Mode {
  cancelTween(env.camera);
  const cam0 = env.camera.getCam();
  env.ui.set({ panning: true });
  const end = () => env.ui.set({ panning: false });
  return {
    move(p) { env.camera.setCam({ z: cam0.z, x: cam0.x + p.clientX - p0.clientX, y: cam0.y + p.clientY - p0.clientY }); },
    up: end,
    cancel() { env.camera.setCam(cam0); end(); },
  };
}

const isTextTarget = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

/**
 * Space-to-pan is a held modifier, not an action (the key dispatcher only sees keydown), so it is
 * tracked here. Ignored while typing. Returns the remover.
 */
export function trackSpace(ui: UiStore, target: Window = window): () => void {
  const down = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || isTextTarget(e.target)) return;
    e.preventDefault();          // no button "click", no page scroll
    ui.set({ space: true });
  };
  const up = (e: KeyboardEvent) => { if (e.code === 'Space') ui.set({ space: false }); };
  const clear = () => ui.set({ space: false });          // a lost keyup (window blur, tab switch) must not stick
  const hidden = () => { if (document.hidden) clear(); };
  target.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', hidden);
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', clear);
    document.removeEventListener('visibilitychange', hidden);
  };
}
