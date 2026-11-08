// Control tab: start and stop the demo's processes from the browser. Talks to the local
// control server (scripts/control.ts, `npm run control`), which runs the same commands the
// README lists on this laptop. Process state isn't in SpacetimeDB, so this tab polls that
// local server; every table on the dashboard still comes from live subscriptions.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type * as R from '@bindings/types.ts';
import { StatusLabel } from './ui.tsx';
import { MachinePicker, useMachine, type ChatMessage, type Proc, type Status } from './machine.tsx';
import { controlSteps, envCopy, OS_LABEL, saveOS, savedOS, terminalName, type OS } from './os.ts';

export type { ChatMessage } from './machine.tsx';

/** The old HTTP paths, now commands for the paired laptop's daemon. */
function useSend() {
  const { send } = useMachine();
  return (path: string, body: Record<string, unknown> = {}) => {
    if (path === '/run') {
      const { action, ...args } = body;
      return send(String(action), args);
    }
    return send(path.slice(1), body); // /repo, /stop, /forget, /chat
  };
}

/** The paired laptop's facts: its target repo label (once one is chosen) and its machine name.
 *  Both are undefined while no paired laptop is online (most viewers never pair one). */
export function useControlInfo(): { repoLabel?: string; machine?: string } {
  const { status } = useMachine();
  return { repoLabel: status?.repo ? status.repoLabel : undefined, machine: status?.machine };
}

/** The paired laptop's target repo label, or undefined when none is chosen or no laptop is online. */
export function useControlRepo(): string | undefined {
  return useControlInfo().repoLabel;
}

export function useControl() {
  const { status } = useMachine();
  return { status, down: !status, refresh: () => undefined };
}

/** `chat` false: the workbench shows the assistant in its own Chat pane, so this tab only has the controls. */
export function ControlTab({ openRun, chat = true }: { openRun?: R.Run; chat?: boolean }) {
  const { status, down, refresh } = useControl();
  const { pairing, laptops } = useMachine();
  const post = useSend();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [workerId, setWorkerId] = useState('agent-a');
  const [prompt, setPrompt] = useState('');
  const [integration, setIntegration] = useState(false);

  const procs = status?.processes ?? [];
  const running = (key: string) => procs.some((p) => p.key === key && p.status === 'running');

  async function act(label: string, path: string, body: Record<string, unknown>, confirmText?: string): Promise<boolean> {
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

  if (down && !status) return <NotPaired chat={chat} />;

  const longToggle = (key: string, label: string, action: Record<string, unknown>) =>
    running(key)
      ? <button type="button" className="btn danger" disabled={!!busy} onClick={() => act(`Stop ${label}`, '/stop', { key })}>Stop</button>
      : <button type="button" className="btn" disabled={!!busy} onClick={() => act(`Start ${label}`, '/run', action)}>Start</button>;

  const isDemo = !status?.repo;
  const justPaired = pairing?.state === 'done' && pairing.machine === status?.machine;
  // Teammates' laptops: everyone shares one database (and one open run), so say who else is here and
  // on which repo. Buttons and chat on this tab still reach only the paired laptop.
  const others = laptops.filter((l) => l.online && !l.mine);
  const offRepo = status ? others.filter((l) => l.repoLabel !== status.repoLabel) : [];

  return (
    <div className="control">
      <RepoPicker status={status} openRun={openRun} locked={procs.some((p) => p.status === 'running' && p.key !== 'clone')} busy={!!busy}
        onSet={(repo) => act('Set repository', '/repo', { repo })} />
      {justPaired && <div className="repo-ok" role="status">✓ Paired this browser with {pairing.machine}.</div>}
      {error && <div className="banner" role="alert">{error}</div>}
      {chat && <ChatPanel openRun={openRun} onChange={refresh} demo={isDemo} repoLabel={status?.repoLabel} />}
      <details className="card pad manual">
      <summary>Manual controls <span className="muted">· start and stop each piece yourself, with each process's output</span></summary>
      <div className="control" style={{ marginTop: 14 }}>
      <div className="control-head">
        <span className="dot" style={{ width: 8, height: 8, background: down ? 'var(--danger)' : 'var(--ok)' }} />
        <span>{down ? 'Lost the laptop' : <>Controlling <span className="mono">{status?.machine}</span></>}</span>
        <MachinePicker />
        {others.length > 0 && <span className="muted" style={{ fontSize: 12 }}>· also online: {others.map((l) => `${l.id} (${l.repoLabel})`).join(', ')}</span>}
        <span className="grow" />
        <span className="muted">{openRun ? <>Open run <span className="mono">#{String(openRun.id)}</span> · {openRun.mode}</> : 'No open run'}</span>
      </div>
      {error && <div className="banner" role="alert">{error}</div>}
      {offRepo.length > 0 && <div className="banner" role="status">{offRepo.map((l) => `${l.id} is on ${l.repoLabel}`).join('; ')}; agents in one run should work on the same repo as this laptop ({status?.repoLabel}).</div>}

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


/** The chat: type what you want built; the assistant (scripts/assistant.ts) runs everything. */
/** The paired laptop's assistant (scripts/assistant.ts, mirrored through machine_chat).
 *  `up` is false when no paired laptop is running `npm run control`. */
export function useAssistant(onChange?: () => void) {
  const { status, chat, send: sendCommand } = useMachine();
  const [sent, setSent] = useState<ChatMessage[]>([]);
  // Show what you typed until the daemon's copy of it arrives.
  const echoed = !sent.length || chat.messages.some((m) => m.role === 'user' && m.text === sent[0].text && m.at >= sent[0].at - 5000);
  const messages = echoed ? chat.messages : [...chat.messages, ...sent];
  async function send(text: string) {
    setSent([{ id: -Date.now(), role: 'user', text, at: Date.now() }]);
    try {
      await sendCommand('chat', { text });
    } catch (e) {
      setSent([]);
      throw e;
    }
    onChange?.();
  }
  return { messages, busy: chat.busy || !echoed, up: !!status, send };
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

/** No paired laptop online: how to start the daemon on your laptop and pair this browser with it, and only it. */
function NotPaired({ chat }: { chat: boolean }) {
  const { mine, laptops, pair, pairing } = useMachine();
  const [machine, setMachine] = useState('');
  const [code, setCode] = useState('');
  const [os, setOs] = useState<OS>(savedOS);
  // Nothing is pre-selected: the first online laptop is usually a teammate's, and pairing with it
  // would make this browser drive their laptop.
  const others = laptops.filter((l) => l.online && !l.mine);
  const chosen = others.find((l) => l.id === machine);
  const working = pairing?.state === 'working';
  const browsers = (n: number) => `${n} other browser${n === 1 ? '' : 's'}`;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!chosen || !code.trim()) return;
    if (chosen.pairedBy > 0 && !window.confirm(`${chosen.id} is already paired with ${browsers(chosen.pairedBy)}. Only pair it if it's the laptop you're sitting at: every paired browser controls it.`)) return;
    void pair(chosen.id, code).then(() => setCode('')).catch(() => undefined);
  };
  return (
    <section className="card pad control-off">
      <h2 style={{ fontSize: 16 }}>{working ? `Pairing with ${pairing.machine}…` : 'Connect your laptop'}</h2>
      <p className="muted">Agents run on your own laptop, and this browser drives only the laptop you pair it with. Open {terminalName(os)}, go to the root of your Contract clone (the folder with <span className="mono">package.json</span>) and run these one at a time:</p>
      <div className="row" role="group" aria-label="Laptop's operating system" style={{ gap: 6, marginBottom: 6 }}>
        {(Object.keys(OS_LABEL) as OS[]).map((o) => (
          <button key={o} type="button" className={`btn small${o === os ? '' : ' ghost'}`} aria-pressed={o === os} onClick={() => { setOs(o); saveOS(o); }}>{OS_LABEL[o]}</button>
        ))}
      </div>
      <pre className="mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{controlSteps(os)}</pre>
      <p className="muted">First time only, before <span className="mono">npm run control</span>: run <span className="mono">{envCopy(os)}</span>, then set <span className="mono">SPACETIME_HOST</span> and <span className="mono">SPACETIME_DB_NAME</span> in <span className="mono">.env</span>.</p>
      <p className="muted">Then click the pairing link it prints (or type its code below). After that you can type what you want built {chat ? 'here' : 'in the Chat pane'}, and InSync starts the coordinator, a session and the agents for you.</p>
      <p className="muted">Teammates run the same commands on their laptops and pair their own browsers. Everyone sees the same run, agents and changes here; pairing only decides which laptop your buttons and chat reach.</p>
      <p className="muted" style={{ fontSize: 12 }}>Seeing <span className="mono">npm error Missing script: "control"</span>? That checkout is on an old branch (or you're in the wrong folder). In the repo root run <span className="mono">git checkout main</span>, <span className="mono">git pull</span> and <span className="mono">npm install</span>, then try again.</p>
      {pairing?.state === 'failed' && <div className="banner" role="alert">Couldn't pair with {pairing.machine}: {pairing.error}</div>}
      {others.length > 0 && (
        <>
          <form className="row repo-form" onSubmit={submit}>
            <select value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Your laptop">
              <option value="">Which laptop is yours?</option>
              {others.map((l) => <option key={l.id} value={l.id}>{l.id} · {l.repoLabel} · {l.pairedBy > 0 ? `paired by ${l.pairedBy} browser${l.pairedBy === 1 ? '' : 's'}` : 'not paired yet'}</option>)}
            </select>
            <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code, e.g. K7Q-4XM" aria-label="Pairing code" spellCheck={false} autoComplete="off" maxLength={12} />
            <button type="submit" className="btn small" disabled={working || !chosen || !code.trim()}>Pair</button>
          </form>
          <p className="muted" style={{ fontSize: 12 }}>Your laptop is the one whose terminal printed the code. A laptop that's already paired is probably a teammate's.</p>
        </>
      )}
      {mine.length > 0 && <p className="muted">Paired, but offline: <span className="mono">{mine.map((m) => m.id).join(', ')}</span>. Start <span className="mono">npm run control</span> there again.</p>}
      <p className="muted" style={{ fontSize: 12 }}>The daemon connects out to SpacetimeDB; nothing listens on a port. It only runs commands from browsers you paired, and only on that laptop. Codes work once and expire after 10 minutes.</p>
    </section>
  );
}
