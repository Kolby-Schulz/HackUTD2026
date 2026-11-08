// Chat: the run as one conversation (plans, changes, conflicts, rulings, instructions), oldest
// first, plus a composer. With this laptop's control server running (npm run control), "@InSync"
// talks to the assistant (scripts/assistant.ts), which starts the coordinator, a session and
// workers from a plain request; its replies interleave with the run's events. "All agents", or a
// working agent, is steered through send_instruction (issue #11); an idle agent in an open run
// gets a new task through create_task.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@bindings/index.ts';
import type * as R from '@bindings/types.ts';
import type { AgentCard, FeedEvent } from './model.ts';
import { fmtClock } from './model.ts';
import { EXAMPLES, useAssistant, type ChatMessage } from './ControlTab.tsx';

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

function AssistantMessage({ m, start }: { m: ChatMessage; start: number }) {
  const time = start ? fmtClock(m.at - start, false) : new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (m.role === 'event') return <div className="cmsg minor"><div className="txt" style={{ paddingLeft: 0 }}>· {m.text}</div></div>;
  const you = m.role === 'user';
  return (
    <div className="cmsg">
      <div className="who"><span className="sq" style={{ background: you ? 'var(--text)' : 'var(--accent)' }}>{you ? 'Y' : 'I'}</span>{you ? <>You <span className="muted" style={{ fontWeight: 500 }}>→ InSync</span></> : 'InSync'}<time>{time}</time></div>
      <div className="txt" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
    </div>
  );
}

export function ChatView({ events, agents, openRun, connected, runStart }: { events: FeedEvent[]; agents: AgentCard[]; openRun?: R.Run; connected: boolean; runStart: number }) {
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const assistant = useAssistant();
  // oldest first, newest at the bottom; the assistant's messages slot in by time
  const ordered: ({ t: 'e'; at: number; e: FeedEvent } | { t: 'a'; at: number; m: ChatMessage })[] = [
    ...events.slice(0, 120).map((e) => ({ t: 'e' as const, at: e.at, e })),
    ...assistant.messages.slice(-60).map((m) => ({ t: 'a' as const, at: m.at, m })),
  ].sort((a, b) => a.at - b.at);
  useLayoutEffect(() => {
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [ordered.length, assistant.busy]);

  return (
    <>
      <div className="chat-log" ref={log} aria-live="polite" aria-label="Run conversation"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {ordered.length === 0 && <div className="empty" style={{ padding: '14px 0' }}>{assistant.up ? 'Tell InSync what to build. It starts the coordinator, a session and the agents; their plans, conflicts and rulings show up here.' : 'Plans, changes, conflicts and rulings show up here as the agents work.'}</div>}
        {ordered.map((x) => (x.t === 'e' ? <Message key={x.e.key} e={x.e} /> : <AssistantMessage key={'a' + x.m.id} m={x.m} start={runStart} />))}
        {assistant.busy && <div className="cmsg"><div className="bubble assistant typing" aria-label="InSync is thinking"><span /><span /><span /></div></div>}
      </div>
      <Composer agents={agents.filter((a) => !a.offline)} openRun={openRun} connected={connected} assistant={assistant} empty={ordered.length === 0} />
    </>
  );
}

function Composer({ agents, openRun, connected, assistant, empty }: {
  agents: AgentCard[]; openRun?: R.Run; connected: boolean; assistant: ReturnType<typeof useAssistant>; empty: boolean;
}) {
  const send = useReducer(reducers.sendInstruction);
  const createTask = useReducer(reducers.createTask);
  const [to, setTo] = useState(assistant.up ? 'insync' : 'all');
  // the assistant becomes the default once this laptop's control server answers
  const seen = useRef(false);
  useEffect(() => { if (assistant.up && !seen.current) { seen.current = true; setTo('insync'); } }, [assistant.up]);
  useEffect(() => { if (!assistant.up && to === 'insync') setTo('all'); }, [assistant.up, to]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>();
  const toAssistant = to === 'insync';
  const target = to === 'all' || toAssistant ? undefined : agents.find((a) => a.id === to);
  useEffect(() => { if (to !== 'all' && to !== 'insync' && !target) setTo('all'); }, [to, target]);
  const asTask = !!target && !!openRun && (target.status === 'Idle' || target.status === 'Done');
  const what = toAssistant ? 'Tell InSync what to build' : to === 'all' ? 'Message every running agent' : asTask ? `New task for ${target!.person.name}` : `Message ${target?.person.name ?? 'agent'}`;

  async function submit() {
    const body = text.trim();
    if (!body || busy || (toAssistant && assistant.busy)) return;
    setBusy(true);
    setNote(undefined);
    try {
      if (toAssistant) {
        await assistant.send(body);
      } else if (asTask) {
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
        {toAssistant && empty && (
          <div className="chips">{EXAMPLES.map((e) => <button key={e} type="button" className="example" onClick={() => setText(e)}>{e}</button>)}</div>
        )}
        <div className="targets" role="group" aria-label="Send to">
          {assistant.up && <button type="button" className="target" aria-pressed={toAssistant} onClick={() => setTo('insync')} title="The assistant on this laptop (npm run control)">@ InSync</button>}
          <button type="button" className="target" aria-pressed={to === 'all'} onClick={() => setTo('all')}>@ All agents</button>
          {agents.map((a) => (
            <button key={a.id} type="button" className="target" aria-pressed={to === a.id} onClick={() => setTo(a.id)}>
              <span className="dot" style={{ background: to === a.id ? '#fff' : a.person.color }} />{a.person.name}
            </button>
          ))}
        </div>
        <label htmlFor="chat-prompt" className="sr-only">{what}</label>
        <textarea id="chat-prompt" rows={3} maxLength={toAssistant ? 4000 : 2000} value={text} disabled={!connected && !toAssistant}
          placeholder={connected || toAssistant ? `${what}…` : 'Offline: reconnect to send'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="grow" style={{ fontSize: 11.5, color: note?.bad ? 'var(--danger)' : 'var(--text2)' }}>
            {note?.text ?? (toAssistant ? (assistant.busy ? 'InSync is working on it…' : 'InSync starts and coordinates the agents for you.') : asTask ? 'Becomes a new task. InSync checks its plan like any other.' : 'Enter to send · Shift+Enter for a new line')}
          </span>
          <button type="submit" className="send" aria-label="Send" disabled={(!connected && !toAssistant) || busy || (toAssistant && assistant.busy) || !text.trim()}>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
    </form>
  );
}
