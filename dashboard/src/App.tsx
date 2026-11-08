// Dashboard (spec section 13). Owner: dashboard + demo.
// One screen, laid out like an editor workbench (storyboard "Frame 1 as an editor workbench"):
// Agents side bar, editor groups holding the Code map, Control and Chat tabs (drag to reorder,
// move or split; Dock.tsx), Savings / Problems panel, status bar. Tables come from live subscriptions; Control and the chat's
// assistant talk to the local control server (npm run control). ReplayTab.tsx stays, unmounted.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useLive, SPACETIME_DB_NAME, SPACETIME_HOST } from './data.ts';
import { agentCards, calledAgents, cases, codeMap, coordFocus, coordinator, edits, feed, latestRun, runStage, runWindow, savingsNow, symbolHistory, symbolName, tokenStats, type CaseView } from './model.ts';
import { APP_NAME, Intro, SCurveMark, shouldPlayIntro } from './Intro.tsx';
import { CodeMap } from './CodeMap.tsx';
import { ICON, PaneHead, Sash, useLayout } from './Workbench.tsx';
import { DockArea, useDock, type ViewId } from './Dock.tsx';
import { AgentsView, BottomPanel, SymbolWidget, type CaseFilter, type PanelTab } from './Views.tsx';
import { ChatView } from './Chat.tsx';
import { ChangesView } from './Changes.tsx';
import { CommandCenter } from './CommandCenter.tsx';
import { Boundary } from './ui.tsx';
import { ControlTab, useControlInfo } from './ControlTab.tsx';
import { useMachine } from './machine.tsx';
import { useTheme } from './theme.ts';

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
  const [panelTab, setPanelTab] = useState<PanelTab>('savings');
  const [caseFilter, setCaseFilter] = useState<CaseFilter>('all');
  const [openCase, setOpenCase] = useState<string>(); // the problem row shown expanded
  const [flash, setFlash] = useState(0); // bumps when a number opens Problems, to highlight what it opened
  const dock = useDock();
  const [theme, toggleTheme] = useTheme();
  const { repoLabel, machine } = useControlInfo();
  // A pairing link (#/pair?…) opens the Control tab, where its progress shows.
  const pairingWith = useMachine().pairing?.machine;
  const openView = dock.open;
  useEffect(() => { if (pairingWith) openView('control'); }, [pairingWith, openView]);

  const view = useMemo(() => ({
    agents: agentCards(live, run, now),
    called: calledAgents(live, run, now),
    coord: coordinator(live, run, now),
    cases: cases(live, w),
    events: feed(live, w),
    edits: edits(live, w),
    map: codeMap(live, w, now),
    savings: savingsNow(live, run, now),
    tokens: tokenStats(live, run),
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
  const flip = (v: ViewId) => (dock.isOpen(v) ? dock.close(v) : dock.open(v));
  const showProblems = (f: CaseFilter) => { toggle('panel', true); setPanelTab('problems'); setCaseFilter(f); setFlash(Date.now()); };
  // A problem row: select its symbol (the map highlights it, Changes filters to its diffs); click again to clear.
  const pickCase = (c: CaseView) => {
    if (openCase === c.key) { setOpenCase(undefined); setPicked(undefined); return; }
    setOpenCase(c.key);
    setPicked(c.symbolId);
    if (!dock.isOpen('map')) dock.open('map');
    if (!dock.isOpen('changes')) dock.open('changes');
  };

  return (
    <div className="wb">
      <AnimatePresence>{intro && <Intro key="intro" onDone={endIntro} />}</AnimatePresence>

      <header className="titlebar">
        <div className="brand">
          <button type="button" className="logo-btn" onClick={() => setIntro(true)} aria-label="Replay intro" title="Replay intro"><SCurveMark size={24} /></button>
          {APP_NAME}
        </div>
        <CommandCenter repoLabel={repoLabel} runs={runs} run={run} runPick={runPick} openRun={openRun} modeName={modeName}
          onPickRun={(v) => { setRunPick(v); setPicked(undefined); setOpenCase(undefined); }} />
        <div className="tb-right">
          <button type="button" className="iconbtn" aria-pressed={open.side} aria-label="Toggle agents" data-tip="Agents" onClick={() => toggle('side')}>{ICON.agents}</button>
          <button type="button" className="iconbtn" aria-pressed={open.panel} aria-label="Toggle panel" data-tip="Panel" onClick={() => toggle('panel')}>{ICON.panel}</button>
          <button type="button" className="iconbtn" aria-pressed={dock.isOpen('map')} aria-label="Toggle code map" data-tip="Code map" onClick={() => flip('map')}>{ICON.map}</button>
          <button type="button" className="iconbtn" aria-pressed={dock.isOpen('changes')} aria-label="Toggle changes" data-tip="Changes" onClick={() => flip('changes')}>{ICON.changes}</button>
          <button type="button" className="iconbtn" aria-pressed={dock.isOpen('control')} aria-label="Toggle control" data-tip="Control" onClick={() => flip('control')}>{ICON.control}</button>
          <button type="button" className="iconbtn" aria-pressed={dock.isOpen('chat')} aria-label="Toggle chat" data-tip="Chat" onClick={() => flip('chat')}>{ICON.chat}</button>
          <span className="tb-sep" aria-hidden="true" />
          <button type="button" className="iconbtn" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} data-tip={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme}>
            {theme === 'dark'
              ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" /></g></svg>
              : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>}
          </button>
        </div>
      </header>

      <div className="main">
        {open.side && (
          <>
            <aside className="pane side" style={{ width: size.side }} aria-label="Agents">
              <PaneHead title="Agents" onClose={() => toggle('side', false)} />
              <div className="pane-body">
                <Boundary name="Agents">
                  <AgentsView agents={view.agents.filter((a) => view.called.has(a.id))} waiting={view.agents.filter((a) => !view.called.has(a.id))} coord={view.coord} events={view.events} runLabel={run ? `RUN #${run.id}` : 'NO RUN YET'} />
                </Boundary>
              </div>
            </aside>
            <Sash dir="v" label="Resize agents" size={size.side} sign={1} onSize={(px) => resize('side', px)} onToggle={() => toggle('side', false)} />
          </>
        )}

        <div className="center">
          <main className="pane" style={{ flex: 1 }} aria-label="Editor">
            {!live.connected && (
              <div className="banner" role="status">
                Not connected to SpacetimeDB at <span className="mono">{SPACETIME_HOST}</span> (database <span className="mono">{SPACETIME_DB_NAME}</span>).
                {live.error ? ` ${live.error}.` : ''} Retrying. Check SPACETIME_HOST and SPACETIME_DB_NAME in the root .env, or start a local server with <span className="mono">spacetime start</span>.
              </div>
            )}
            <DockArea dock={dock} views={{
              map: { title: 'Code map', icon: ICON.map, render: () => (
                <div className="view">
                  <nav className="crumbs" aria-label="Run stage">
                    {repoLabel && <span>{repoLabel}</span>}
                    {STAGES.map((s, i) => <span key={s}>{(i > 0 || repoLabel) && <>›&nbsp; </>}<span className={i === stageAt ? 'on' : i < stageAt ? 'done' : ''}>{s}</span></span>)}
                    <span className="grow" />
                    <span className="ellipsis">dashed = planned · outline = claimed · click a symbol for details</span>
                  </nav>
                  <div className="editor">
                    <Boundary name="Code map">
                      {live.connected && !live.ready ? <div className="map-empty">Loading the code map…</div> : (
                        <CodeMap nodes={view.map.nodes} edges={view.map.edges} selected={selected} coord={view.focus} onSelect={setPicked}
                          widget={node && <SymbolWidget key={node.id} node={node} symbols={live.symbols} edges={live.edges} history={symbolHistory(live, w, node.id)}
                            openCase={view.cases.find((c) => c.open && c.symbolId === node.id)} onClose={() => setPicked(undefined)} />} />
                      )}
                    </Boundary>
                  </div>
                </div>
              ) },
              changes: { title: 'Changes', icon: ICON.changes, hint: "The code each agent wrote, as diffs · drag to move or split", render: () => (
                <div className="view">
                  <Boundary name="Changes">
                    <ChangesView edits={view.edits} agents={view.agents} symbol={picked} symbolName={node?.name ?? (picked && symbolName(picked))}
                      onPickSymbol={(id) => { setPicked(id); if (!dock.isOpen('map')) dock.open('map'); }} onClearSymbol={() => { setPicked(undefined); setOpenCase(undefined); }} />
                  </Boundary>
                </div>
              ) },
              control: { title: 'Control', icon: ICON.control, hint: "Start and stop this laptop's processes (npm run control) · drag to move or split", render: () => (
                <div className="view scroll"><Boundary name="Control"><div className="control-tab"><ControlTab openRun={openRun} chat={false} /></div></Boundary></div>
              ) },
              chat: { title: 'Chat', icon: ICON.chat, render: () => (
                <div className="view chat-view">
                  <Boundary name="Chat">
                    <ChatView events={view.events} agents={view.agents.filter((a) => view.called.has(a.id) || !a.offline)} openRun={openRun} connected={live.connected} runStart={w.start} machine={machine} />
                  </Boundary>
                </div>
              ) },
            }} />
          </main>
          {open.panel && (
            <>
              <Sash dir="h" label="Resize panel" size={size.panel} sign={-1} onSize={(px) => resize('panel', px)} onToggle={() => toggle('panel', false)} />
              <section className="pane" style={{ height: size.panel, flex: 'none' }} aria-label="Savings and problems">
                <Boundary name="Panel">
                  <BottomPanel savings={view.savings} tokens={view.tokens} cases={view.cases} tab={panelTab} setTab={setPanelTab}
                    filter={caseFilter} setFilter={setCaseFilter} flash={flash} expanded={openCase} onPickCase={pickCase} onShowProblems={showProblems}
                    onClose={() => toggle('panel', false)} />
                </Boundary>
              </section>
            </>
          )}
        </div>

      </div>

      <footer className="statusbar" aria-label="Status bar">
        {run ? <><span>Run #{String(run.id)}</span><span>{modeName(run.mode)}</span><span>seed {run.seed}</span></> : <span>Start a run: npm run demo -- --mode with_contract</span>}
        <span>{view.called.size} agent{view.called.size === 1 ? '' : 's'} in this run</span>
        <span className="grow" />
        <button type="button" onClick={() => showProblems(openCount ? 'open' : 'all')} aria-label="Show problems">
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2L14.5 13.5h-13z M8 6.5v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {openCount} open
        </button>
        <span>Stage: {view.stage}</span>
      </footer>
    </div>
  );
}
