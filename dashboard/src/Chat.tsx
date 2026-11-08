// Chat: the run as one conversation (plans, changes, conflicts, rulings, instructions), oldest
// first, plus a composer. With this laptop's control server running (npm run control), "@InSync"
// talks to the assistant (scripts/assistant.ts), which starts the coordinator, a session and
// workers from a plain request; its replies interleave with the run's events. A working agent is
// steered through send_instruction (issue #11); an idle agent in an open run gets a new task through
// create_task. "Every running agent" ('*') reaches teammates' agents too, so the picker groups agents
// by laptop and names everyone a message will reach. An offline agent can be picked too: sending
// starts it as a worker on the paired laptop (the Control tab's "Start" button), with the text as
// its first task, or waiting for one when the text is empty.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@bindings/index.ts';
import type * as R from '@bindings/types.ts';
import type { AgentCard, FeedEvent } from './model.ts';
import { defaultRecipient, fmtClock, sameMachine } from './model.ts';
import { useAssistant, type ChatMessage } from './ControlTab.tsx';
import { useMachine } from './machine.tsx';

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

export function ChatView({ events, agents, openRun, connected, runStart, machine }: { events: FeedEvent[]; agents: AgentCard[]; openRun?: R.Run; connected: boolean; runStart: number; machine?: string }) {
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
      <Composer agents={agents} openRun={openRun} connected={connected} assistant={assistant} machine={machine} />
    </>
  );
}

function Composer({ agents, openRun, connected, assistant, machine }: {
  agents: AgentCard[]; openRun?: R.Run; connected: boolean; assistant: ReturnType<typeof useAssistant>; machine?: string;
}) {
  const send = useReducer(reducers.sendInstruction);
  const createTask = useReducer(reducers.createTask);
  // create_task takes operators only (#62): this browser must be paired with a laptop's
  // `npm run control` daemon (any laptop, online or not). Messages (send_instruction) are open.
  const machineState = useMachine();
  const paired = machineState.mine.length > 0;
  const canStart = !!machineState.current; // a paired laptop is online to run the worker
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>();

  // Who can be reached. '*' (send_instruction) reaches every working or paused agent in the shared
  // database, which includes teammates' agents on other laptops, so it is never the default and
  // the line under the picker names exactly who it reaches.
  const online = agents.filter((a) => !a.offline);
  const mine = (a: AgentCard) => sameMachine(a.machine, machine);
  const here = agents.filter(mine), elsewhere = agents.filter((a) => !mine(a));
  const running = agents.filter((a) => a.status === 'Working' || a.status === 'Paused');
  const fallback = defaultRecipient(agents, machine, assistant.up);
  const [picked, setPicked] = useState<string>();
  const valid = (k?: string) => !!k && (k === 'insync' ? assistant.up : k === 'all' ? running.length > 0 : agents.some((a) => a.id === k));
  const to = valid(picked) ? picked! : fallback;

  const toAssistant = to === 'insync';
  const target = online.find((a) => a.id === to);
  const sleeper = agents.find((a) => a.offline && a.id === to); // offline: sending starts it
  const asTask = !!target && !!openRun && (target.status === 'Idle' || target.status === 'Done');
  const where = (a: AgentCard) => [a.ownerDev, a.machine].filter(Boolean).join(' · ') || 'unknown laptop';
  const laptops = new Set(running.map((a) => a.machine || a.ownerDev)).size;
  const others = running.filter((a) => !mine(a)).length;
  const what = sleeper ? `Start ${sleeper.person.name} with a task (or send empty to wait)` : toAssistant ? 'Tell InSync what to build' : to === 'all' ? `Message ${running.length} running agents` : asTask ? `New task for ${target!.person.name}` : target ? `Message ${target.person.name}` : 'No agent to message';
  const reach = sleeper ? (!canStart ? `${sleeper.person.name} is offline. Pair this browser with your laptop (Control tab) to start it.`
      : !openRun ? `${sleeper.person.name} is offline. Start a session first (Control tab), then start it here.`
      : `${sleeper.person.name} is offline · sending starts it on ${machineState.current}${mine(sleeper) ? '' : ` (it last ran on ${where(sleeper)})`}`)
    : toAssistant ? 'The assistant on this laptop starts and coordinates agents for you.'
    : to === 'all' ? `Reaches ${running.map((a) => `${a.person.name} (${where(a)})`).join(', ')}${machine && others ? ` · ${others} on other laptops` : laptops > 1 ? ` · ${laptops} laptops` : ''}.`
    : asTask && !paired ? `${where(target!)} · ${target!.status} · becomes a new task, so pair this browser with a laptop first (Control tab)`
    : target ? `${where(target)} · ${target.status}${asTask ? ' · becomes a new task' : ''}`
    : online.length > 0 ? 'Pick an agent above. Pair your own laptop in the Control tab to message your agents by default.'
    : 'No agent is online. Start one from the Control tab, or run a worker on a laptop.';

  async function submit() {
    const body = text.trim();
    if ((!body && !sleeper) || busy || !to || (toAssistant && assistant.busy)) return;
    setBusy(true);
    setNote(undefined);
    try {
      if (sleeper) {
        if (!canStart) throw new Error('pair this browser with your laptop first (Control tab)');
        if (!openRun) throw new Error('start a session first (Control tab)');
        await machineState.send('worker', { id: sleeper.id, ...(body ? { prompt: body } : {}) });
        setNote({ text: body ? `Starting ${sleeper.person.name} with that task on ${machineState.current}.` : `Starting ${sleeper.person.name} on ${machineState.current}; it waits for a task.` });
      } else if (toAssistant) {
        await assistant.send(body);
      } else if (asTask) {
        if (!paired) throw new Error('pair this browser with a laptop first (Control tab); only paired dashboards can create tasks');
        const title = body.length > 60 ? `${body.slice(0, 57)}...` : body;
        await createTask({ title, description: body, agentId: target!.id, runId: openRun!.id });
        setNote({ text: `New task assigned to ${target!.person.name}.` });
      } else {
        await send({ agentId: to === 'all' ? '*' : target!.id, text: body });
        setNote({ text: to === 'all' ? `Sent to ${running.length} running agents.` : `Sent to ${target!.person.name}.` });
      }
      setText('');
    } catch (err) {
      setNote({ text: `Could not send: ${err instanceof Error ? err.message : String(err)}`, bad: true });
    } finally {
      setBusy(false);
    }
  }

  const option = (a: AgentCard) => (
    <option key={a.id} value={a.id}>
      {a.person.name} · {a.offline ? 'offline · send to start' : a.status}{mine(a) ? '' : ` · ${where(a)}`}
    </option>
  );

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Prompt your agents">
      <div className="cbox">
        <div className="to-row">
          <label htmlFor="chat-to" className="muted">To</label>
          {target && <span className="dot" style={{ background: target.person.color }} />}
          <select id="chat-to" className="to-select" value={to} onChange={(e) => { setPicked(e.target.value); setNote(undefined); }}>
            {!to && <option value="">No one available</option>}
            {assistant.up && <option value="insync">InSync assistant</option>}
            {machine && here.length > 0 ? (
              <>
                <optgroup label={`On this laptop (${machine})`}>{here.map(option)}</optgroup>
                {elsewhere.length > 0 && <optgroup label="On other laptops">{elsewhere.map(option)}</optgroup>}
              </>
            ) : agents.length > 0 && <optgroup label="Agents">{agents.map(option)}</optgroup>}
            <option value="all" disabled={running.length === 0}>Every running agent ({running.length})</option>
          </select>
          <div className={'reach' + (to === 'all' && (others > 0 || laptops > 1) ? ' wide' : '')}>{reach}</div>
        </div>
        <label htmlFor="chat-prompt" className="sr-only">{what}</label>
        <textarea id="chat-prompt" rows={3} maxLength={toAssistant ? 4000 : 2000} value={text} disabled={!to || (!connected && !toAssistant)}
          placeholder={!to ? 'No one to send to yet' : connected || toAssistant ? `${what}…` : 'Offline: reconnect to send'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="grow" style={{ fontSize: 11.5, color: note?.bad ? 'var(--danger)' : 'var(--text2)' }}>
            {note?.text ?? (toAssistant && assistant.busy ? 'InSync is working on it…' : sleeper ? 'Enter to start · empty starts it waiting for a task' : 'Enter to send · Shift+Enter for a new line')}
          </span>
          <button type="submit" className="send" aria-label={sleeper ? `Start ${sleeper.person.name}` : 'Send'} disabled={!to || (!connected && !toAssistant) || busy || (toAssistant && assistant.busy) || (sleeper ? !canStart || !openRun : !text.trim())}>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
    </form>
  );
}
