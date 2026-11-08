// Dashboard (spec section 13). Owner: dashboard + demo.
// Tabs from the storyboard: Live (row G), Activity (G6), Tokens (F4), Scoreboard (F5).
// The agents column stays on every tab. Everything comes from live subscriptions.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useLive, SPACETIME_DB_NAME, SPACETIME_HOST } from './data.ts';
import { agentCards, cases, codeMap, coordinator, edits, feed, fmtClock, latestRun, modeSummary, people, runWindow, tokenStats } from './model.ts';
import { AgentsPanel } from './AgentsPanel.tsx';
import { LiveTab } from './LiveTab.tsx';
import { ActivityTab } from './ActivityTab.tsx';
import { TokensTab } from './TokensTab.tsx';
import { ScoreboardTab } from './ScoreboardTab.tsx';
import { CodeTab } from './CodeTab.tsx';
import { ReplayTab } from './ReplayTab.tsx';
import { APP_NAME, Intro, LanesMark, shouldPlayIntro } from './Intro.tsx';
import { ControlTab, useControlRepo } from './ControlTab.tsx';

type Tab = 'live' | 'code' | 'activity' | 'tokens' | 'scoreboard' | 'replay' | 'chat';
const TABS: [Tab, string][] = [['live', 'Live'], ['chat', 'Chat'], ['code', 'Code'], ['activity', 'Activity'], ['tokens', 'Tokens'], ['scoreboard', 'Scoreboard'], ['replay', 'Replay']];

function useHashTab(): Tab {
  const read = (): Tab => {
    const h = location.hash.replace(/^#\/?/, '').split('/')[0];
    return (TABS.find(([k]) => k === h)?.[0]) ?? 'live';
  };
  const [tab, setTab] = useState<Tab>(read);
  useEffect(() => {
    const on = () => setTab(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return tab;
}

export function App() {
  const live = useLive();
  const tab = useHashTab();
  const [intro, setIntro] = useState(shouldPlayIntro);
  const endIntro = useCallback(() => setIntro(false), []);
  const [runPick, setRunPick] = useState<string>('latest');
  const run = runPick === 'latest' ? latestRun(live.runs) : live.runs.find((r) => String(r.id) === runPick);
  const { now } = live;
  const w = runWindow(run, now);

  const view = useMemo(() => {
    const cs = cases(live, w);
    const ppl = people(live.agents);
    return {
      agents: agentCards(live, run, now),
      coord: coordinator(live, run, now),
      cases: cs,
      events: feed(live, w),
      edits: edits(live, w),
      map: codeMap(live, w, now),
      stats: tokenStats(live, run),
      without: modeSummary(live, 'without_contract', now),
      withC: modeSummary(live, 'with_contract', now),
      people: [...ppl.values()],
    };
    // `now` ticks every second; the tables change only when the server pushes rows
  }, [live, run, now, w.start, w.end]);

  const repoLabel = useControlRepo();
  const clock = run ? fmtClock(w.end - w.start, false) : '00:00';
  const runs = live.runs.slice().sort((a, b) => Number(b.id - a.id));

  return (
    <div className={'app' + (tab === 'live' ? ' fit' : '')}>
      <AnimatePresence>{intro && <Intro key="intro" onDone={endIntro} />}</AnimatePresence>
      <header className="topnav">
        <div className="brand">
          <button className="logo-btn" onClick={() => setIntro(true)} aria-label="Replay intro" title="Replay intro"><LanesMark /></button>
          {APP_NAME}
        </div>
        <span className="vsep" />
        <label className="runsel">
          {repoLabel && <><span className="mono" title="Repository this laptop's control server targets">{repoLabel}</span><span className="muted">·</span></>}
          <select aria-label="Run" value={runPick} onChange={(e) => setRunPick(e.target.value)}>
            <option value="latest">{run ? `latest: run ${run.id} · ${run.mode}` : 'no runs yet'}</option>
            {runs.map((r) => <option key={String(r.id)} value={String(r.id)}>run {String(r.id)} · {r.mode} · seed {r.seed}{r.endedAt ? '' : ' · live'}</option>)}
          </select>
        </label>
        <div className="grow" />
        <nav aria-label="Dashboard sections" className="tabs">
          {TABS.map(([k, label]) => (
            <a key={k} href={`#/${k}`} className="tab" aria-current={tab === k ? 'page' : undefined}>
              {label}{k === 'activity' && view.events.length > 0 && <span className="count">{view.events.length}</span>}
            </a>
          ))}
        </nav>
        <div className="navright">
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }} className="muted">
            <span className="dot" style={{ width: 8, height: 8, background: live.connected ? (w.live ? 'var(--ok)' : 'var(--text2)') : 'var(--danger)' }} />
            {!live.connected ? 'Offline' : w.live ? 'Live' : run ? 'Ended' : 'Connected'}
          </span>
          <span className="mono">T+{clock}</span>
        </div>
      </header>

      {!live.connected && (
        <div style={{ padding: '0 20px' }}>
          <div className="banner" role="status">
            Not connected to SpacetimeDB at <span className="mono">{SPACETIME_HOST}</span> (database <span className="mono">{SPACETIME_DB_NAME}</span>).
            {live.error ? ` ${live.error}.` : ''} Check SPACETIME_HOST and SPACETIME_DB_NAME in the root .env, or start a local server with <span className="mono">spacetime start</span>.
          </div>
        </div>
      )}

      <div className="body">
        <AgentsPanel agents={view.agents} coord={view.coord} openRun={live.runs.find((r) => r.endedAt === undefined)} tasks={live.tasks}
          onlineIds={new Set(live.agents.filter((a) => now - Number(a.lastHeartbeat.microsSinceUnixEpoch / 1000n) < 60_000).map((a) => a.id))} />
        <main className="main">
          {tab === 'live' && <LiveTab agents={view.agents} cases={view.cases} events={view.events} map={view.map} stats={view.stats} without={view.without} symbols={live.symbols} edges={live.edges} runStart={w.start} edits={view.edits} />}
          {tab === 'code' && <CodeTab agents={view.agents} edits={view.edits} />}
          {tab === 'activity' && <ActivityTab events={view.events} cases={view.cases} people={view.people} />}
          {tab === 'tokens' && <TokensTab stats={view.stats} agents={view.agents} coord={view.coord} cases={view.cases} runStart={w.start} />}
          {tab === 'replay' && <ReplayTab live={live} />}
          {tab === 'chat' && <ControlTab openRun={live.runs.find((r) => r.endedAt === undefined)} />}
          {tab === 'scoreboard' && <ScoreboardTab without={view.without} withC={view.withC} />}
        </main>
      </div>
    </div>
  );
}
