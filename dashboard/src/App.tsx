// Dashboard (spec section 13). Owner: dashboard + demo.
// One screen, laid out like an editor workbench (storyboard "Frame 1 as an editor workbench"):
// Agents side bar, editor groups holding the Code map, Control and Chat tabs (drag to reorder,
// move or split; Dock.tsx), Savings panel, status bar. Tables come from live subscriptions; Control and the chat's
// assistant talk to the local control server (npm run control). ReplayTab.tsx stays, unmounted.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useLive, SPACETIME_DB_NAME, SPACETIME_HOST } from './data.ts';
import { agentCards, calledAgents, cases, codeMap, coordFocus, coordinator, edits, feed, latestRun, runStage, runWindow, savingsNow, symbolHistory, tokenStats, type CaseView } from './model.ts';
import { APP_NAME, Intro, SCurveMark, shouldPlayIntro } from './Intro.tsx';
import { CodeMap } from './CodeMap.tsx';
import { ICON, PaneHead, Sash, useLayout } from './Workbench.tsx';
import { DockArea, useDock, type ViewId } from './Dock.tsx';
import { AgentsView, BottomPanel, SymbolWidget } from './Views.tsx';
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
  const dock = useDock();
  const [theme, toggleTheme] = useTheme();
  const { repoLabel, machine } = useControlInfo();
  // A pairing link (#/pair?…) opens the Control tab, where its progress shows.
  const machineState = useMachine();
  const pairingWith = machineState.pairing?.machine;
  // Runs don't record their repo, but the paired laptop knows when its last session was for a
  // different repo than the one picked now (needs_session). Then the latest run's changes belong
  // to that other repo, so the Changes tab and the chat hide them; switching back shows them again.
  const otherRepoRun = runPick === 'latest' && run && machineState.status?.needsSession ? run : undefined;
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
  // A Savings number shows its conflict where conflicts live: open the map, select the function
  // (its popup has the coordinator's decision) and glide the camera to it.
  const [reveal, setReveal] = useState(0);
  const showConflict = (c: CaseView) => {
    if (!dock.isOpen('map')) dock.open('map');
    setPicked(c.symbolId);
    setReveal((r) => r + 1);
  };

  // The Savings panel sits under the code map's editor group, only as wide as the map, so the
  // columns beside it (Chat, Changes) run full height; with the code map closed it spans the editor.
  const mapOpen = dock.isOpen('map');
  const panel = open.panel && (
    <>
      <Sash dir="h" label="Resize panel" size={size.panel} sign={-1} onSize={(px) => resize('panel', px)} onToggle={() => toggle('panel', false)} />
      <section className="pane" style={{ height: size.panel, flex: 'none', maxHeight: 'calc(100% - 200px)' }} aria-label="Savings">
        <Boundary name="Panel">
          <BottomPanel savings={view.savings} tokens={view.tokens} cases={view.cases} onShowConflict={showConflict} onClose={() => toggle('panel', false)} />
        </Boundary>
      </section>
    </>
  );

  return (
    <div className="wb">
      <AnimatePresence>{intro && <Intro key="intro" onDone={endIntro} />}</AnimatePresence>

      <header className="titlebar">
        <div className="brand">
          <button type="button" className="logo-btn" onClick={() => setIntro(true)} aria-label="Replay intro" title="Replay intro"><SCurveMark size={24} /></button>
          {APP_NAME}
        </div>
        <CommandCenter repoLabel={repoLabel} runs={runs} run={run} runPick={runPick} openRun={openRun} modeName={modeName}
          onPickRun={(v) => { setRunPick(v); setPicked(undefined); }} />
        {/* balances the brand so the command center stays centred */}
        <div className="tb-right" />
      </header>

      <div className="main">
        <nav className="activitybar" aria-label="Views">
          <div className="ab-group">
            <ActivityButton label="Agents" on={open.side} onClick={() => toggle('side')} badge={view.agents.filter((a) => a.status === 'Working').length} badgeTitle="working">{ICON.agents}</ActivityButton>
            <ActivityButton label="Code map" on={dock.isOpen('map')} onClick={() => flip('map')}>{ICON.map}</ActivityButton>
            <ActivityButton label="Changes" on={dock.isOpen('changes')} onClick={() => flip('changes')} badge={view.edits.length} badgeTitle="edits this run">{ICON.changes}</ActivityButton>
            <ActivityButton label="Control" on={dock.isOpen('control')} onClick={() => flip('control')}>{ICON.control}</ActivityButton>
            <ActivityButton label="Chat" on={dock.isOpen('chat')} onClick={() => flip('chat')}>{ICON.chat}</ActivityButton>
            <ActivityLink label="Design board" href="#/playground">{BOARD_ICON}</ActivityLink>
            <ActivityButton label="Savings panel" on={open.panel} onClick={() => toggle('panel')} badge={openCount} badgeTitle="open conflicts" alert>{ICON.panel}</ActivityButton>
          </div>
          <div className="ab-group">
            <ActivityButton label={theme === 'dark' ? 'Light theme' : 'Dark theme'} on={false} onClick={toggleTheme}>
              {theme === 'dark'
                ? <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></g></svg>
                : <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>}
            </ActivityButton>
          </div>
        </nav>
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
                    <span className="ellipsis">focused on what agents touch · ⋯ expands · dashed = planned · outline = claimed</span>
                  </nav>
                  <div className="editor">
                    <Boundary name="Code map">
                      {live.connected && !live.ready ? <div className="map-empty">Loading the code map…</div> : (
                        <CodeMap nodes={view.map.nodes} edges={view.map.edges} selected={selected} coord={view.focus} onSelect={setPicked} reveal={reveal}
                          widget={node && <SymbolWidget key={node.id} node={node} symbols={live.symbols} edges={live.edges} history={symbolHistory(live, w, node.id)}
                            conflict={view.cases.find((c) => c.symbolId === node.id)} onClose={() => setPicked(undefined)} />} />
                      )}
                    </Boundary>
                  </div>
                </div>
              ) },
              changes: { title: 'Changes', icon: ICON.changes, hint: "The code each agent wrote, as diffs · drag to move or split", render: () => (
                <div className="view">
                  <Boundary name="Changes">
                    <ChangesView edits={otherRepoRun ? [] : view.edits} otherRepoRun={otherRepoRun?.id} repoLabel={repoLabel} agents={view.agents} symbol={selected} symbolName={node?.name}
                      onPickSymbol={(id) => { setPicked(id); if (!dock.isOpen('map')) dock.open('map'); }} onClearSymbol={() => setPicked(undefined)} />
                  </Boundary>
                </div>
              ) },
              control: { title: 'Control', icon: ICON.control, hint: "Start and stop this laptop's processes (npm run control) · drag to move or split", render: () => (
                <div className="view scroll"><Boundary name="Control"><div className="control-tab"><ControlTab openRun={openRun} chat={false} /></div></Boundary></div>
              ) },
              chat: { title: 'Chat', icon: ICON.chat, render: () => (
                <div className="view chat-view">
                  <Boundary name="Chat">
                    <ChatView events={otherRepoRun ? view.events.filter((e) => e.kind !== 'edit') : view.events} agents={view.agents.filter((a) => view.called.has(a.id) || !a.offline)} openRun={openRun} connected={live.connected} runStart={w.start} machine={machine} />
                  </Boundary>
                </div>
              ) },
            }} below={panel && mapOpen ? { view: 'map', node: panel } : undefined} />
          </main>
          {panel && !mapOpen && panel}
        </div>

      </div>

      <footer className="statusbar" aria-label="Status bar">
        {run ? <><span>Run #{String(run.id)}</span><span>{modeName(run.mode)}</span><span>seed {run.seed}</span></> : <span>Start a run: npm run demo -- --mode with_contract</span>}
        <span>{view.called.size} agent{view.called.size === 1 ? '' : 's'} in this run</span>
        <span className="grow" />
        <span title="Open conflicts, marked in red on the code map" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2L14.5 13.5h-13z M8 6.5v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {openCount} open
        </span>
        <span>Stage: {view.stage}</span>
      </footer>
    </div>
  );
}

/** An activity bar icon that opens another page (plain hash navigation) instead of toggling a view. */
function ActivityLink({ label, href, children }: { label: string; href: string; children: ReactNode }) {
  return (
    <a className="ab-btn" href={href} aria-label={`Open ${label}`}>
      {children}
      <span className="ab-tip" role="tooltip">{label}</span>
    </a>
  );
}

const BOARD_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <rect x="3.5" y="4" width="17" height="13" rx="2" />
      <path d="M12 12l6 2-2.5 1-1 2.5z" />
      <path d="M8 21h8" strokeLinecap="round" />
    </g>
  </svg>
);

/** One icon in the activity bar, styled like VS Code's: grey when its view is hidden, bright with a
 *  full-height bar on the left edge while open, an optional count badge, and a tooltip. */
function ActivityButton({ label, on, onClick, badge, badgeTitle, alert, children }: {
  label: string; on: boolean; onClick: () => void; badge?: number; badgeTitle?: string; alert?: boolean; children: ReactNode;
}) {
  const count = badge && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : undefined;
  return (
    <button type="button" className="ab-btn" aria-pressed={on} aria-label={`${on ? 'Hide' : 'Show'} ${label}${count ? `, ${count} ${badgeTitle ?? ''}` : ''}`} onClick={onClick}>
      {children}
      {count && <span className={'ab-badge' + (alert ? ' alert' : '')} aria-hidden="true">{count}</span>}
      <span className="ab-tip" role="tooltip">{label}{count && badgeTitle ? ` · ${count} ${badgeTitle}` : ''}</span>
    </button>
  );
}
