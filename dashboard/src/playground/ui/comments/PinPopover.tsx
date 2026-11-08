// Thread popover opened from a pin: the conversation, a reply box, Resolve / Reopen.
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { commentThreads } from '../../comments/threads';
import { usePainter } from '../board/context';
import { w2v } from '../board/state';
import type { SlotProps } from '../slotProps';
import '../../styles/comments.css';

export function PinPopover({ board }: SlotProps) {
  const store = commentThreads;
  useSyncExternalStore(store.subscribe, () => store.version);
  const t = store.openId ? store.get(store.openId) : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const id = t?.id;
  useLayoutEffect(() => { input.current?.focus(); }, [id]);
  usePainter((cam) => {
    if (!ref.current || !id) return;
    const pl = store.place(board.doc.getState(), id);
    if (!pl) return;
    const v = w2v(cam, pl);
    ref.current.style.left = `${v.x + 14}px`;
    ref.current.style.top = `${v.y - 8}px`;
  });
  if (!t) return null;
  const close = () => { store.open(null); store.discardEmpty(); };
  const send = (el: HTMLTextAreaElement) => {
    const v = el.value.trim();
    if (!v) return;
    store.reply(t.id, { from: 'you', name: 'You', color: 'var(--pg-accent)', text: v });
    el.value = '';
  };
  return (
    <div ref={ref} className="pg-pop pg-thread" style={{ ['--c' as string]: t.color }}>
      <div className="pg-pop-to">
        <b>#{t.n}</b><small>{t.state}</small>
        <span className="pg-thread-actions">
          {t.state === 'resolved'
            ? <button type="button" onClick={() => store.reopen(t.id)}>Reopen</button>
            : <button type="button" aria-label="Resolve" onClick={() => { store.resolve(t.id); store.open(null); }}>✓ Resolve</button>}
          <button type="button" aria-label="Close" onClick={close}>×</button>
        </span>
      </div>
      <div className="pg-thread-msgs">
        {t.messages.map((m) => <p key={m.id}><b style={{ color: m.color }}>{m.name}</b> {m.text}</p>)}
      </div>
      <textarea ref={input} rows={2} placeholder="Reply…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.currentTarget); }
          if (e.key === 'Escape') close();
        }} />
    </div>
  );
}
