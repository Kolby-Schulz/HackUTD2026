// Code tab (issue #24, spec-additions-live-code part A): each agent's edits as they land,
// one column per agent, newest first. Rows come from file_edit (sent by contract-hook).
import type { AgentCard, EditView } from './model.ts';
import { Avatar, Empty } from './ui.tsx';

export function CodeTab({ agents, edits }: { agents: AgentCard[]; edits: EditView[] }) {
  const ids = [...new Set([...agents.map((a) => a.id), ...edits.map((e) => e.agent.id)])].filter((id) => edits.some((e) => e.agent.id === id));
  if (!edits.length) {
    return <section className="card" style={{ padding: 20 }}><Empty>No edits yet. Each agent's Edit/Write shows up here within a second, as a diff.</Empty></section>;
  }
  return (
    <div className="code-grid" style={{ gridTemplateColumns: `repeat(${Math.min(ids.length, 3)}, minmax(0, 1fr))` }}>
      {ids.map((id) => {
        const mine = edits.filter((e) => e.agent.id === id);
        const p = mine[0].agent;
        return (
          <section key={id} className="card code-col" aria-label={`${p.name} edits`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Avatar p={p} size={22} /><h3 style={{ fontSize: 15 }}>{p.name}</h3>
              <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{mine.length} edit{mine.length === 1 ? '' : 's'}</span>
            </div>
            {mine.slice(0, 12).map((e) => <EditCard key={e.id} e={e} />)}
          </section>
        );
      })}
    </div>
  );
}

export function EditCard({ e, showAgent = false }: { e: EditView; showAgent?: boolean }) {
  return (
    <div className="edit-card">
      <div className="edit-head">
        {showAgent && <span style={{ color: e.agent.color, fontWeight: 600 }}>{e.agent.name}</span>}
        <span className="mono ellipsis grow">{e.file}</span>
        <span className="mono muted">{e.stat}</span>
        <span className="mono muted">{e.time}</span>
      </div>
      {e.symbols.length > 0 && <div className="chips" style={{ margin: '4px 0' }}>{e.symbols.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
      <DiffView diff={e.diff} />
    </div>
  );
}

/** A unified diff with added/removed lines highlighted (file headers dropped). */
export function DiffView({ diff, maxLines = 40 }: { diff: string; maxLines?: number }) {
  const lines = diff.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|\\ No newline)/.test(l) && l !== '');
  return (
    <pre className="diff" aria-label="Diff">
      {lines.slice(0, maxLines).map((l, i) => (
        <div key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : undefined}>{l}</div>
      ))}
      {lines.length > maxLines && <div className="hunk">… {lines.length - maxLines} more lines</div>}
    </pre>
  );
}
