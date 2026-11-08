// Activity tab (storyboard G6 / H4): conversation timeline. Each conflict folds its
// detection, decision and pushes into one thread; other events sit on the rail between them.
import { useState } from 'react';
import type { CaseView, Entry, FeedEvent, Kind, Person } from './model.ts';
import { timeline } from './model.ts';
import { Avatar, Empty, Icon, KIND_COLOR, StatusLabel } from './ui.tsx';

const FILTERS: [Kind | 'all', string][] = [
  ['all', 'All activity'], ['plan', 'Plans'], ['claim', 'Claims'], ['change', 'Changes'],
  ['conflict', 'Conflicts'], ['decision', 'Decisions'], ['instruction', 'Pushes'],
];

export function ActivityTab({ events, cases, people }: { events: FeedEvent[]; cases: CaseView[]; people: Person[] }) {
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [who, setWho] = useState<string>();
  const shown = events.filter((e) => (filter === 'all' || e.kind === filter) && (!who || e.actor.id === who));
  const showThreads = filter === 'all' || filter === 'conflict' || filter === 'decision' || filter === 'instruction';
  const entries = timeline(shown, showThreads ? cases : []).filter((e) => e.type === 'event' || e.thread.items.length > 0 || filter === 'all' || filter === 'conflict');
  const count = (k: Kind | 'all') => (k === 'all' ? events.length : k === 'conflict' ? cases.length : events.filter((e) => e.kind === k).length);

  return (
    <div className="act-grid">
      <section className="card" style={{ padding: '18px 20px' }} aria-label="Activity">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18 }}>Activity</h2>
          <span className="muted" style={{ fontSize: 13 }}>Newest first · {events.length} events · {cases.length} conflict threads</span>
        </div>
        {!entries.length ? <Empty>Nothing to show{filter !== 'all' || who ? ' for this filter' : ' yet'}.</Empty> : (
          <div className="rail">{entries.map((e) => <EntryView key={e.type === 'event' ? e.event.key : 'case' + e.thread.case.key} e={e} />)}</div>
        )}
      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="card" style={{ padding: 16 }} aria-label="Filter">
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Filter</h3>
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className="filter" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              <Icon kind={k} color={k === 'all' ? 'var(--text)' : KIND_COLOR[k]} />
              <span className="grow">{label}</span>
              <span className="muted" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{count(k)}</span>
            </button>
          ))}
        </section>
        <section className="card" style={{ padding: 16 }} aria-label="People">
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>People</h3>
          {people.map((p) => (
            <button key={p.id} type="button" className="filter" aria-pressed={who === p.id} onClick={() => setWho(who === p.id ? undefined : p.id)}>
              <Avatar p={p} size={22} />
              <span className="grow">{p.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{events.filter((e) => e.actor.id === p.id).length} events</span>
            </button>
          ))}
        </section>
        <section className="card" style={{ padding: 16 }} aria-label="Conflict threads">
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Conflict threads</h3>
          {!cases.length && <Empty>None yet.</Empty>}
          {cases.map((c) => (
            <a key={c.key} href={`#/activity/conflict-${c.key}`} onClick={(ev) => { ev.preventDefault(); document.getElementById('conflict-' + c.key)?.scrollIntoView({ behavior: 'smooth' }); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none' }}>
              <Icon kind="conflict" color={c.open ? 'var(--warn)' : 'var(--ok)'} />
              <span className="grow" style={{ fontSize: 13 }}>#{c.key} <span className="mono" style={{ fontWeight: 600 }}>{c.symbol}</span></span>
              <span style={{ fontSize: 12, color: c.open ? 'var(--warn)' : 'var(--ok)' }}>{c.open ? 'open' : c.durationText ? 'resolved ' + c.durationText : c.status.toLowerCase()}</span>
            </a>
          ))}
        </section>
      </div>
    </div>
  );
}

function EntryView({ e }: { e: Entry }) {
  if (e.type === 'event') {
    const x = e.event;
    const compact = x.kind === 'claim' || x.kind === 'plan';
    return (
      <div className="ev" style={{ paddingBottom: compact ? 12 : 14 }}>
        <span className="ev-icon"><Icon kind={x.kind} size={15} width={1.7} /></span>
        <div style={{ minWidth: 0, paddingTop: 6 }}>
          <div style={{ fontSize: 14, lineHeight: '20px' }}>
            <Avatar p={x.actor} size={18} style={{ display: 'inline-grid', marginRight: 6, verticalAlign: -3 }} />
            <b style={{ fontWeight: 600 }}>{x.actor.name}</b> {x.verb}
            {compact && x.sub && <span className="muted" style={{ fontSize: 13 }}> · {x.sub}</span>}
          </div>
          {!compact && x.sub && <div className="subbox">{x.sub}</div>}
        </div>
        <span className="mono muted" style={{ fontSize: 12, paddingTop: 7 }}>{x.time}</span>
      </div>
    );
  }
  const { case: c, items } = e.thread;
  const color = c.open ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="thread" id={'conflict-' + c.key}>
      <span className="ev-icon" style={{ background: c.open ? 'var(--warn-soft)' : 'var(--danger-soft)', border: '2px solid var(--surface)' }}><Icon kind="conflict" color={color} size={16} width={1.7} /></span>
      <div className="thread-box" style={{ borderColor: c.open ? 'rgba(210,153,34,0.6)' : undefined }}>
        <div className="thread-head" style={{ background: c.open ? 'var(--warn-soft)' : undefined }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Conflict #{c.key}</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{c.symbol}</span>
          <span className="muted" style={{ fontSize: 13 }}>{c.kind}</span>
          {c.rule && <span className="pill">{c.rule}</span>}
          <span className="grow" />
          <StatusLabel status={c.status} dot={false} />
        </div>
        <div style={{ padding: '9px 12px 3px', fontSize: 13, lineHeight: 1.5 }}>{c.details}</div>
        <div style={{ padding: '2px 12px 6px' }}>
          {items.map((x) => (
            <div key={x.key} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0,1fr) auto', gap: 10, alignItems: 'start', padding: '4px 0' }}>
              <span style={{ marginTop: 3 }}><Icon kind={x.kind} /></span>
              <div style={{ fontSize: 13, lineHeight: 1.45, minWidth: 0 }}>
                <b style={{ fontWeight: 600 }}>{x.actor.name}</b> {x.kind === 'conflict' ? 'flagged it' : x.verb}
                {x.kind !== 'conflict' && x.sub && <span className="muted"> · {x.sub}</span>}
              </div>
              <span className="mono muted" style={{ fontSize: 11, lineHeight: '20px' }}>{x.time}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 12, color, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{c.open ? 'Coordinator is deciding · the agents involved are paused' : c.owner ? `Resolved${c.durationText ? ' in ' + c.durationText : ''} · ${c.owner.name} owns ${c.symbol}` : c.status}</span>
          <span className="mono muted" style={{ whiteSpace: 'nowrap' }}>opened {c.opened}</span>
        </div>
      </div>
    </div>
  );
}
