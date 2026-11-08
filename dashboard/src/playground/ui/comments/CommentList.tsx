// Slot: CommentList (COMMENT-7). All comment threads with filters (open / resolved, mine, orphaned, per agent).
// Click a row to jump to its pin and open the thread; hovering a row highlights the pin. Orphans (layer
// deleted) stay listed so they are not lost. Renders nothing when there are no threads.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { commentThreads } from '../../comments/threads';
import type { CommentThread, ThreadFilter } from '../../comments/threads';
import { goTo, goToShape } from '../../core/goto';
import type { SlotProps } from '../slotProps';
import '../../styles/comments.css';

/** Threads whose layer is gone and that are not resolved yet. */
export function orphanThreads(view: Parameters<typeof commentThreads.place>[0], threads: readonly CommentThread[] = commentThreads.list()) {
  return threads.filter((t) => t.state !== 'resolved' && t.anchor.kind === 'layer' && commentThreads.place(view, t.id)?.orphan);
}

/** "now", "5m", "3h", "2d". */
export function ageLabel(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const STATES = ['open', 'resolved', 'all'] as const;

export function CommentList({ board }: SlotProps) {
  const store = commentThreads;
  useSyncExternalStore(store.subscribe, () => store.version);
  const [docVer, setDocVer] = useState(0); // orphan status depends on the document
  useEffect(() => board.doc.subscribe(() => setDocVer((v) => v + 1)), [board]);
  const [state, setState] = useState<ThreadFilter['state']>('open');
  const [mine, setMine] = useState(false);
  const [orphaned, setOrphaned] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);

  const view = board.doc.getState();
  const all = store.list();
  const chats = useMemo(() => [...new Set(all.map((t) => t.chat))], [all]);
  const rows = useMemo(
    () => store.filter({ state, mine, orphaned, agents }, view),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, state, mine, orphaned, agents, docVer],
  );
  if (!all.length) return null;

  const jump = (t: CommentThread) => {
    const v = board.doc.getState();
    const pl = store.place(v, t.id);
    if (t.anchor.kind === 'layer' && !pl?.orphan) goToShape(v, t.anchor.shapeId);
    else if (pl) goTo({ x: pl.x - 100, y: pl.y - 100, w: 200, h: 200 });
    store.open(t.id);
  };
  const toggleAgent = (id: string) => setAgents((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  return (
    <section className="pg-orphans pg-clist" aria-label="Comments">
      <h4>Comments ({rows.length}/{all.length})</h4>
      <div className="pg-cl-filters" role="group" aria-label="Comment filters">
        {STATES.map((s) => (
          <button key={s} type="button" aria-pressed={state === s} onClick={() => setState(s)}>{s}</button>
        ))}
        <button type="button" aria-pressed={mine} onClick={() => setMine(!mine)}>mine</button>
        <button type="button" aria-pressed={orphaned} onClick={() => setOrphaned(!orphaned)}>orphaned</button>
        {chats.length > 1 && chats.map((c) => (
          <button key={c} type="button" aria-pressed={agents.includes(c)} onClick={() => toggleAgent(c)}>{c}</button>
        ))}
      </div>
      {rows.length === 0 ? <p className="pg-cl-empty">No comments match these filters.</p> : (
        <ul>
          {rows.map((t) => {
            const last = t.messages[t.messages.length - 1];
            const orphan = t.anchor.kind === 'layer' && store.place(view, t.id)?.orphan;
            return (
              <li key={t.id} className={'pg-cl-row' + (t.state === 'resolved' ? ' resolved' : '') + (store.hoverId === t.id ? ' hot' : '')}
                style={{ ['--c' as string]: t.color }}
                onMouseEnter={() => store.hover(t.id)} onMouseLeave={() => store.hover(null)}>
                <span className="n">{t.n}</span>
                <button type="button" className="t" title={last?.text} onClick={() => jump(t)}>
                  {last?.text ?? 'Empty comment'}
                </button>
                <small>{orphan ? 'deleted · ' : ''}{t.chat}{last ? ` · ${ageLabel(last.at)}` : ''}</small>
                {t.state === 'resolved'
                  ? <button type="button" onClick={() => store.reopen(t.id)}>Reopen</button>
                  : <button type="button" onClick={() => store.resolve(t.id)}>Resolve</button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
