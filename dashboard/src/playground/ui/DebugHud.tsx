// Debug HUD (CANVAS-44, SHELL-20). Hidden unless `?debug`, `?hud=1`, the perfHud flag, or action view.toggleDebug.
// Cost: React renders this component only when the toggle flips. While on, a 4 Hz timer writes strings straight into
// one <pre> text node (no React render per frame); a scheduler callback only pushes frame times (core/perf.ts).
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SlotProps } from './slotProps';
import { BUDGET, debugOn, setLiveSampler, startSampler, subscribeDebug } from '../core/perf';
import { subscribeFlags } from '../core/flags';
import { visibleWorldRect } from '../core/camera';
import { activeBoard } from './board/state';

const TICK_MS = 250;

function useDebug(): boolean {
  return useSyncExternalStore(
    (cb) => { const a = subscribeDebug(cb), b = subscribeFlags(cb); return () => { a(); b(); }; },
    debugOn,
  );
}

export function DebugHud({ board, cursors }: SlotProps) {
  const on = useDebug();
  const cursorsRef = useRef(cursors.length);
  cursorsRef.current = cursors.length;
  const text = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!on) return;
    const sampler = startSampler(board.events);
    setLiveSampler(sampler);
    const tick = () => {
      const el = text.current;
      if (!el) return;
      const f = sampler.stats.snapshot();
      const env = activeBoard();
      const cam = env?.camera.getCam();
      const view = env?.camera.getViewSize();
      const vr = cam && view ? visibleWorldRect(cam, view) : null;
      const total = board.index.size;
      const mounted = typeof document === 'undefined' ? 0 : document.querySelectorAll('.pg-shape').length;
      const ops = sampler.ops.opsPerSec(Date.now());
      const byActor = Object.entries(sampler.ops.perActor()).map(([a, n]) => `${a}:${n}`).join(' ');
      const bad = f.p95Ms > BUDGET.p95Ms ? ' !' : '';
      el.textContent = [
        `fps ${f.fps.toFixed(0)}  p95 ${f.p95Ms.toFixed(1)}ms${bad}  p99 ${f.p99Ms.toFixed(1)}ms`,
        `long ${f.longFrames}  max ${f.maxMs.toFixed(0)}ms`,
        cam ? `cam ${cam.x.toFixed(0)}, ${cam.y.toFixed(0)}  z ${cam.z.toFixed(3)}` : 'cam -',
        vr ? `view ${vr.x.toFixed(0)},${vr.y.toFixed(0)} ${vr.w.toFixed(0)}x${vr.h.toFixed(0)}` : '',
        `shapes ${mounted}/${total} mounted`,
        `cursors ${cursorsRef.current}  dpr ${(globalThis.devicePixelRatio ?? 1).toFixed(1)}`,
        `ops ${ops.toFixed(0)}/s  total ${sampler.ops.total()}`,
        byActor ? byActor : '',
      ].filter(Boolean).join('\n');
    };
    tick();
    const timer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') tick(); }, TICK_MS);
    return () => { clearInterval(timer); setLiveSampler(null); sampler.stop(); };
  }, [on, board]);

  if (!on) return null;
  return (
    <pre
      ref={text}
      aria-hidden="true"
      data-pg-hud=""
      style={{
        position: 'fixed', right: 8, bottom: 8, zIndex: 9999, margin: 0, padding: '6px 8px', pointerEvents: 'none',
        font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--pg-code-ink)',
        background: 'var(--pg-ink)', borderRadius: 6, opacity: 0.92, whiteSpace: 'pre', userSelect: 'none',
      }}
    />
  );
}
