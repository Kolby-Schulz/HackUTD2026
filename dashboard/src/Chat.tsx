// Chat: the run as one conversation (plans, changes, conflicts, rulings, instructions), oldest
// first, plus a composer. Sending to "All agents", or to a working agent, steers it through
// send_instruction (issue #11). Sending to an idle agent in an open run gives it a new task
// through create_task. No server change: both reducers already exist.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@bindings/index.ts';
import type * as R from '@bindings/types.ts';
import type { AgentCard, FeedEvent } from './model.ts';

function sentence(e: FeedEvent): string {
  const v = e.verb.charAt(0).toUpperCase() + e.verb.slice(1);
  return e.sub ? `${v}: ${e.sub}` : v;
}

function Message({ e }: { e: FeedEvent }) {
  if (e.actor.id === 'operator') {
    const to = e.verb.replace(/^messaged /, '').replace(/ · (read|delivered)$/, '');
    return (
      <div className="cmsg">
        <div className="who"><span className="sq" style={{ background: 'var(--text)' }}>Y</span>You <span className="muted" style={{ fontWeight: 500 }}>→ {to}</span><time>{e.time.slice(0, 5)}</time></div>
        <div className="txt">{e.sub} <span className="muted" style={{ fontSize: 11.5 }}>· {e.verb.endsWith('read') ? 'read' : 'delivered'}</span></div>
      </div>
    );
  }
  const tone = e.kind === 'conflict' ? ' alarm' : e.kind === 'decision' ? ' good' : e.kind === 'claim' || e.kind === 'edit' ? ' minor' : '';
  return (
    <div className={'cmsg' + tone}>
      <div className="who"><span className="sq" style={{ background: e.actor.id === 'coordinator' ? '#64748b' : e.actor.color }}>{e.actor.letter}</span><span className="ellipsis">{e.actor.name}</span><time>{e.time.slice(0, 5)}</time></div>
      <div className="txt">{sentence(e)}</div>
    </div>
  );
}

export function ChatView({ events, agents, openRun, connected }: { events: FeedEvent[]; agents: AgentCard[]; openRun?: R.Run; connected: boolean }) {
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const ordered = events.slice(0, 120).reverse(); // oldest first, newest at the bottom
  useLayoutEffect(() => {
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [ordered.length]);

  return (
    <>
      <div className="chat-log" ref={log} aria-live="polite" aria-label="Run conversation"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {ordered.length === 0 && <div className="empty" style={{ padding: '14px 0' }}>Plans, changes, conflicts and rulings show up here as the agents work.</div>}
        {ordered.map((e) => <Message key={e.key} e={e} />)}
      </div>
      <Composer agents={agents.filter((a) => !a.offline)} openRun={openRun} connected={connected} />
    </>
  );
}

function Composer({ agents, openRun, connected }: { agents: AgentCard[]; openRun?: R.Run; connected: boolean }) {
  const send = useReducer(reducers.sendInstruction);
  const createTask = useReducer(reducers.createTask);
  const [to, setTo] = useState('all');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>();
  const target = to === 'all' ? undefined : agents.find((a) => a.id === to);
  useEffect(() => { if (to !== 'all' && !target) setTo('all'); }, [to, target]);
  const asTask = !!target && !!openRun && (target.status === 'Idle' || target.status === 'Done');
  const what = to === 'all' ? 'Message every running agent' : asTask ? `New task for ${target!.person.name}` : `Message ${target?.person.name ?? 'agent'}`;

  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setNote(undefined);
    try {
      if (asTask) {
        const title = body.length > 60 ? `${body.slice(0, 57)}...` : body;
        await createTask({ title, description: body, agentId: target!.id, runId: openRun!.id });
        setNote({ text: `New task assigned to ${target!.person.name}.` });
      } else {
        await send({ agentId: target?.id ?? '*', text: body });
        setNote({ text: to === 'all' ? 'Sent to every running agent.' : `Sent to ${target!.person.name}.` });
      }
      setText('');
    } catch (err) {
      setNote({ text: `Could not send: ${err instanceof Error ? err.message : String(err)}`, bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Prompt your agents">
      <div className="cbox">
        <div className="targets" role="group" aria-label="Send to">
          <button type="button" className="target" aria-pressed={to === 'all'} onClick={() => setTo('all')}>@ All agents</button>
          {agents.map((a) => (
            <button key={a.id} type="button" className="target" aria-pressed={to === a.id} onClick={() => setTo(a.id)}>
              <span className="dot" style={{ background: to === a.id ? '#fff' : a.person.color }} />{a.person.name}
            </button>
          ))}
        </div>
        <label htmlFor="chat-prompt" className="sr-only">{what}</label>
        <textarea id="chat-prompt" rows={3} maxLength={2000} value={text} disabled={!connected}
          placeholder={connected ? `${what}…` : 'Offline: reconnect to send'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="grow" style={{ fontSize: 11.5, color: note?.bad ? 'var(--danger)' : 'var(--text2)' }}>
            {note?.text ?? (asTask ? 'Becomes a new task. InSync checks its plan like any other.' : 'Enter to send · Shift+Enter for a new line')}
          </span>
          <button type="submit" className="send" aria-label="Send" disabled={!connected || busy || !text.trim()}>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
    </form>
  );
}
