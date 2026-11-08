// Slot: DemoBar (AGENT-17). Play / Pause / Next / Reset, the current beat and the caption overlay.
// Shown with `?demo=1` or after the stage action; stage mode adds `pg-stage` to the page root (see styles/demo.css).
import { useEffect, useState, useSyncExternalStore } from 'react';
import '../styles/demo.css';
import { activeRunner, createDemoRunner, demoUi, realDemoClock, setActiveRunner } from '../agents/demo';
import type { DemoRunner } from '../agents/demo';
import { goTo } from '../core/goto';
import { toast } from '../core/toast';
import { DEMO } from './kit';
import type { SlotProps } from './slotProps';

const EMPTY = { status: 'idle', index: 0, total: 0, running: false, beat: '', caption: null, note: null } as const;

export function DemoBar({ board, rt }: SlotProps) {
  const ui = useSyncExternalStore(demoUi.subscribe, demoUi.get);
  const [runner, setRunner] = useState<DemoRunner | null>(null);

  useEffect(() => { if (DEMO) demoUi.set({ visible: true }); }, []);

  // one runner per mounted (board, runtime); StrictMode runs this twice, the cleanup disposes the first
  useEffect(() => {
    if (!rt) return;
    const r = createDemoRunner({
      board, rt, clock: realDemoClock,
      goTo: (t, o) => goTo(t, o),
      toast: (t) => toast(t),
    });
    setActiveRunner(r);
    setRunner(r);
    return () => { r.dispose(); if (activeRunner() === r) setActiveRunner(null); setRunner(null); };
  }, [board, rt]);

  // stage mode: one class on the page root
  useEffect(() => {
    const root = document.querySelector('.pg');
    root?.classList.toggle('pg-stage', ui.stage);
    return () => { root?.classList.remove('pg-stage'); };
  }, [ui.stage]);

  const s = useSyncExternalStore(runner?.subscribe ?? (() => () => {}), runner?.getState ?? (() => EMPTY));
  if (!ui.visible || !runner) return null;
  const playing = s.status === 'playing';
  return (
    <>
      <div className="pg-demo" role="toolbar" aria-label="Demo controls" data-pg-ui>
        <span className="beat" title={s.beat}>{s.beat || 'Demo'}</span>
        <span className="count">{Math.min(s.index + 1, s.total)}/{s.total}</span>
        <button className="primary" onClick={() => (playing ? runner.pause() : runner.play())} disabled={s.status === 'done'}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => runner.next()} title="Skip or run one step (N)" disabled={s.status === 'done'}>Next</button>
        <button onClick={() => runner.reset()}>Reset</button>
        {s.note && <span className="note">{s.note}</span>}
      </div>
      {s.caption && <div className="pg-caption" role="status" key={s.caption}>{s.caption}</div>}
    </>
  );
}
