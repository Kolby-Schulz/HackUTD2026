// Pulse ring (CANVAS-26): goTo / goToShape emit a pulse; this overlay draws an expanding ring over the target rect
// (world coordinates, followed through camera tweens by the paint frame) for ~400 ms. Mounted from Board.tsx.
import { useEffect, useRef, useState } from 'react';
import { onPulse } from '../../core/goto';
import type { PulseEvent } from '../../core/goto';
import { prefersReducedMotion } from '../../core/tween';
import { usePainter } from '../board/context';

interface Live { key: number; ev: PulseEvent }
let seq = 0;

export function Pulse() {
  const [live, setLive] = useState<Live[]>([]);
  const els = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => onPulse((ev) => {
    const key = ++seq;
    setLive((l) => [...l, { key, ev }]);
    setTimeout(() => setLive((l) => l.filter((p) => p.key !== key)), ev.ms + 50);
  }), []);

  usePainter((cam) => {
    for (const { key, ev } of live) {
      const el = els.current.get(key);
      if (!el) continue;
      const r = ev.rect;
      el.style.transform = `translate(${r.x * cam.z + cam.x}px, ${r.y * cam.z + cam.y}px)`;
      el.style.width = `${Math.max(r.w * cam.z, 8)}px`;
      el.style.height = `${Math.max(r.h * cam.z, 8)}px`;
    }
  });

  return (
    <>
      {live.map(({ key, ev }) => (
        <div key={key} data-pg-pulse="" aria-hidden
          ref={(el) => {
            if (!el) { els.current.delete(key); return; }
            if (els.current.has(key)) return;
            els.current.set(key, el);
            if (!prefersReducedMotion()) {
              el.animate?.([{ opacity: 1, outlineOffset: '0px' }, { opacity: 0, outlineOffset: '10px' }], { duration: ev.ms, easing: 'ease-out', fill: 'forwards' });
            }
          }}
          style={{
            position: 'absolute', left: 0, top: 0, pointerEvents: 'none', boxSizing: 'border-box', borderRadius: 4,
            outline: `2px solid ${ev.color ?? 'var(--pg-sel)'}`,
          }} />
      ))}
    </>
  );
}
