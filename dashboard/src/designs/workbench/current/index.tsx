// Today's dashboard: the real Agents, Code map, Changes and Savings components with the sample
// run. Chat needs a live SpacetimeDB connection, so it is drawn with the same classes instead.
import { defineVariant } from '../../../variants/define.ts';
import { AgentsView, BottomPanel } from '../../../Views.tsx';
import { CodeMap } from '../../../CodeMap.tsx';
import { ChangesView } from '../../../Changes.tsx';
import { ICON, PaneHead } from '../../../Workbench.tsx';
import { SCurveMark } from '../../../Intro.tsx';
import { demo } from '../fixture.ts';

const noop = () => {};

export const Titlebar = () => (
  <header className="titlebar">
    <div className="brand"><span className="logo-btn"><SCurveMark size={24} /></span>InSync</div>
    <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
      <button type="button" className="cc-btn"><span className="muted">⌕</span><span className="grow ellipsis">demo-repo</span><span className="mono">latest · run 2 · with InSync</span></button>
    </div>
    <div className="tb-right" />
  </header>
);

const Side = () => (
  <>
    <PaneHead title="Agents" onClose={noop} />
    <div className="pane-body">
      <AgentsView agents={demo.agents} waiting={demo.waiting} coord={demo.coord} events={demo.events} runLabel="RUN #2" />
    </div>
  </>
);

const Map = () => (
  <div className="view">
    <nav className="crumbs" aria-label="Run stage">
      <span>demo-repo</span><span>›&nbsp; <span className="done">Plan</span></span><span>›&nbsp; <span className="on">Code</span></span><span>›&nbsp; Merge</span>
      <span className="grow" />
      <span className="ellipsis">dashed = planned · outline = claimed · click a symbol for details</span>
    </nav>
    <div className="editor"><CodeMap nodes={demo.map.nodes} edges={demo.map.edges} coord={demo.focus} onSelect={noop} /></div>
  </div>
);

const Changes = () => <div className="view"><ChangesView edits={demo.edits} agents={demo.agents} onPickSymbol={noop} onClearSymbol={noop} /></div>;

export const Chat = () => (
  <div className="view chat-view">
    <div className="chat-log">
      {demo.events.slice(0, 7).map((e) => (
        <div key={e.key} className={'cmsg' + (e.kind === 'conflict' ? ' alarm' : e.kind === 'decision' ? ' good' : '')}>
          <div className="who"><span className="sq" style={{ background: e.actor.id === 'coordinator' ? '#64748b' : e.actor.color }}>{e.actor.letter}</span><span className="ellipsis">{e.actor.name}</span><time>{e.time.slice(0, 5)}</time></div>
          <div className="txt">{e.verb}{e.sub ? `: ${e.sub}` : ''}</div>
        </div>
      ))}
    </div>
    <form className="composer" onSubmit={(e) => e.preventDefault()}>
      <div className="cbox">
        <div className="to-row"><span className="muted">To</span><select className="to-select" defaultValue=""><option value="">No one available</option></select></div>
        <div className="muted" style={{ fontSize: 12, padding: '6px 0' }}>No agent is online. Start one from the Control tab, or run a worker on a laptop.</div>
        <textarea rows={2} placeholder="No one to send to yet" disabled style={{ width: '100%', border: 'none', background: 'none', resize: 'none' }} />
      </div>
    </form>
  </div>
);

const Panel = () => (
  <div style={{ height: 210, display: 'flex', flexDirection: 'column' }}>
    <BottomPanel savings={demo.savings} tokens={demo.tokens} cases={demo.cases} onShowConflict={noop} onClose={noop} />
  </div>
);

const Statusbar = () => (
  <footer className="statusbar">
    <span>Run #2</span><span>with InSync</span><span>seed 7</span><span>2 agents in this run</span>
    <span className="grow" />
    <span>⚠ 1 open</span><span>Stage: Code</span>
  </footer>
);

const NoToasts = () => null;

export default defineVariant({
  title: 'Current',
  note: 'The dashboard as it is on main, rendered from its real components with a sample run.',
  slots: { titlebar: Titlebar, side: Side, map: Map, changes: Changes, chat: Chat, panel: Panel, statusbar: Statusbar, toast: NoToasts },
});
