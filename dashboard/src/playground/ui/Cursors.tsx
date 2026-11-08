// Every cursor: agents and API cursors from presence (world coords), yours from the pointer.
// Painted imperatively once per frame (usePainter); React only renders when the actor list changes.
import { useEffect, useMemo, useRef } from 'react';
import { useBoardEnv, usePainter } from './board/context';
import { w2v } from './board/state';
import { ARROW, YOU_COLOR } from './constants';
import { useUi } from './hooks';
import { statusOf } from './meta';
import type { Meta } from './meta';
import { badgeOf, contrastOnWhite, needsBadge, resolveColors } from '../presence/colors';
import { DRAW_LOCAL_CURSOR, createSmoother } from '../presence/cursors';
import type { Smoother } from '../presence/cursors';
import '../styles/cursors.css';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const STILL_MS = 4000;          // tag dims after this long without motion
const IDLE_MS = 20000;          // idle agents dim after this long

// 14px glyphs on a 24 grid, stroke only. Tools for people, state icons for agents.
const GLYPHS: Record<string, string> = {
  select: 'M5 3l0 15 4-4 3 7 3-1-3-7 6 0z',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5a8 7 0 1 0 .01 0z',
  text: 'M6 5h12M12 5v14M9 19h6',
  comment: 'M4 20V11a7 7 0 1 1 7 7H4z',
  hand: 'M8 12V6a1.5 1.5 0 0 1 3 0v5V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.5-1.5z',
  pen: 'M4 20l1-5L16 4l4 4L9 19z',
  thinking: 'M5 12h.01M12 12h.01M19 12h.01',
  drawing: 'M4 20l1-5L16 4l4 4L9 19z',
  waiting: 'M12 5v7l4 3M12 3a9 9 0 1 0 .01 0z',
  blocked: 'M12 3a9 9 0 1 0 .01 0zM6 6l12 12',
  paused: 'M9 5v14M15 5v14',
  stopped: 'M6 6h12v12H6z',
  error: 'M12 4v10M12 19h.01',
};
const KEYS = Object.keys(GLYPHS);
const TOOL_ALIAS: Record<string, string> = { v: 'select', move: 'select', frame: 'rect', rectangle: 'rect', oval: 'ellipse', circle: 'ellipse', hand: 'hand', pan: 'hand', pencil: 'pen', draw: 'pen' };
const STATE_GLYPH: Record<string, string> = { thinking: 'thinking', drawing: 'drawing', waiting_user: 'waiting', waiting_agent: 'waiting', blocked: 'blocked', paused: 'paused', stopped: 'stopped', error: 'error' };

/** Which glyph a cursor shows: the status icon for working agents, else the current tool. */
export function glyphFor(kind: Meta['kind'], state: string | undefined, tool: string | undefined): string {
  if (kind !== 'human' && state && STATE_GLYPH[state]) return STATE_GLYPH[state];
  const t = tool ? TOOL_ALIAS[tool] ?? tool : 'select';
  return GLYPHS[t] ? t : 'select';
}

export function Cursors({ cursors }: { cursors: Meta[] }) {
  const env = useBoardEnv();
  const tool = useUi(env.ui, 'tool');
  const els = useRef(new Map<string, HTMLDivElement>());
  const smoothers = useRef(new Map<string, Smoother>());
  const sticky = useRef(new Map<string, string>());
  const shown = useMemo(() => (DRAW_LOCAL_CURSOR ? cursors : cursors.filter((c) => c.id !== env.board.me)), [cursors, env]);
  const colors = useMemo(() => resolveColors(shown.filter((c) => c.kind !== 'human').map((c) => ({ id: c.id, color: c.color })), sticky.current), [shown]);

  // samples are stamped with arrival time (never remote wall-clock) and fed to each actor's smoother
  useEffect(() => {
    const feed = (all: ReadonlyMap<string, { x?: number; y?: number }>) => {
      const t = now();
      for (const [id, p] of all) {
        if (p.x === undefined || p.y === undefined) continue;
        let s = smoothers.current.get(id);
        if (!s) { s = createSmoother(); smoothers.current.set(id, s); }
        s.push(p.x, p.y, t);
      }
    };
    const rows = new Map<string, { x?: number; y?: number }>();
    for (const c of cursors) { const p = env.board.presence.get(c.id); if (p) rows.set(c.id, p); }
    feed(rows);
    return env.board.presence.subscribe(feed);
  }, [env]); // eslint-disable-line react-hooks/exhaustive-deps

  usePainter((cam) => {
    const t = now();
    for (const [id, el] of els.current) {
      const p = env.board.presence.get(id);
      if (id === env.board.me) {
        el.style.transform = `translate3d(${env.pointer.x}px, ${env.pointer.y}px, 0)`;
        el.style.opacity = env.pointer.inside ? '1' : '0';
        el.classList.toggle('down', !!p?.down);
        continue;
      }
      const sm = p?.x === undefined || p.y === undefined ? null : smoothers.current.get(id)?.at(t) ?? null;
      if (!sm) { el.style.opacity = '0'; continue; }
      const v = w2v(cam, { x: sm.x, y: sm.y });
      el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0)`;
      const still = t - sm.movedAt > STILL_MS;
      const idle = !p!.state || p!.state === 'idle';
      el.style.opacity = String(sm.fade < 1 ? sm.fade : idle && t - sm.movedAt > IDLE_MS ? 0.45 : 1);
      el.classList.toggle('still', still);
      el.classList.toggle('down', !!p!.down);
      const g = glyphFor('agent', p!.state, p!.tool);
      if (el.dataset.glyph !== g) el.dataset.glyph = g;
    }
  });

  useEffect(() => {
    const live = new Set(cursors.map((c) => c.id));
    for (const id of [...smoothers.current.keys()]) if (!live.has(id)) smoothers.current.delete(id);
  }, [cursors]);

  return (
    <div className="pg-cursors">
      {shown.map((c) => {
        const human = c.kind === 'human';
        const status = statusOf(c);
        const color = human ? YOU_COLOR : colors.get(c.id) ?? c.color;
        const light = contrastOnWhite(color) < 3;
        return (
          <div key={c.id} className={'pg-cursor' + (human ? ' human' : '') + (human && tool === 'comment' ? ' bubble' : '') + (light ? ' light' : '')}
            ref={(el) => { if (el) els.current.set(c.id, el); else els.current.delete(c.id); }}
            data-glyph={human ? tool : glyphFor(c.kind, c.state, undefined)}
            style={{ ['--c' as string]: color, opacity: 0 }}>
            <svg className="arrow" width="22" height="24" viewBox="0 0 22 24" aria-hidden="true"><path d={ARROW} /></svg>
            {human && <svg className="bub" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V11a8 8 0 1 1 8 8H3z" /></svg>}
            <span className="pg-tag">
              {!human && needsBadge(color) && <b className="badge">{badgeOf(c.name)}</b>}
              <span className="glyphs" aria-hidden="true">
                {KEYS.map((k) => <svg key={k} className={'g g-' + k} width="14" height="14" viewBox="0 0 24 24"><path d={GLYPHS[k]} /></svg>)}
              </span>
              <span className="nm">{c.name}</span>{!human && status !== 'idle' ? <em> · {status}</em> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
