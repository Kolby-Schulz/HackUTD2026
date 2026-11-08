// The InSync workbench as artboards: the real app's layout (title bar, activity bar, agents side
// bar, three editor groups with Savings under the code map, status bar) with each region as a slot, plus a toast
// layer. "Current" renders today's components with sample data; "Proposed" overrides the slots the
// styling ideas change, so each idea can be compared and taken on its own.
import { defineScreen } from '../../variants/define.ts';
import { ICON } from '../../Workbench.tsx';
import s from './layout.module.css';

export default defineScreen({
  title: 'Workbench (dashboard)',
  description: 'The main InSync dashboard, 70 s into a run: two conflicts resolved, one being decided.',
  width: 1440,
  slots: {
    titlebar: 'Title bar',
    side: 'Agents side bar',
    map: 'Code map',
    changes: 'Changes',
    chat: 'Chat',
    panel: 'Savings panel',
    statusbar: 'Status bar',
    toast: 'Live toasts',
  },
  Layout: ({ slots }) => (
    <div className={`wb ${s.frame}`}>
      {slots.titlebar}
      <div className="main">
        <nav className="activitybar" aria-label="Views">
          <div className="ab-group">
            {(['agents', 'map', 'changes', 'control', 'chat', 'panel'] as const).map((k) => <span key={k} className="ab-btn" aria-pressed={k !== 'control'}>{ICON[k]}</span>)}
          </div>
        </nav>
        <aside className={`pane side ${s.side}`} aria-label="Agents">{slots.side}</aside>
        <div className="center">
          <main className={`pane ${s.editor}`}>
            <div className={s.groups}>
              <section className={s.group}>
                <Tab title="Code map" />
                {slots.map}
                <div className={s.panel}>{slots.panel}</div>
              </section>
              <section className={s.group}><Tab title="Changes" />{slots.changes}</section>
              <section className={`${s.group} ${s.chat}`}><Tab title="Chat" />{slots.chat}</section>
            </div>
            <div className={s.toasts}>{slots.toast}</div>
          </main>
        </div>
      </div>
      {slots.statusbar}
    </div>
  ),
});

function Tab({ title }: { title: string }) {
  return (
    <div className="tabs" style={{ flex: 'none' }}>
      <div className="etab" aria-selected="true"><span className="etab-btn" style={{ paddingRight: 14 }}>{title}</span></div>
    </div>
  );
}
