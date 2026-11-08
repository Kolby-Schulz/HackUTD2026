// The comment box next to the clicked point; Enter sends to the routed agent. Reads the popover
// from the UI store itself and renders nothing while there is none.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MentionTextarea } from '../chat/MentionTextarea';
import { usePainter } from '../board/context';
import { w2v } from '../board/state';
import type { Popover as PopState } from '../board/state';
import { CLAUDE } from '../constants';
import type { Thread } from '../chat/ChatPanel';
import { useUi } from '../hooks';
import type { SlotProps } from '../slotProps';
import { ctxLabel, routeFor, routerAgents } from './route';
import '../../styles/comments.css';

export function CommentPopover({ ui, board, rt, threadOf, onSend }: SlotProps & {
  threadOf: (id: string) => Thread | undefined;
  onSend: (text: string, o: { shapeId: string; at: { x: number; y: number } }) => void;
}) {
  const pop = useUi(ui, 'pop');
  return pop ? <Popover pop={pop} ui={ui} board={board} rt={rt} threadOf={threadOf} onSend={onSend} /> : null;
}

function Popover({ pop, ui, board, rt, threadOf, onSend }: {
  pop: PopState;
  ui: SlotProps['ui']; board: SlotProps['board']; rt: SlotProps['rt'];
  threadOf: (id: string) => Thread | undefined;
  onSend: (text: string, o: { shapeId: string; at: { x: number; y: number } }) => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const route = useMemo(() => routeFor(board, rt, pop.shapeId), [board, rt, pop]);
  const agents = useMemo(() => routerAgents(board, rt), [board, rt, pop]);
  const [note, setNote] = useState('');
  // Focus now (the board prevents the mousedown default, so nothing steals it), and again once the
  // click that opened it has finished, in case something else took focus in between.
  useLayoutEffect(() => {
    input.current?.focus();
    const again = () => { if (document.activeElement !== input.current) input.current?.focus(); };
    const t = setTimeout(again, 0);
    window.addEventListener('pointerup', again, { once: true });
    window.addEventListener('click', again, { once: true });
    return () => { clearTimeout(t); window.removeEventListener('pointerup', again); window.removeEventListener('click', again); };
  }, [pop]);
  usePainter((cam) => {
    if (!ref.current) return;
    const v = w2v(cam, { x: pop.wx, y: pop.wy });
    ref.current.style.left = `${v.x + 14}px`;
    ref.current.style.top = `${v.y - 8}px`;
  });
  const s = board.doc.getState().shapes.get(pop.shapeId);
  if (!s) return null;
  const t = threadOf(route.thread);
  const close = () => ui.set({ pop: null });
  return (
    <form ref={ref} className="pg-pop" style={{ ['--c' as string]: t?.color ?? CLAUDE.color }}
      onSubmit={(e) => {
        e.preventDefault();
        const v = note.trim();
        if (v) onSend(v, { shapeId: pop.shapeId, at: { x: pop.wx, y: pop.wy } });
        close();
      }}>
      <div className="pg-pop-to">
        <i style={{ background: t?.color ?? CLAUDE.color }} />
        <b>to {t?.name ?? 'General'}</b>
        <small>({route.label})</small>
      </div>
      <div className="pg-pop-ctx">{ctxLabel(board, pop.shapeId)}</div>
      <MentionTextarea name="note" rows={2} inputRef={input} value={note} onChange={setNote} agents={agents}
        placeholder={`Ask ${t?.name ?? 'Claude'} to change this… (@ to mention)`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
          if (e.key === 'Escape') close();
        }} />
      <div className="pg-pop-foot">
        <span>Enter to send · auto-routed</span>
        <button type="submit" aria-label="Send">↑</button>
      </div>
    </form>
  );
}
