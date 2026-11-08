// Replay tab (issue #27): scrub through a finished run, or two side by side (e.g. without
// vs with Contract), and watch the code map, agent states, tokens and feed as they happened.
// Everything is rebuilt from the stored rows by model.replayAt(); nothing is re-run.
import { useEffect, useMemo, useState } from 'react';
import type * as R from '@bindings/types.ts';
import type { Tables } from './model.ts';
import { agentCards, codeMap, feed, fmtClock, fmtK, fmtUsd, ms, replayAt, replayMarks, runWindow, tokenStats } from './model.ts';
import { CodeMap } from './CodeMap.tsx';
import { Avatar, Empty } from './ui.tsx';

const SPEEDS = [1, 4, 16];
const TICK_MS = 100;

const duration = (r?: R.Run) => (r?.endedAt ? ms(r.endedAt) - ms(r.startedAt) : 0);
const label = (r: R.Run) => `run ${r.id} · ${r.mode === 'with_contract' ? 'with InSync' : 'without'}`;

export function ReplayTab({ live }: { live: Tables }) {
  const finished = live.runs.filter((r) => r.endedAt).slice().sort((a, b) => Number(b.id - a.id));
  const [aId, setA] = useState<string>();
  const [bId, setB] = useState<string>('none');
  const a = finished.find((r) => String(r.id) === aId) ?? finished.find((r) => r.mode === 'with_contract') ?? finished[0];
  const b = bId === 'none' ? undefined : finished.find((r) => String(r.id) === bId);
  const total = Math.max(duration(a), duration(b));
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((x) => {
      const next = x + TICK_MS * speed;
      if (next >= total) setPlaying(false);
      return Math.min(next, total);
    }), TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, total]);

  if (!a) return <section className="card" style={{ padding: 20 }}><Empty>No finished run yet. Replay works on runs that have ended.</Empty></section>;
  const marks = replayMarks(live, a);
  const pick = (set: (v: string) => void, value: string | undefined, allowNone: boolean) => (
    <select value={value ?? ''} onChange={(e) => { set(e.target.value); setT(0); setPlaying(false); }}>
      {allowNone && <option value="none">no comparison</option>}
      {finished.map((r) => <option key={String(r.id)} value={String(r.id)}>{label(r)} · {fmtClock(duration(r), false)}</option>)}
    </select>
  );

  return (
    <div className="replay">
      <section className="card replay-bar" aria-label="Replay controls">
        <label className="muted">Replay {pick(setA, String(a.id), false)}</label>
        <label className="muted">next to {pick(setB, bId, true)}</label>
        <div className="grow" />
        <button onClick={() => { if (t >= total) setT(0); setPlaying(!playing); }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</button>
        {SPEEDS.map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)} aria-pressed={speed === s}>{s}×</button>)}
        <span className="mono">T+{fmtClock(t, false)} / {fmtClock(total, false)}</span>
        <input type="range" min={0} max={Math.max(1, total)} step={100} value={t} onChange={(e) => { setT(Number(e.target.value)); setPlaying(false); }} aria-label="Time" style={{ flexBasis: '100%' }} />
        {marks.length > 0 && (
          <div className="chips" style={{ flexBasis: '100%' }}>
            <span className="muted" style={{ fontSize: 12 }}>Jump to</span>
            {marks.map((m) => <button key={m.label} className="chip" onClick={() => { setT(Math.max(0, m.at - 1500)); setPlaying(true); }}>{m.label} · {fmtClock(m.at, false)}</button>)}
          </div>
        )}
      </section>
      <div className="replay-cols" style={{ gridTemplateColumns: b ? '1fr 1fr' : '1fr' }}>
        <RunAt live={live} run={a} t={t} />
        {b && <RunAt live={live} run={b} t={t} />}
      </div>
    </div>
  );
}

function RunAt({ live, run, t }: { live: Tables; run: R.Run; t: number }) {
  const at = ms(run.startedAt) + Math.min(t, duration(run));
  const v = useMemo(() => {
    const past = replayAt(live, run, at);
    const r = past.runs.find((x) => x.id === run.id)!;
    const w = { ...runWindow(r, at), end: at };
    return {
      stats: tokenStats(past, r),
      map: codeMap(past, w, at),
      events: feed(past, w).slice(0, 6),
      agents: agentCards(past, r, at).filter((x) => x.status !== 'Idle'),
      conflicts: past.conflicts.filter((c) => ms(c.createdAt) >= ms(run.startedAt)),
    };
  }, [live, run, at]);
  const [sel, setSel] = useState<string>();
  const done = t >= duration(run);
  return (
    <section className="card replay-col" aria-label={label(run)}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ fontSize: 15 }}>{label(run)}</h3>
        <span className="muted" style={{ fontSize: 12 }}>{done ? 'ended' : `T+${fmtClock(Math.min(t, duration(run)), false)}`}</span>
      </div>
      <div className="replay-kpis">
        <div><span className="muted">Tokens</span><b>{fmtK(v.stats.total)}</b></div>
        <div><span className="muted">Wasted</span><b style={{ color: v.stats.wasted ? 'var(--warn)' : undefined }}>{fmtK(v.stats.wasted)}</b></div>
        <div><span className="muted">Cost</span><b>{fmtUsd(v.stats.cost)}</b></div>
        <div><span className="muted">Conflicts</span><b>{v.conflicts.filter((c) => c.status === 'resolved' || c.status === 'dismissed').length}<span className="muted" style={{ fontSize: 12 }}>{v.conflicts.some((c) => c.status === 'open' || c.status === 'resolving') ? ' + 1 open' : ''}</span></b></div>
      </div>
      <div className="chips">
        {v.agents.map((x) => <span key={x.id} className={'chip agent-' + x.status.toLowerCase()}><Avatar p={x.person} size={14} /> {x.person.name} · {x.status}</span>)}
      </div>
      <div style={{ height: 240 }}><CodeMap nodes={v.map.nodes} edges={v.map.edges} selected={sel} onSelect={setSel} /></div>
      <div className="replay-feed">
        {!v.events.length && <Empty>Nothing yet at this point.</Empty>}
        {v.events.map((e) => (
          <div key={e.key} className="ellipsis" style={{ fontSize: 12 }}>
            <span className="mono muted">{e.time}</span> <b>{e.actor.name}</b> {e.verb} <span className="muted">{e.sub}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
