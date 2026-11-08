// Control tab: start and stop the demo's processes from the browser. Talks to the local
// control server (scripts/control.ts, `npm run control`), which runs the same commands the
// README lists on this laptop. Process state isn't in SpacetimeDB, so this tab polls that
// local server; every table on the dashboard still comes from live subscriptions.
import { useEffect, useRef, useState } from 'react';
import type * as R from '@bindings/types.ts';
import { StatusLabel } from './ui.tsx';

export const CONTROL_URL = 'http://127.0.0.1:5199';

interface Proc {
  key: string;
  label: string;
  long: boolean;
  status: 'running' | 'exited' | 'stopped';
  code: number | null;
  startedAt: number;
  endedAt?: number;
  log: string[];
}
interface Status {
  machine: string;
  repo?: string;
  repoLabel?: string;
  repoInfo?: { checks: string[]; install: string[]; languages: string[]; missing: { tool: string; neededBy: string[]; hint?: string }[]; dir: string };
  needsSession?: boolean;
  processes: Proc[];
}

export async function post(path: string, body: unknown) {
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-contract-control': '1' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
}

/** This laptop's control server facts: its target repo label and its machine name. Both are
 *  undefined while the server isn't running (most viewers never run one). */
export function useControlInfo(): { repoLabel?: string; machine?: string } {
  const [info, setInfo] = useState<{ repoLabel?: string; machine?: string }>({});
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // 10 s while it answers; 30 s while it's down
    const load = () =>
      fetch(`${CONTROL_URL}/status?tail=0`)
        .then((r) => r.json() as Promise<Status>)
        .then((s) => { if (alive) { setInfo((p) => { const repoLabel = s.repo ? s.repoLabel : undefined; return p.repoLabel === repoLabel && p.machine === s.machine ? p : { repoLabel, machine: s.machine }; }); timer = setTimeout(load, 10_000); } })
        .catch(() => { if (alive) { setInfo((p) => (p.repoLabel || p.machine ? {} : p)); timer = setTimeout(load, 30_000); } });
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return info;
}

/** This laptop's target repo label from the control server, or undefined if it isn't running. */
export function useControlRepo(): string | undefined {
  return useControlInfo().repoLabel;
}

export function useControl() {
  const [status, setStatus] = useState<Status>();
  const [down, setDown] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // 1.5 s while it answers; 5 s while it's down, so a closed server doesn't flood the console
    const load = () =>
      fetch(`${CONTROL_URL}/status?tail=60`)
        .then((r) => r.json() as Promise<Status>)
        .then((s) => { if (alive) { setStatus(s); setDown(false); timer = setTimeout(load, 1500); } })
        .catch(() => { if (alive) { setDown(true); timer = setTimeout(load, 5000); } });
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [tick]);
  return { status, down, refresh: () => setTick((n) => n + 1) };
}

/** `chat` false: the workbench shows the assistant in its own Chat pane, so this tab only has the controls. */
export function ControlTab({ openRun, chat = true }: { openRun?: R.Run; chat?: boolean }) {
  const { status, down, refresh } = useControl();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [workerId, setWorkerId] = useState('agent-a');
  const [prompt, setPrompt] = useState('');
  const [integration, setIntegration] = useState(false);

  const procs = status?.processes ?? [];
  const running = (key: string) => procs.some((p) => p.key === key && p.status === 'running');

  async function act(label: string, path: string, body: unknown, confirmText?: string): Promise<boolean> {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(label);
    setError(undefined);
    try {
      await post(path, body);
      refresh();
      return true;
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  if (down && !status) {
    return (
      <section className="card pad control-off">
        <h2 style={{ fontSize: 16 }}>Start Contract's chat on this laptop</h2>
        <p className="muted">Run this once in a terminal in the repo. Then you can type what you want built {chat ? 'here' : 'in the Chat pane'}, and Contract starts the coordinator, a session and the agents for you:</p>
        <pre className="mono">npm run control</pre>
        <p className="muted" style={{ fontSize: 12 }}>It only listens on 127.0.0.1 and only runs commands on this machine. Each laptop runs its own.</p>
      </section>
    );
  }

  const longToggle = (key: string, label: string, action: object) =>
    running(key)
      ? <button type="button" className="btn danger" disabled={!!busy} onClick={() => act(`Stop ${label}`, '/stop', { key })}>Stop</button>
      : <button type="button" className="btn" disabled={!!busy} onClick={() => act(`Start ${label}`, '/run', action)}>Start</button>;

  const isDemo = !status?.repo;

  return (
    <div className="control">
      <RepoPicker status={status} openRun={openRun} locked={procs.some((p) => p.status === 'running' && p.key !== 'clone')} busy={!!busy}
        onSet={(repo) => act('Set repository', '/repo', { repo })} />
      {error && <div className="banner" role="alert">{error}</div>}
      {chat && <ChatPanel openRun={openRun} onChange={refresh} demo={isDemo} repoLabel={status?.repoLabel} />}
      <details className="card pad manual">
      <summary>Manual controls <span className="muted">· start and stop each piece yourself, with each process's output</span></summary>
      <div className="control" style={{ marginTop: 14 }}>
      <div className="control-head">
        <span className="dot" style={{ width: 8, height: 8, background: down ? 'var(--danger)' : 'var(--ok)' }} />
        <span>{down ? 'Lost the control server' : <>Controlling <span className="mono">{status?.machine}</span></>}</span>
        <span className="grow" />
        <span className="muted">{openRun ? <>Open run <span className="mono">#{String(openRun.id)}</span> · {openRun.mode}</> : 'No open run'}</span>
      </div>
      {error && <div className="banner" role="alert">{error}</div>}

      <div className="control-grid">
        <section className="card pad step">
          <div className="cap muted">1 · Coordinator</div>
          <p className="muted">Resolves conflicts between agents. One per database; run it on one laptop.</p>
          <div className="row">{longToggle('coordinator', 'coordinator', { action: 'coordinator' })}<ProcState p={procs.find((p) => p.key === 'coordinator')} /></div>
        </section>

        <section className="card pad step">
          <div className="cap muted">2 · Session</div>
          <p className="muted">Opens a with-Contract run and maps the repo. Starting ends any open run.</p>
          <div className="row">
            <button type="button" className="btn" disabled={!!busy || running('session-start')}
              onClick={() => act('Start session', '/run', { action: 'session-start' }, openRun ? `End run #${openRun.id} and start a new session?` : undefined)}>
              {running('session-start') ? 'Starting…' : 'Start session'}
            </button>
            <ProcState p={procs.find((p) => p.key === 'session-start')} />
          </div>
        </section>

        <section className="card pad step wide">
          <div className="cap muted">3 · Agents</div>
          <p className="muted">Starts a Claude Code worker on this laptop. Leave the task empty and it waits for one: pick it in <b>Chat</b> and send it a task.</p>
          <form className="worker-form" onSubmit={(e) => { e.preventDefault(); void act(`Start ${workerId}`, '/run', { action: 'worker', id: workerId.trim(), prompt }).then(() => setPrompt('')); }}>
            <label className="field">
              <span className="cap muted">Agent id</span>
              <input value={workerId} onChange={(e) => setWorkerId(e.target.value)} list="agent-ids" spellCheck={false} />
              <datalist id="agent-ids"><option value="agent-a" /><option value="agent-b" /><option value="agent-c" /></datalist>
            </label>
            <label className="field grow">
              <span className="cap muted">Task (optional)</span>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="e.g. Add late fees to invoices" />
            </label>
            <button type="submit" className="btn" disabled={!!busy || !workerId.trim() || !openRun || running(`worker:${workerId.trim()}`)}>
              {prompt.trim() ? 'Start with task' : 'Start and wait'}
            </button>
          </form>
          {!openRun && <div className="muted" style={{ fontSize: 12 }}>Start a session first.</div>}
          <div className="row">
            <span className="muted" style={{ fontSize: 13 }}>Judge agent (picks up the Judge task box):</span>
            {longToggle('judge', 'judge agent', { action: 'judge' })}
            <ProcState p={procs.find((p) => p.key === 'judge')} />
          </div>
        </section>

        <section className="card pad step">
          <div className="cap muted">4 · Merge</div>
          <p className="muted">When every agent is done: merges their branches, runs {isDemo ? 'tests, typecheck and check-dupes' : "the repo's checks (contract.json, else npm test)"}, then ends the run.</p>
          {isDemo && (
            <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={integration} onChange={(e) => setIntegration(e.target.checked)} /> Integration test (canned demo tasks only)
            </label>
          )}
          <div className="row">
            <button type="button" className="btn" disabled={!!busy || running('session-merge') || !openRun} onClick={() => act('Merge', '/run', { action: 'session-merge', integration: isDemo && integration })}>
              {running('session-merge') ? 'Merging…' : 'Merge and check'}
            </button>
            <ProcState p={procs.find((p) => p.key === 'session-merge')} />
          </div>
        </section>

        <section className="card pad step">
          <div className="cap muted">Reset</div>
          <p className="muted">Removes agent worktrees and branches, restores <span className="mono">{status?.repoLabel ?? 'demo-repo'}</span> to its last commit and clears the open run's state.</p>
          <div className="row">
            <button type="button" className="btn danger" disabled={!!busy || running('reset') || procs.some((p) => p.key.startsWith('worker:') && p.status === 'running')}
              onClick={() => act('Reset', '/run', { action: 'reset' }, 'Reset removes agent worktrees and branches and clears the open run. Continue?')}>
              Reset
            </button>
            <ProcState p={procs.find((p) => p.key === 'reset')} />
          </div>
        </section>
      </div>

      <section className="card pad">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ fontSize: 15 }} className="grow">Processes on this laptop</h2>
          <span className="muted" style={{ fontSize: 12 }}>{procs.filter((p) => p.status === 'running').length} running</span>
        </div>
        {procs.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Nothing started from here yet.</div>}
        {procs.slice().sort((a, b) => b.startedAt - a.startedAt).map((p) => (
          <ProcRow key={p.key} p={p} busy={!!busy}
            onStop={() => act(`Stop ${p.label}`, '/stop', { key: p.key })}
            onClear={() => act(`Clear ${p.label}`, '/forget', { key: p.key })} />
        ))}
      </section>
      </div>
      </details>
    </div>
  );
}

/**
 * Which repository the agents work on. Applies to every process this laptop starts. On the demo
 * the link field is always open, so using your own repo is one paste and Enter.
 */
export function RepoPicker({ status, openRun, locked, busy, onSet }: {
  status?: Status; openRun?: R.Run; locked: boolean; busy: boolean; onSet: (repo: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const demo = !status?.repo;
  const clone = status?.processes.find((p) => p.key === 'clone');
  const cloning = clone?.status === 'running';
  const failed = clone && clone.status !== 'running' && clone.code !== 0;
  const checks = status?.repoInfo?.checks;
  const showForm = (demo || editing) && !locked;

  async function use(repo: string) {
    if (await onSet(repo)) { setEditing(false); setText(''); }
  }

  return (
    <section className="card pad repo-picker" aria-label="Repository">
      <div className="row">
        <span className="cap muted">Repository</span>
        <span className="mono">{demo ? <span className="muted">No repository chosen yet</span> : status?.repoLabel}</span>
        {!demo && cloning && <span className="label-wrap muted">{clone?.label === 'Clone repository' ? 'Cloning…' : 'Pulling latest…'}</span>}
        {!demo && !cloning && !failed && status?.repoInfo && <span className="repo-ok">✓ Ready</span>}
        <span className="grow" />
        {!demo && !editing && (
          <>
            <button type="button" className="btn small ghost" disabled={busy || locked} title={locked ? 'Stop what is running first' : undefined}
              onClick={() => { setText(status?.repo ?? ''); setEditing(true); }}>Change</button>
          </>
        )}
      </div>

      {showForm && (
        <form className="row repo-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void use(text); }}>
          <input className="grow mono" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoFocus={editing}
            placeholder="Paste a GitHub link, e.g. https://github.com/you/your-app" aria-label="GitHub repository link" />
          <button type="submit" className="btn small" disabled={busy || !text.trim()}>Use this repo</button>
          {editing && <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>Cancel</button>}
        </form>
      )}
      {demo && locked && <p className="muted">Stop what's running to switch to your own repository.</p>}

      {!demo && failed && (
        <p className="repo-err" role="alert">
          Couldn't get the repository: {clone?.log.at(-1) ?? 'git failed'}. Check the link, and that <span className="mono">git clone</span> works on this laptop for private repos.{' '}
          <button type="button" className="linkish" disabled={busy} onClick={() => void use(status?.repo ?? '')}>Try again</button>
        </p>
      )}
      {!demo && !failed && !cloning && checks && status?.repoInfo && (
        <div className="repo-facts">
          <span><span className="cap muted">Languages</span> {status.repoInfo.languages.join(', ') || 'none found'}</span>
          <span><span className="cap muted">Installs</span> {status.repoInfo.install.join(', ') || 'nothing'}</span>
          <span><span className="cap muted">Merges run</span> {checks.join(', ') || 'no checks'}</span>
        </div>
      )}
      {!demo && !failed && !cloning && !!status?.repoInfo?.missing.length && (
        <div className="repo-warn" role="status">
          <b>This laptop is missing {status.repoInfo.missing.map((m) => m.tool).join(', ')}.</b>{' '}
          Agents can still edit code, but installs and tests that need {status.repoInfo.missing.length > 1 ? 'them' : 'it'} will be skipped or fail.
          <ul>
            {status.repoInfo.missing.map((m) => (
              <li key={m.tool}>
                <span className="mono">{m.tool}</span> for <span className="mono">{m.neededBy.join(', ')}</span>
                {m.hint && <> · install with <span className="mono">{m.hint}</span></>}
              </li>
            ))}
          </ul>
          Then press <b>Change</b> and <b>Use this repo</b> again to re-check.
        </div>
      )}
      {!demo && !failed && !cloning && checks && (
        <p className="muted">
          {!checks.length && <>No tests found, so merges aren't checked. Add a <span className="mono">contract.json</span> with <span className="mono">checks</span> to run some. </>}
          Agents push <span className="mono">agent/&lt;id&gt;</span> branches to it.
        </p>
      )}
      {!demo && status?.needsSession && openRun && !cloning && !failed && (
        <p className="muted">Your next request starts a new session on {status.repoLabel}, which ends open run #{String(openRun.id)}.</p>
      )}
      {(demo || editing) && !locked && (
        <p className="muted hint">
          Public or private GitHub repos (cloned with this laptop's git login), or a local folder path. You need push access.
          Contract installs dependencies and finds tests on its own; the code map reads TypeScript, JavaScript, Python, Go, Java, Rust, Ruby, PHP, C# and C/C++.
        </p>
      )}
    </section>
  );
}

export interface ChatMessage { id: number; role: 'user' | 'assistant' | 'event'; text: string; at: number }

export const EXAMPLES = [
  'Add a late fee to overdue invoices',
  'Add late fees to invoices, and have another agent show dates as YYYY-MM-DD on receipts',
  "What's happening right now?",
];

/** The chat: type what you want built; the assistant (scripts/assistant.ts) runs everything. */
/** The assistant's conversation (scripts/assistant.ts via the control server), polled once a
 *  second while the server answers. `up` is false when this laptop isn't running `npm run control`. */
export function useAssistant(onChange?: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetch(`${CONTROL_URL}/chat`)
        .then((r) => r.json() as Promise<{ busy: boolean; messages: ChatMessage[] }>)
        .then((c) => {
          if (!alive) return;
          setUp(true);
          setMessages((prev) => (prev.length === c.messages.length && prev.at(-1)?.id === c.messages.at(-1)?.id ? prev : c.messages));
          setBusy(c.busy);
          timer = setTimeout(load, 1000);
        })
        .catch(() => { if (alive) { setUp(false); timer = setTimeout(load, 4000); } });
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  async function send(text: string) {
    await post('/chat', { text });
    setBusy(true);
    setMessages((m) => [...m, { id: -Date.now(), role: 'user', text, at: Date.now() }]);
    onChange?.();
  }
  return { messages, busy, up, send };
}

function ChatPanel({ openRun, onChange, demo, repoLabel }: { openRun?: R.Run; onChange: () => void; demo: boolean; repoLabel?: string }) {
  const { messages, busy, send } = useAssistant(onChange);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, busy]);

  async function submit(body: string) {
    const msg = body.trim();
    if (!msg || busy || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await send(msg);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card chat" aria-label="Chat">
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            <h2>What should the agents build?</h2>
            <p className="muted">Describe it like you'd prompt a coding agent. Contract starts the coordinator and a session, splits the work across agents, keeps them from colliding, then merges and runs the tests.</p>
            <div className="chips">
              {(demo ? EXAMPLES : EXAMPLES.slice(-1)).map((e) => <button key={e} type="button" className="example" onClick={() => setText(e)}>{e}</button>)}
            </div>
          </div>
        )}
        {messages.map((m) => (
          m.role === 'event'
            ? <div key={m.id} className="chat-event"><span className="dot" style={{ background: 'var(--accent)', width: 6, height: 6 }} />{m.text}</div>
            : <div key={m.id} className={'bubble ' + m.role}>{m.text}</div>
        ))}
        {busy && <div className="bubble assistant typing" aria-label="Thinking"><span /><span /><span /></div>}
        <div ref={endRef} />
      </div>
      {error && <div className="msg-error" role="alert" style={{ padding: '0 16px' }}>{error}</div>}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(text); }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} aria-label="Message"
          placeholder={openRun && demo ? 'Ask for a change, or tell the running agents something…' : `What do you want built${demo || !repoLabel ? '' : ` in ${repoLabel}`}?`}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(text); } }} />
        <button type="submit" className="btn" disabled={busy || sending || !text.trim()}>{busy ? 'Working…' : 'Send'}</button>
      </form>
    </section>
  );
}

function word(p: Proc): [string, string] {
  if (p.status === 'running') return ['Working', 'Running'];
  if (p.status === 'stopped') return ['Idle', 'Stopped'];
  return p.code === 0 ? ['Done', 'Finished'] : ['Open', `Failed (exit ${p.code ?? '?'})`];
}

function ProcState({ p }: { p?: Proc }) {
  if (!p) return null;
  const [, text] = word(p);
  return <span className="muted" style={{ fontSize: 12 }}>{text}{p.log.length ? ` · ${p.log[p.log.length - 1].slice(0, 80)}` : ''}</span>;
}

function ProcRow({ p, busy, onStop, onClear }: { p: Proc; busy: boolean; onStop: () => void; onClear: () => void }) {
  const [open, setOpen] = useState(!p.long);
  const [status, text] = word(p);
  const secs = Math.round(((p.endedAt ?? Date.now()) - p.startedAt) / 1000);
  return (
    <div className="proc">
      <div className="proc-head">
        <button type="button" className="linkish" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '▾' : '▸'} {p.label}</button>
        <span className="label-wrap"><StatusLabel status={status} /></span>
        <span className="muted" style={{ fontSize: 12 }}>{text} · {secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}</span>
        <span className="grow" />
        {p.status === 'running'
          ? <button type="button" className="btn small danger" disabled={busy} onClick={onStop}>Stop</button>
          : <button type="button" className="btn small ghost" disabled={busy} onClick={onClear}>Clear</button>}
      </div>
      {open && <pre className="proc-log mono">{p.log.length ? p.log.join('\n') : 'No output yet.'}</pre>}
    </div>
  );
}
