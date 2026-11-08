// The rubber-band rectangle (SELECT-8): translucent --pg-sel fill with a 1 px border, drawn in
// screen space from the live world rect that gestures/marquee.ts publishes.
import { useRef } from 'react';
import { useCallback } from 'react';
import { useStoreValue } from '../../core/react';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';
import { marqueeOf } from '../gestures/marquee';

export function Marquee() {
  const env = useBoardEnv();
  const store = marqueeOf(env);
  const on = useStoreValue(store.subscribe, useCallback(() => store.get() !== null, [store]));
  const ref = useRef<HTMLDivElement>(null);

  usePainter((cam) => {
    const el = ref.current, r = store.get();
    if (!el || !r) return;
    const p = w2v(cam, r);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.width = `${r.w * cam.z}px`;
    el.style.height = `${r.h * cam.z}px`;
  });

  if (!on) return null;
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', left: 0, top: 0, pointerEvents: 'none', boxSizing: 'border-box',
        border: '1px solid var(--pg-sel)',
        background: 'color-mix(in srgb, var(--pg-sel) 8%, transparent)',
      }}
    />
  );
}
