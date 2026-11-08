// Every styling idea at once, one slot each, so they can be judged together or taken one by one:
//   Live toasts      a conflict pops up the moment it is caught, and again when it resolves
//   Agents side bar  one-line cards, a clear Paused state, labelled token bars, short coordinator card
//   Code map         legend chips instead of a cut-off sentence, bigger names, pulsing conflict nodes
//   Savings panel    a taller hero strip with bigger numbers and a per-conflict timing chart
//   Status bar       a thin neutral bar with a live dot instead of a full-width blue bar
//   Chat             a one-line "no agent online" prompt instead of a full empty composer
// The title bar and Changes stay as they are (inherited from Current).
import { defineVariant } from '../../../variants/define.ts';
import { CodeMap } from '../../../CodeMap.tsx';
import { PaneHead } from '../../../Workbench.tsx';
import { fmtK, fmtSecs, resolveTimes } from '../../../model.ts';
import { demo } from '../fixture.ts';
import s from './proposed.module.css';

const noop = () => {};

/* ---------- 1. live toasts ---------- */
const Toasts = () => (
  <>
    <div className={`${s.toast} ${s.toastAlarm}`} role="status">
      <span className={s.toastIcon}>!</span>
      <div className={s.toastBody}>
        <b>Conflict caught · Rule 1</b>
        <span><span className="mono">calculateLateFee</span> changed under agent-b. agent-b paused.</span>
        <span className={s.toastMeta}>Coordinator deciding… <span className={s.dots} /></span>
      </div>
      <span className={s.toastTimer} />
    </div>
    <div className={`${s.toast} ${s.toastGood}`} role="status">
      <span className={s.toastIcon}>✓</span>
      <div className={s.toastBody}>
        <b>Resolved #2 in 22.2s</b>
        <span>agent-a owns <span className="mono">calculateFee</span>. agent-b resumed.</span>
      </div>
    </div>
  </>
);

/* ---------- 2. agents side bar ---------- */
const STATUS: Record<string, string> = { Working: s.stWorking, Paused: s.stPaused, Done: s.stDone, Deciding: s.stPaused, Idle: s.stIdle };

const Side = () => {
  const top = Math.max(1, ...demo.agents.map((a) => a.total));
  return (
    <>
      <PaneHead title="Agents" onClose={noop} />
      <div className="pane-body">
        <div className={s.runHead}><b>Run #2</b><span className="muted">1 working · 1 paused</span></div>
        {demo.agents.map((a) => {
          const paused = a.status === 'Paused';
          return (
            <div key={a.id} className={`${s.card} ${paused ? s.cardPaused : ''}`} style={{ ['--agent' as string]: a.person.color }}>
              <div className={s.cardTop}>
                <span className="sq" style={{ background: a.person.color }}>{a.person.letter}</span>
                <b className="ellipsis">{a.person.name}</b>
                <span className={`${s.status} ${STATUS[a.status] ?? s.stIdle}`}>{paused && <span className={s.pulseDot} />}{a.status}</span>
              </div>
              <div className={`${s.task} ellipsis`}>{a.task || 'No task yet'}</div>
              {paused
                ? <div className={s.banner}>Waiting on conflict #{a.waitingOn} · coordinator deciding</div>
                : <div className={`${s.doing} ellipsis`}>{a.lastEdit ? `editing ${a.lastEdit.file.split('/').pop()}` : a.claims.length ? `holds ${a.claims.join(', ')}` : 'planning'}</div>}
              <div className={s.meter}>
                <span className={s.track}><span style={{ width: `${(a.total / top) * 100}%`, background: a.person.color }} /></span>
                <span className="mono muted">{fmtK(a.total)} tokens</span>
              </div>
            </div>
          );
        })}
        <div className={`${s.card} ${s.coord}`}>
          <div className={s.cardTop}>
            <span className="sq" style={{ background: '#64748b' }}>C</span>
            <b>Coordinator</b>
            <span className={`${s.status} ${s.stPaused}`}><span className={s.pulseDot} />Deciding #3</span>
          </div>
          <div className={`${s.doing} ellipsis`}>Last: agent-a owns calculateFee · 22.2s</div>
          <div className={s.meter}><span className="mono muted">{fmtK(demo.coord.tokens)} tokens · InSync’s own cost</span></div>
        </div>
        <button type="button" className={s.quiet}>+ 3 registered agents waiting</button>
      </div>
    </>
  );
};

/* ---------- 3. code map ---------- */
const LEGEND: [string, string, string][] = [
  ['Planned', 'var(--text3)', 'dashed'], ['Claimed', 'var(--accent)', 'solid'], ['Changed', 'var(--warn)', 'solid'], ['Conflict', 'var(--danger)', 'solid'],
];
const Map = () => (
  <div className="view">
    <nav className="crumbs" aria-label="Run stage">
      <span>demo-repo</span><span>›&nbsp; <span className="done">Plan</span></span><span>›&nbsp; <span className="on">Code</span></span><span>›&nbsp; Merge</span>
      <span className="grow" />
      {LEGEND.map(([label, color, style]) => (
        <span key={label} className={s.legend}><span className={s.swatch} style={{ borderColor: color, borderStyle: style }} />{label}</span>
      ))}
    </nav>
    <div className={`editor ${s.map}`}><CodeMap nodes={demo.map.nodes} edges={demo.map.edges} coord={demo.focus} onSelect={noop} /></div>
  </div>
);

/* ---------- 4. savings panel ---------- */
const Panel = () => {
  const times = resolveTimes(demo.cases);
  const open = demo.cases.filter((c) => c.open).length;
  const resolved = demo.cases.length - open;
  const timed = demo.cases.filter((c) => c.resolvedMs !== undefined).slice().reverse();
  const slowest = Math.max(1, ...timed.map((c) => c.resolvedMs!));
  const { saved = 0, base = 0, current } = demo.savings;
  return (
    <div className={s.panel}>
      <div className="ptabs"><h2 className="ptitle">SAVINGS</h2></div>
      <div className={s.hero}>
        <button type="button" className={s.heroCard}>
          <span className="hd">Tokens saved</span>
          <span className={s.big} style={{ color: 'var(--accent)' }}>{fmtK(saved)}</span>
          <span className={s.bars}>
            <span className={s.barRow}><span className="muted">without</span><span className={s.track}><span style={{ width: '100%', background: 'var(--faint)' }} /></span><span className="mono">{fmtK(base)}</span></span>
            <span className={s.barRow}><b style={{ color: 'var(--accent)' }}>with</b><span className={s.track}><span style={{ width: `${(current / Math.max(1, base)) * 100}%`, background: 'var(--accent)' }} /></span><span className="mono">{fmtK(current)}</span></span>
          </span>
          <span className={s.cta}>See where they went →</span>
        </button>
        <button type="button" className={s.heroCard}>
          <span className="hd">Conflicts caught</span>
          <span className={s.bigRow}><span className={s.big}>{demo.cases.length}</span><span className={s.bump}>+1 just now</span></span>
          <span className={s.chips}>
            <span className={s.chipOk}>{resolved} resolved</span>
            <span className={s.chipBad}><span className={s.pulseDot} />{open} open</span>
          </span>
          <span className={s.cta}>Show #3 on the map →</span>
        </button>
        <button type="button" className={s.heroCard}>
          <span className="hd">Avg time to resolve</span>
          <span className={s.big} style={{ color: 'var(--ok)' }}>{times ? fmtSecs(times.avgMs) : '—'}</span>
          <span className={s.timing}>
            {timed.map((c) => (
              <span key={c.key} className={s.barRow}>
                <span className="mono muted">#{c.key}</span>
                <span className={s.track}><span style={{ width: `${(c.resolvedMs! / slowest) * 100}%`, background: 'var(--ok)' }} /></span>
                <span className="mono">{fmtSecs(c.resolvedMs!)}</span>
              </span>
            ))}
          </span>
          <span className={s.cta}>Show the slowest on the map →</span>
        </button>
      </div>
    </div>
  );
};

/* ---------- 5. status bar and chat ---------- */
const Statusbar = () => (
  <footer className={s.status2}>
    <span className={s.live}><span className={s.liveDot} />Live</span>
    <span>Run #2 · with InSync · seed 7</span>
    <span className="muted">2 agents</span>
    <span className="grow" />
    <span style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠ 1 open</span>
    <span className="muted">Stage: Code</span>
  </footer>
);

const Chat = () => (
  <div className="view chat-view">
    <div className="chat-log">
      {demo.events.slice(0, 7).map((e) => (
        <div key={e.key} className={'cmsg' + (e.kind === 'conflict' ? ' alarm' : e.kind === 'decision' ? ' good' : '')}>
          <div className="who"><span className="sq" style={{ background: e.actor.id === 'coordinator' ? '#64748b' : e.actor.color }}>{e.actor.letter}</span><span className="ellipsis">{e.actor.name}</span><time>{e.time.slice(0, 5)}</time></div>
          <div className="txt">{e.verb}{e.sub ? `: ${e.sub}` : ''}</div>
        </div>
      ))}
    </div>
    <div className={s.noAgent}>
      <span className="muted">No agent online to message.</span>
      <button type="button" className="btn" style={{ padding: '4px 10px', fontSize: 12 }}>Start an agent</button>
    </div>
  </div>
);

export default defineVariant({
  title: 'Proposed',
  note: 'Live toasts, clearer agent cards, a readable code map, a bigger savings strip, a lighter status bar and a one-line empty chat.',
  extends: 'current',
  slots: { toast: Toasts, side: Side, map: Map, panel: Panel, statusbar: Statusbar, chat: Chat },
});
