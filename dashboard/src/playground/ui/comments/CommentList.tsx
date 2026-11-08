// Slot: CommentList. Lists the comment threads whose layer was deleted (orphans) so they are not lost;
// resolve one to dismiss it, or open it to read the conversation. Renders nothing when there are none.
import { useEffect, useState } from 'react';
import { commentThreads } from '../../comments/threads';
import type { CommentThread } from '../../comments/threads';
import type { SlotProps } from '../slotProps';
import '../../styles/comments.css';

/** Threads whose layer is gone and that are not resolved yet. */
export function orphanThreads(view: Parameters<typeof commentThreads.place>[0], threads: readonly CommentThread[] = commentThreads.list()) {
  return threads.filter((t) => t.state !== 'resolved' && t.anchor.kind === 'layer' && commentThreads.place(view, t.id)?.orphan);
}

export function CommentList({ board }: SlotProps) {
  const [rows, setRows] = useState<CommentThread[]>([]);
  useEffect(() => {
    const update = () => setRows((prev) => {
      const next = orphanThreads(board.doc.getState());
      return prev.length === next.length && prev.every((t, i) => t === next[i]) ? prev : next;
    });
    update();
    const offs = [commentThreads.subscribe(update), board.doc.subscribe(update)];
    return () => offs.forEach((f) => f());
  }, [board]);
  if (!rows.length) return null;
  return (
    <section className="pg-orphans" aria-label="Comments on deleted layers">
      <h4>Deleted layers ({rows.length})</h4>
      <ul>
        {rows.map((t) => (
          <li key={t.id} style={{ ['--c' as string]: t.color }}>
            <span className="n">{t.n}</span>
            <span className="t" title={t.messages[0]?.text}>{t.messages[0]?.text ?? 'Empty comment'}</span>
            <button type="button" onClick={() => commentThreads.open(t.id)}>Open</button>
            <button type="button" onClick={() => commentThreads.resolve(t.id)}>Resolve</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
