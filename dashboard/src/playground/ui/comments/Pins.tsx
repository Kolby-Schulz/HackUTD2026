// Numbered comment pins that follow their layer; a check once the agent has handled the note.
// Two sources: the legacy per-send pins (props) and the thread store (layer or point anchors,
// orphan ghosts, resolved hidden).
import { useRef, useSyncExternalStore } from 'react';
import { absRect } from '../../core/tree';
import { commentThreads } from '../../comments/threads';
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
      el.title = pl.orphan ? 'Layer deleted' : t.messages[0]?.text ?? '';
    }
  });
  const ref = (id: string) => (el: HTMLButtonElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); };
  return (
    <div className="pg-pins">
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
        <button key={t.id} className={'pg-pin' + (t.state === 'answered' ? ' done' : '')} ref={ref(t.id)}
          style={{ ['--c' as string]: t.color }} onClick={() => store.open(t.id)}>
          <span>{t.state === 'answered' ? '✓' : t.n}</span>
        </button>
      ))}
    </div>
  );
}
