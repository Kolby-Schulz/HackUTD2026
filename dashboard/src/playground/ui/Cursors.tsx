// Every cursor: agents and API cursors from presence (world coords), yours from the pointer.
import { useRef } from 'react';
import { useBoardEnv, usePainter } from './board/context';
import { w2v } from './board/state';
import { ARROW, YOU_COLOR } from './constants';
import { useUi } from './hooks';
import { statusOf } from './meta';
import type { Meta } from './meta';
import '../styles/cursors.css';

export function Cursors({ cursors }: { cursors: Meta[] }) {
  const env = useBoardEnv();
  const tool = useUi(env.ui, 'tool');
  const els = useRef(new Map<string, HTMLDivElement>());
  usePainter((cam) => {
    for (const [id, el] of els.current) {
      const p = env.board.presence.get(id);
      if (id === env.board.me) {
        el.style.transform = `translate3d(${env.pointer.x}px, ${env.pointer.y}px, 0)`;
        el.style.opacity = env.pointer.inside ? '1' : '0';
        el.classList.toggle('down', !!p?.down);
        continue;
      }
      if (p?.x === undefined || p.y === undefined) { el.style.opacity = '0'; continue; }
      const v = w2v(cam, { x: p.x, y: p.y });
      el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0)`;
      el.style.opacity = '1';
      el.classList.toggle('down', !!p.down);
    }
  });
  return (
    <div className="pg-cursors">
      {cursors.map((c) => {
        const human = c.kind === 'human';
        const status = statusOf(c);
        return (
          <div key={c.id} className={'pg-cursor' + (human ? ' human' : '') + (human && tool === 'comment' ? ' bubble' : '')}
            ref={(el) => { if (el) els.current.set(c.id, el); else els.current.delete(c.id); }}
            style={{ ['--c' as string]: human ? YOU_COLOR : c.color, opacity: 0 }}>
            <svg className="arrow" width="22" height="24" viewBox="0 0 22 24" aria-hidden="true"><path d={ARROW} /></svg>
            {human && <svg className="bub" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V11a8 8 0 1 1 8 8H3z" /></svg>}
            <span className="pg-tag">{c.name}{!human && status !== 'idle' ? <em> · {status}</em> : null}</span>
          </div>
        );
      })}
    </div>
  );
}
