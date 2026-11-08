// Changes tab: the actual code each agent wrote, as it lands (file_edit rows sent by
// contract-hook, issue #24), newest first, shown as diffs with line numbers like an editor's diff
// view. It follows the code map: selecting a symbol there filters this list to edits that touched
// it, and clicking a symbol here selects it on the map.
import { useState } from 'react';
import type { AgentCard, EditView } from './model.ts';

interface Line { kind: 'add' | 'del' | 'ctx' | 'hunk'; text: string; oldNo?: number; newNo?: number }

/** A unified diff as numbered rows (file headers dropped). */
export function diffLines(diff: string): Line[] {
  const out: Line[] = [];
  let o = 0, n = 0;
  for (const l of diff.split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|\\ No newline)/.test(l)) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
    if (h) { o = Number(h[1]); n = Number(h[2]); out.push({ kind: 'hunk', text: h[3].trim() || l }); continue; }
    if (l.startsWith('+')) out.push({ kind: 'add', text: l.slice(1), newNo: n++ });
    else if (l.startsWith('-')) out.push({ kind: 'del', text: l.slice(1), oldNo: o++ });
    else if (l !== '' || out.length) out.push({ kind: 'ctx', text: l.startsWith(' ') ? l.slice(1) : l, oldNo: o++, newNo: n++ });
  }
  while (out.length && out.at(-1)!.kind === 'ctx' && out.at(-1)!.text === '') out.pop();
  return out;
}

const SHOW = 60;

function Diff({ diff }: { diff: string }) {
  const [all, setAll] = useState(false);
  const lines = diffLines(diff);
  const shown = all ? lines : lines.slice(0, SHOW);
  return (
    <div className="dv" role="table" aria-label="Diff">
      {shown.map((l, i) => l.kind === 'hunk'
        ? <div key={i} className="dv-row hunk" role="row"><span className="dv-no" /><span className="dv-no" /><span className="dv-code">{l.text}</span></div>
        : (
          <div key={i} className={`dv-row ${l.kind}`} role="row">
            <span className="dv-no">{l.oldNo ?? ''}</span>
            <span className="dv-no">{l.newNo ?? ''}</span>
            <span className="dv-code"><span className="dv-sign" aria-hidden="true">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>{l.text}</span>
          </div>
        ))}
      {lines.length > SHOW && (
        <button type="button" className="dv-more" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show ${lines.length - SHOW} more lines`}</button>
      )}
    </div>
  );
}

export function ChangesView({ edits, agents, symbol, symbolName, onPickSymbol, onClearSymbol }: {
  edits: EditView[]; agents: AgentCard[]; symbol?: string; symbolName?: string;
  onPickSymbol: (id: string) => void; onClearSymbol: () => void;
}) {
  const [who, setWho] = useState<string>();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const shown = edits.filter((e) => (!who || e.agent.id === who) && (!symbol || e.symbolIds.includes(symbol)));
  const authors = agents.filter((a) => edits.some((e) => e.agent.id === a.id));
  // the three newest are open unless closed; older ones open on click
  const isOpen = (e: EditView, i: number) => (i < 3 ? !closed.has(e.id) : open.has(e.id));
  const toggle = (e: EditView, i: number) => {
    const flip = (s: Set<string>) => { const x = new Set(s); if (x.has(e.id)) x.delete(e.id); else x.add(e.id); return x; };
    if (i < 3) setClosed(flip); else setOpen(flip);
  };

  return (
    <div className="changes">
      <div className="changes-bar">
        <div className="targets" role="group" aria-label="Filter by agent">
          <button type="button" className="target" aria-pressed={!who} onClick={() => setWho(undefined)}>All agents</button>
          {authors.map((a) => (
            <button key={a.id} type="button" className="target" aria-pressed={who === a.id} onClick={() => setWho(who === a.id ? undefined : a.id)}>
              <span className="dot" style={{ background: who === a.id ? '#fff' : a.person.color }} />{a.person.name}
            </button>
          ))}
        </div>
        {symbol && (
          <span className="sym-filter">
            touching <b className="mono">{symbolName ?? symbol}</b>
            <button type="button" className="iconbtn" style={{ width: 20, height: 20 }} aria-label="Show changes to every symbol" title="Clear" onClick={onClearSymbol}>
              <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </span>
        )}
        <span className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>{shown.length} edit{shown.length === 1 ? '' : 's'}</span>
      </div>
      <div className="changes-list">
        {!edits.length && <div className="empty">No code yet. Each agent's edits show up here within a second, as a diff.</div>}
        {edits.length > 0 && !shown.length && <div className="empty">No edits match. {symbol ? 'Nothing in this run touched that symbol yet.' : ''}</div>}
        {shown.slice(0, 80).map((e, i) => {
          const on = isOpen(e, i);
          const parts = e.file.split('/');
          return (
            <section key={e.id} className="edit" aria-label={`${e.agent.name} edited ${e.file}`}>
              <button type="button" className="edit-head" aria-expanded={on} onClick={() => toggle(e, i)}>
                <svg className={'chev' + (on ? '' : ' closed')} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                <span className="sq" style={{ background: e.agent.color }} title={e.agent.name}>{e.agent.letter}</span>
                <span className="ellipsis grow"><b className="mono">{parts.at(-1)}</b> <span className="muted mono">{parts.slice(0, -1).join('/')}</span></span>
                <span className="stat mono">{e.stat}</span>
                <span className="mono muted" style={{ fontSize: 11 }}>{e.time.slice(0, 5)}</span>
              </button>
              {e.symbols.length > 0 && (
                <div className="edit-syms">
                  {e.symbolIds.map((id, k) => (
                    <button key={id} type="button" className={'sym-chip' + (id === symbol ? ' on' : '')} onClick={() => onPickSymbol(id)} title="Show on the code map">{e.symbols.at(k)}</button>
                  ))}
                </div>
              )}
              {on && <Diff diff={e.diff} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}
