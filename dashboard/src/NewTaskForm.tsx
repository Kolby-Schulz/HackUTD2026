// "New task" form in the agents panel: assigns a free-form task to a worker started with
// `npm run worker -- --id <id> --wait` on any laptop. It calls create_task in the open run;
// the waiting worker picks the todo row up. `agents` should be only online ones (recent heartbeat).
import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@bindings/index.ts';
import type * as R from '@bindings/types.ts';
import type { AgentCard } from './model.ts';

export function NewTaskForm({ agents, openRun, tasks }: { agents: AgentCard[]; openRun?: R.Run; tasks: readonly R.Task[] }) {
  const createTask = useReducer(reducers.createTask);
  const free = agents.filter((a) => a.status === 'Idle' || a.status === 'Done');
  const [agentId, setAgentId] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const target = free.some((a) => a.id === agentId) ? agentId : free[0]?.id ?? '';
  const queued = openRun ? tasks.filter((t) => t.runId === openRun.id && t.status === 'todo') : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const description = text.trim();
    if (!openRun || !target || !description) return;
    setBusy(true);
    try {
      const title = description.length > 60 ? `${description.slice(0, 57)}...` : description;
      await createTask({ title, description, agentId: target, runId: openRun.id });
      setText('');
      setNote(`Assigned to ${target}. Its worker starts on it once it's running with --wait.`);
    } catch (err) {
      setNote(`Could not create the task: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!openRun) {
    return <div className="new-task muted">To assign tasks, start a session: <span className="mono">npm run session -- start</span></div>;
  }
  return (
    <form className="new-task" onSubmit={submit} aria-label="New task">
      <div className="cap muted">New task</div>
      {free.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>No free agent. On a laptop, run <span className="mono">npm run worker -- --id agent-b --wait</span></div>
      ) : (
        <>
          <select value={target} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
            {free.map((a) => <option key={a.id} value={a.id}>{a.id}{a.machine ? ` · ${a.machine}` : ''}</option>)}
          </select>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What should this agent build?" aria-label="Task" />
          <button type="submit" disabled={busy || !text.trim()}>{busy ? 'Assigning…' : 'Assign'}</button>
        </>
      )}
      {queued.map((t) => <div key={String(t.id)} className="muted ellipsis" style={{ fontSize: 12 }}>Queued for {t.agentId}: {t.title}</div>)}
      {note && <div className="muted" style={{ fontSize: 12 }}>{note}</div>}
    </form>
  );
}
