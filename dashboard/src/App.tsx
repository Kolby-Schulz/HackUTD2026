// Dashboard (spec section 13). Owner: dashboard + demo.
// One screen, laid out like an editor workbench (storyboard "Frame 1 as an editor workbench"):
// Agents side bar, editor (Code map, plus a Control tab for this laptop's processes), Savings /
// Problems panel, Chat, status bar. Tables come from live subscriptions; Control and the chat's
// assistant talk to the local control server (npm run control). ReplayTab.tsx stays, unmounted.
import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useLive, SPACETIME_DB_NAME, SPACETIME_HOST } from './data.ts';
import { agentCards, cases, codeMap, coordFocus, coordinator, feed, latestRun, runStage, runWindow, savingsNow, symbolHistory } from './model.ts';
import { APP_NAME, Intro, LanesMark, shouldPlayIntro } from './Intro.tsx';
import { CodeMap } from './CodeMap.tsx';
import { ICON, PaneHead, Sash, useLayout } from './Workbench.tsx';
import { AgentsView, BottomPanel, SymbolWidget } from './Views.tsx';
import { ChatView } from './Chat.tsx';
import { Boundary } from './ui.tsx';
import { ControlTab, useControlRepo } from './ControlTab.tsx';

const modeName = (m: string) => (m === 'with_contract' ? `with ${APP_NAME}` : m === 'without_contract' ? `without ${APP_NAME}` : m);

export function App() {
  const live = useLive();
  const [intro, setIntro] = useState(shouldPlayIntro);
  const endIntro = useCallback(() => setIntro(false), []);
  const [runPick, setRunPick] = useState<string>('latest');
  const run = runPick === 'latest' ? latestRun(live.runs) : live.runs.find((r) => String(r.id) === runPick);
  const { now } = live;
  const w = runWindow(run, now);
  const { layout, resize, toggle } = useLayout();
  const [picked, setPicked] = useState<string>();
  const [panelTab, setPanelTab] = useState<'savings' | 'problems'>('savings');
  const [editorTab, setEditorTab] = useState<'map' | 'control'>('map');
  const repoLabel = useControlRepo();

  const view = useMemo(() => ({
    agents: agentCards(live, run, now),
    coord: coordinator(live, run, now),
    cases: cases(live, w),
    events: feed(live, w),
    map: codeMap(live, w, now),
    savings: savingsNow(live, run, now),
    stage: runStage(live, run, w),
    focus: coordFocus(live, w),
    // `now` ticks every second; the tables change only when the server pushes rows
  }), [live, run, now, w.start, w.end]);

  const selected = picked && view.map.nodes.some((n) => n.id === picked) ? picked : undefined;
  const node = view.map.nodes.find((n) => n.id === selected);
  const openCount = view.cases.filter((c) => c.open).length;
  const runs = live.runs.slice().sort((a, b) => Number(b.id - a.id));
  const openRun = live.runs.find((r) => r.endedAt === undefined);
  const STAGES = ['Plan', 'Code', 'Merge'] as const;
  const stageAt = STAGES.indexOf(view.stage);
  const { open, size } = layout;

  return (
    <div className="wb">
      <AnimatePresence>{intro && <Intro key="intro" onDone={endIntro} />}</AnimatePresence>

      <header className="titlebar">
        <div className="brand">
          <button type="button" className="logo-btn" onClick={() => setIntro(true)} aria-label="Replay intro" title="Replay intro"><LanesMark size={24} /></button>
          {APP_NAME}
        </div>
        <div className="cmd">
          <label>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <span>{repoLabel ?? 'demo-repo'}</span>
            <select aria-label="Run" value={runPick} onChange={(e) => { setRunPick(e.target.value); setPicked(undefined); }}>
              <option value="latest">{run ? `latest · run ${run.id} · ${modeName(run.mode)}` : 'no runs yet'}</option>
              {runs.map((r) => <option key={String(r.id)} value={String(r.id)}>run {String(r.id)} · {modeName(r.mode)} · seed {r.seed}{r.endedAt ? '' : ' · live'}</option>)}
            </select>
          </label>
        </div>
        <div className="tb-right">
          <button type="button" className="iconbtn" aria-pressed={open.side} aria-label="Toggle agents" title="Agents" onClick={() => toggle('side')}>{ICON.agents}</button>
          <button type="button" className="iconbtn" aria-pressed={open.panel} aria-label="Toggle panel" title="Panel" onClick={() => toggle('panel')}>{ICON.panel}</button>
          <button type="button" className="iconbtn" aria-pressed={open.chat} aria-label="Toggle chat" title="Chat" onClick={() => toggle('chat')}>{ICON.chat}</button>
        </div>
      </header>

      <div className="main">
        {open.side && (
          <>
            <aside className="pane side" style={{ width: size.side }} aria-label="Agents">
              <PaneHead title="Agents" onClose={() => toggle('side', false)} />
              <div className="pane-body">
                <Boundary name="Agents">
                  <AgentsView agents={view.agents} coord={view.coord} events={view.events} runLabel={run ? `RUN #${run.id}` : 'NO RUN YET'} />
                </Boundary>
              </div>
            </aside>
            <Sash dir="v" label="Resize agents" size={size.side} sign={1} onSize={(px) => resize('side', px)} onToggle={() => toggle('side', false)} />
          </>
        )}

        <div className="center">
          <main className="pane" style={{ flex: 1 }} aria-label="Editor">
            <div className="tabs" role="tablist" aria-label="Editor">
              <button type="button" role="tab" className="etab" aria-selected={editorTab === 'map'} onClick={() => setEditorTab('map')}>{ICON.map}Code map</button>
              <button type="button" role="tab" className="etab" aria-selected={editorTab === 'control'} onClick={() => setEditorTab('control')} title="Start and stop this laptop's processes (npm run control)">{ICON.panel}Control</button>
            </div>
            <nav className="crumbs" aria-label="Run stage">
              <span>{repoLabel ?? 'demo-repo'}</span>
              {STAGES.map((s, i) => <span key={s}>›&nbsp; <span className={i === stageAt ? 'on' : i < stageAt ? 'done' : ''}>{s}</span></span>)}
              <span className="grow" />
              <span>dashed = planned · outline = claimed · click a symbol for details</span>
            </nav>
            {!live.connected && (
              <div className="banner" role="status">
                Not connected to SpacetimeDB at <span className="mono">{SPACETIME_HOST}</span> (database <span className="mono">{SPACETIME_DB_NAME}</span>).
                {live.error ? ` ${live.error}.` : ''} Retrying. Check SPACETIME_HOST and SPACETIME_DB_NAME in the root .env, or start a local server with <span className="mono">spacetime start</span>.
              </div>
            )}
            {editorTab === 'control' ? (
              <div className="editor" style={{ overflow: 'auto' }}>
                <Boundary name="Control"><div className="control-tab"><ControlTab openRun={openRun} chat={false} /></div></Boundary>
              </div>
            ) : (
            <div className="editor">
              <Boundary name="Code map">
                {live.connected && !live.ready ? <div className="map-empty">Loading the code map…</div> : (
                  <CodeMap nodes={view.map.nodes} edges={view.map.edges} selected={selected} coord={view.focus} onSelect={setPicked}
                    widget={node && <SymbolWidget key={node.id} node={node} symbols={live.symbols} edges={live.edges} history={symbolHistory(live, w, node.id)}
                      openCase={view.cases.find((c) => c.open && c.symbolId === node.id)} onClose={() => setPicked(undefined)} />} />
                )}
              </Boundary>
            </div>
            )}
          </main>
          {open.panel && (
            <>
              <Sash dir="h" label="Resize panel" size={size.panel} sign={-1} onSize={(px) => resize('panel', px)} onToggle={() => toggle('panel', false)} />
              <section className="pane" style={{ height: size.panel, flex: 'none' }} aria-label="Savings and problems">
                <Boundary name="Panel">
                  <BottomPanel savings={view.savings} cases={view.cases} tab={panelTab} setTab={setPanelTab} onClose={() => toggle('panel', false)} />
                </Boundary>
              </section>
            </>
          )}
        </div>

        {open.chat && (
          <>
            <Sash dir="v" label="Resize chat" size={size.chat} sign={-1} onSize={(px) => resize('chat', px)} onToggle={() => toggle('chat', false)} />
            <aside className="pane chat" style={{ width: size.chat }} aria-label="Chat">
              <PaneHead title="Chat" onClose={() => toggle('chat', false)}><span className="muted" style={{ fontSize: 12 }}>{run ? `run #${run.id}` : ''}</span></PaneHead>
              <Boundary name="Chat">
                <ChatView events={view.events} agents={view.agents} openRun={openRun} connected={live.connected} runStart={w.start} />
              </Boundary>
            </aside>
          </>
        )}
      </div>

      <footer className="statusbar" aria-label="Status bar">
        {run ? <><span>Run #{String(run.id)}</span><span>{modeName(run.mode)}</span><span>seed {run.seed}</span></> : <span>Start a run: npm run demo -- --mode with_contract</span>}
        <span>{view.agents.length} agent{view.agents.length === 1 ? '' : 's'}</span>
        <span className="grow" />
        <button type="button" onClick={() => { toggle('panel', true); setPanelTab('problems'); }} aria-label="Show problems">
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2L14.5 13.5h-13z M8 6.5v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {openCount} open
        </button>
        <span>Stage: {view.stage}</span>
      </footer>
    </div>
  );
}
