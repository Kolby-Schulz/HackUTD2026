// "Judge task" (issue #29): a judge types a task during the demo; the judge agent
// (`npm run judge` on a laptop) picks it up and Contract coordinates it with the agents
// already running. Guard rails live in scripts/judge.ts (time, tokens, allowed folders).
import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@bindings/index.ts';
import type * as R from '@bindings/types.ts';

export const JUDGE_ID = 'agent-judge';
export const JUDGE_MAX_CHARS = 300;

const STATE: Record<string, string> = {
  todo: 'Queued: the judge agent picks it up in a few seconds',
  in_progress: 'The judge agent is working on it',
  paused: 'Paused by Contract: it collided with another agent; the coordinator is deciding',
  done: 'Done',
  discarded: 'Stopped by a guard rail (time or token limit)',
};

export function JudgeBox({ openRun, tasks, online }: { openRun?: R.Run; tasks: readonly R.Task[]; online: boolean }) {
  const createTask = useReducer(reducers.createTask);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const mine = openRun ? tasks.filter((t) => t.runId === openRun.id && t.agentId === JUDGE_ID).sort((a, b) => Number(b.id - a.id)) : [];
  const latest = mine[0];
  const busyNow = latest && (latest.status === 'todo' || latest.status === 'in_progress' || latest.status === 'paused');

  if (!openRun || !online) return null; // only when `npm run judge` is running in an open run

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const description = text.trim();
    if (!description || !openRun) return;
    setBusy(true);
    setError(undefined);
    try {
      const title = description.length > 60 ? `${description.slice(0, 57)}...` : description;
      await createTask({ title, description, agentId: JUDGE_ID, runId: openRun.id });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="judge" aria-label="Judge task">
      <div className="cap" style={{ color: 'var(--accent)' }}>Your turn: give a third agent a task</div>
      {latest && (
        <div style={{ fontSize: 12 }}>
          <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>“{latest.title}”</span>
          <span className="muted">{STATE[latest.status] ?? latest.status}</span>
        </div>
      )}
      {!busyNow && (
        <form onSubmit={submit}>
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, JUDGE_MAX_CHARS))} rows={2}
            placeholder="e.g. add a discount code to checkout" aria-label="Judge task" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="muted grow" style={{ fontSize: 11 }}>{text.length}/{JUDGE_MAX_CHARS} · time and token limits apply</span>
            <button type="submit" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Start'}</button>
          </div>
        </form>
      )}
      {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
    </section>
  );
}
