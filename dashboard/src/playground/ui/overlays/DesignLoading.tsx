// Overlay: a shimmering skeleton on every frame an agent is still designing (a live design claim, no layers yet),
// labelled "Claude 3 is designing…". It goes away when the first layer arrives or the claim is released.
import { useEffect, useRef, useState } from 'react';
import { absRect } from '../../core/tree';
import { designClaims, loadingFrames } from '../../net/designClaims';
import type { LoadingFrame } from '../../net/designClaims';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';

const BOARD = 'playground';
const nowMicros = () => BigInt(Date.now()) * 1000n;

export function DesignLoading() {
  const { board } = useBoardEnv();
  const [frames, setFrames] = useState<LoadingFrame[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setFrames(loadingFrames(designClaims.list(), board.doc.getState(), BOARD, nowMicros()));
    sync();
    const offClaims = designClaims.subscribe(sync);
    const offDoc = board.doc.subscribe(sync);
    const tick = setInterval(sync, 1000); // a claim can expire without a write
    return () => { offClaims(); offDoc(); clearInterval(tick); };
  }, [board]);

  usePainter((cam) => {
    const root = box.current;
    if (!root) return;
    const st = board.doc.getState();
    for (const el of Array.from(root.children) as HTMLElement[]) {
      const id = el.dataset.frame;
      const r = id && st.shapes.get(id) ? absRect(st, id) : null;
      if (!r) { el.style.display = 'none'; continue; }
      const p = w2v(cam, r);
      el.style.display = '';
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.style.width = `${r.w * cam.z}px`;
      el.style.height = `${r.h * cam.z}px`;
    }
  });

  return (
    <div ref={box}>
      {frames.map((f) => {
        const a = board.actors.get(f.holder);
        return (
          <div key={f.frameId} data-frame={f.frameId} className="pg-loading" style={{ ['--c' as string]: a?.color }} role="status">
            <span className="pg-loading-bar w60" /><span className="pg-loading-bar w90" /><span className="pg-loading-bar w40" />
            <span className="pg-loading-card" />
            <span className="pg-loading-label">{a?.name ?? 'An agent'} is designing…</span>
          </div>
        );
      })}
    </div>
  );
}
