// Wheel and trackpad: scroll pans, Cmd/Ctrl + scroll (and pinch, which arrives as ctrl+wheel)
// zooms around the pointer. Writes the camera store only, so a wheel tick re-renders no React.
import type { CameraStore } from '../../core/camera';

const LINE_PX = 16;

export function attachWheel(el: HTMLElement, camera: CameraStore): () => void {
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? el.clientHeight : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.ctrlKey || e.metaKey) {
      const r = el.getBoundingClientRect();
      camera.zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-dy * 0.01));
      return;
    }
    const c = camera.getCam();
    // a plain mouse wheel with Shift scrolls sideways
    if (e.shiftKey && dx === 0) camera.setCam({ z: c.z, x: c.x - dy, y: c.y });
    else camera.setCam({ z: c.z, x: c.x - dx, y: c.y - dy });
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}
