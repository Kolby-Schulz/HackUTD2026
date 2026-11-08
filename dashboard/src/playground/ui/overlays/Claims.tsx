// Overlay: dashed outline in the holder's colour around every live claim, tagged "Iris · Profile card".
// Mounted in the board's screen-space overlay layer. Shape/frame claims follow the shape; rect claims are static.
import { useEffect, useRef, useState } from 'react';
import { absRect } from '../../core/tree';
import type { Claim, Rect } from '../../core/types';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';

const FALLBACK = '#d97757';

export function Claims() {
  const { board } = useBoardEnv();
  const [claims, setClaims] = useState<Claim[]>(() => board.claims.list());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setClaims(board.claims.list());
    sync();
    const off = board.claims.subscribe(sync);
    const tick = setInterval(sync, 1000); // expiry without a write
    return () => { off(); clearInterval(tick); };
  }, [board]);

  const rectOf = (c: Claim): Rect | null => {
    if (c.target.kind === 'rect') return c.target;
    const st = board.doc.getState();
    const s = st.shapes.get(c.target.id);
    return s && !s.deleted ? absRect(st, c.target.id) : null;
  };

  usePainter((cam) => {
    const root = box.current;
    if (!root) return;
    for (const el of Array.from(root.children) as HTMLElement[]) {
      const c = claims.find((k) => k.id === el.dataset.claim);
      const r = c ? rectOf(c) : null;
      if (!r) { el.style.display = 'none'; continue; }
      const p = w2v(cam, r);
      el.style.display = '';
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.style.width = `${r.w * cam.z}px`;
      el.style.height = `${r.h * cam.z}px`;
    }
  });

  const label = (c: Claim) => {
    const name = board.actors.get(c.holder)?.name ?? c.holder;
    let what = c.reason;
    if (!what && c.target.kind !== 'rect') what = board.doc.getState().shapes.get(c.target.id)?.name;
    return what ? `${name} · ${what}` : name;
  };

  return (
    <div ref={box}>
      {claims.map((c) => {
        const color = board.actors.get(c.holder)?.color ?? FALLBACK;
        return (
          <div
            key={c.id}
            data-claim={c.id}
            style={{ position: 'absolute', left: 0, top: 0, boxSizing: 'border-box', pointerEvents: 'none', border: `2px dashed ${color}`, borderRadius: 4, background: `color-mix(in srgb, ${color} 5%, transparent)` }}
          >
            <span style={{ position: 'absolute', left: -2, top: -22, background: color, color: '#fff', whiteSpace: 'nowrap', fontWeight: 600, fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
              {'\u{1F512} '}{label(c)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
