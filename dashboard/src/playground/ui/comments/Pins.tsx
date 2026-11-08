// Numbered comment pins that follow their layer; a check once the agent has handled the note.
// Two sources: the legacy per-send pins (props) and the thread store (layer or point anchors,
// orphan ghosts, resolved hidden).
import { useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent } from 'react';
import { hitTest } from '../../core/hittest';
import { ageLabel } from './CommentList';
import { absRect } from '../../core/tree';
import { commentThreads } from '../../comments/threads';
import type { CommentThread } from '../../comments/threads';
import { usePainter, useBoardEnv } from '../board/context';
import { w2v } from '../board/state';
import { CLAUDE } from '../constants';
import type { Msg, Thread } from '../chat/ChatPanel';
import type { Pin } from './route';
import '../../styles/comments.css';

export function Pins({ pins, threads, messages, onOpen }: { pins: Pin[]; threads: Thread[]; messages: Msg[]; onOpen: (thread: string, msgId?: string) => void }) {
  const env = useBoardEnv();
  const els = useRef(new Map<string, HTMLButtonElement>());
  const store = commentThreads;
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const drag = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);
  const [card, setCard] = useState<string | null>(null); // thread shown in the hover preview (after 200 ms)
  const enter = (id: string) => { store.hover(id); clearTimeout(timer.current); timer.current = window.setTimeout(() => setCard(id), 200); };
  const leave = () => { store.hover(null); clearTimeout(timer.current); setCard(null); };
  /** World point under a pointer event (the pins layer shares the board's view space). */
  const worldAt = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect(), cam = env.camera.getCam();
    return { x: (e.clientX - r.left - cam.x) / cam.z, y: (e.clientY - r.top - cam.y) / cam.z };
  };
  const down = (id: string) => (e: PointerEvent) => { drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true; setCard(null);
    const el = e.currentTarget as HTMLElement, r = box.current!.getBoundingClientRect();
    el.style.left = `${e.clientX - r.left}px`; el.style.top = `${e.clientY - r.top}px`;
  };
  /** Drop: onto a layer re-anchors; an orphan dropped on empty canvas becomes a free pin. Click if it never moved. */
  const up = (id: string) => (e: PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (!d.moved) { store.open(id); return; }
    const w = worldAt(e), st = env.board.doc.getState();
    const hit = hitTest(st, env.board.index, w, { z: env.camera.getCam().z });
    if (hit) store.reanchor(st, id, hit, w);
    else if (store.place(st, id)?.orphan || store.get(id)?.anchor.kind === 'point') store.pinAt(id, w);
    env.paint.wake();
  };
  useSyncExternalStore(store.subscribe, () => store.version);
  const own = store.list().filter((t) => t.state !== 'resolved');
  usePainter((cam) => {
    const st = env.board.doc.getState();
    for (const p of pins) {
      const el = els.current.get(p.id);
      if (!el) continue;
      const s = st.shapes.get(p.shapeId);
      const r = s && !s.deleted ? absRect(st, p.shapeId) : null;
      if (!r) { el.style.display = 'none'; continue; }
      const v = w2v(cam, { x: r.x + p.dx, y: r.y + p.dy });
      el.style.display = '';
      el.style.left = `${v.x}px`;
      el.style.top = `${v.y}px`;
    }
    for (const t of own) {
      const el = els.current.get(t.id);
      if (!el) continue;
      const pl = store.place(st, t.id);
      if (!pl || pl.hidden) { el.style.display = 'none'; continue; }
      const v = w2v(cam, pl);
      el.style.display = '';
      el.style.left = `${v.x}px`;
      el.style.top = `${v.y}px`;
      el.classList.toggle('orphan', pl.orphan);
      el.classList.toggle('hot', store.hoverId === t.id);
    }
  });
  const ref = (id: string) => (el: HTMLButtonElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); };
  return (
    <div className="pg-pins" ref={box}>
      {pins.map((p) => {
        const t = threads.find((x) => x.id === p.thread);
        const msg = messages.find((m) => m.pin === p.id);
        return (
          <button key={p.id} className={'pg-pin' + (p.done ? ' done' : '')} title={msg?.text}
            ref={ref(p.id)}
            style={{ ['--c' as string]: t?.color ?? CLAUDE.color }}
            onClick={() => onOpen(p.thread, msg?.id)}>
            <span>{p.done ? '✓' : p.n}</span>
          </button>
        );
      })}
      {own.map((t) => (
        <button key={t.id} ref={ref(t.id)}
          style={{ ['--c' as string]: t.color }}
          className={'pg-pin' + (t.state === 'answered' ? ' done' : '') + (store.hoverId === t.id ? ' hot' : '')}
          onPointerDown={down(t.id)} onPointerMove={move} onPointerUp={up(t.id)}
          onPointerEnter={() => enter(t.id)} onPointerLeave={leave} onFocus={() => { store.hover(t.id); setCard(t.id); }} onBlur={leave}
          onKeyDown={(e) => { if (e.key === 'Enter') store.open(t.id); }}>
          <span>{t.state === 'answered' ? '✓' : t.n}</span>
          {card === t.id && store.openId !== t.id && <Preview t={t} />}
        </button>
      ))}
    </div>
  );
}

/** Hover card: author, last message (140 chars), replies, state, age. Flips below the pin near the top edge. */
function Preview({ t }: { t: CommentThread }) {
  const last = t.messages[t.messages.length - 1];
  const text = last ? (last.text.length > 140 ? last.text.slice(0, 139) + '…' : last.text) : 'Empty comment';
  return (
    <span className="pg-pin-card" role="tooltip">
      <b style={{ color: last?.color }}>{last?.name ?? 'Draft'}</b> <small>{t.state}{last ? ` · ${ageLabel(last.at)}` : ''}</small>
      <span className="x">{text}</span>
      {t.messages.length > 1 && <small>{t.messages.length - 1} {t.messages.length === 2 ? 'reply' : 'replies'}</small>}
    </span>
  );
}
