// The title bar's command center: one button showing the repository and the run, opening a
// dropdown with two sections. Repository = the existing repo picker from the Control tab (paste a
// GitHub link, or use the built-in demo), which needs this laptop's control server
// (npm run control). Run = which run the whole screen shows.
import { useEffect, useRef, useState } from 'react';
import type * as R from '@bindings/types.ts';
import { RepoPicker, post, useControl } from './ControlTab.tsx';

const RECENT_KEY = 'insync.recentRepos';
const loadRecent = (): string[] => { try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).filter((x) => typeof x === 'string' && x).slice(0, 5); } catch { return []; } };
const saveRecent = (xs: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(xs.slice(0, 5))); } catch { /* private window */ } };
/** "https://github.com/acme/shop.git" -> "acme/shop" for the recent list. */
const shortName = (repo: string) => repo.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');

/** Asks the dashboard's dev server to start this laptop's control server (vite.config.ts). */
async function startControl(): Promise<boolean> {
  try {
    const r = await fetch('/__insync/control/start', { method: 'POST', headers: { 'x-contract-control': '1' } });
    return r.ok;
  } catch { return false; }
}

function RepoSection({ openRun }: { openRun?: R.Run }) {
  const { status, down, refresh } = useControl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [starting, setStarting] = useState<'idle' | 'asking' | 'waiting' | 'failed'>('idle');
  // the server isn't answering: start it once, then poll until it does
  useEffect(() => {
    if (!down || status || starting !== 'idle') return;
    setStarting('asking');
    void startControl().then((ok) => {
      if (!ok) { setStarting('failed'); return; }
      setStarting('waiting');
      [1200, 2500, 4000, 6000, 9000, 13000].forEach((ms) => setTimeout(refresh, ms));
    });
  }, [down, status, starting, refresh]);

  if (!status) {
    if (starting === 'failed') {
      return (
        <div className="cc-off">
          This laptop's control server isn't running and the dashboard couldn't start it (it only can from the laptop that runs <span className="mono">npm run dashboard</span>).
          Run <span className="mono">npm run control</span> in the repo, then open this menu again.
          <div style={{ marginTop: 8 }}><button type="button" className="btn small ghost" onClick={() => { setStarting('idle'); refresh(); }}>Try again</button></div>
        </div>
      );
    }
    return <div className="cc-off muted"><span className="spinner" aria-hidden="true" />{starting === 'waiting' ? "Starting this laptop's control server… (a few seconds)" : "Connecting to this laptop's control server…"}</div>;
  }
  const locked = status.processes.some((p) => p.status === 'running' && p.key !== 'clone');
  async function set(repo: string): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      await post('/repo', { repo });
      refresh();
      const r = repo.trim();
      if (r) { const next = [r, ...recent.filter((x) => x !== r)]; setRecent(next); saveRecent(next); }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const others = recent.filter((r) => r !== status.repo);
  return (
    <>
      <RepoPicker status={status} openRun={openRun} locked={locked} busy={busy} onSet={set} />
      {others.length > 0 && !locked && (
        <div className="cc-recent">
          <span className="muted">Recent</span>
          {others.map((r) => <button key={r} type="button" className="sym-chip" disabled={busy} title={r} onClick={() => void set(r)}>{shortName(r)}</button>)}
          {status.repo && <button type="button" className="sym-chip" disabled={busy} onClick={() => void set('')}>demo-repo</button>}
        </div>
      )}
      {error && <div className="msg-error" role="alert">Set repository: {error}</div>}
    </>
  );
}

export function CommandCenter({ repoLabel, runs, run, runPick, onPickRun, openRun, modeName }: {
  repoLabel?: string; runs: R.Run[]; run?: R.Run; runPick: string; onPickRun: (v: string) => void; openRun?: R.Run; modeName: (m: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const pick = (v: string) => { onPickRun(v); setOpen(false); button.current?.focus(); };
  const runLabel = run ? `run ${run.id} · ${modeName(run.mode)}` : 'no runs yet';

  return (
    <div className="cmd" ref={box} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
      <button type="button" ref={button} className="cc-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} title="Repository and run">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <span className="mono ellipsis cc-repo">{repoLabel ?? 'demo-repo'}</span>
        <span className="muted">·</span>
        <span className="mono ellipsis">{runPick === 'latest' ? `latest · ${runLabel}` : runLabel}</span>
        <svg className="chev" style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : undefined }} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="cc-pop" role="dialog" aria-label="Repository and run">
          <section className="cc-section" aria-label="Repository">
            <div className="hd">Repository</div>
            <RepoSection openRun={openRun} />
          </section>
          <section className="cc-section" aria-label="Run">
            <div className="hd">Run</div>
            <div className="cc-runs" role="listbox" aria-label="Run">
              <button type="button" role="option" aria-selected={runPick === 'latest'} className="cc-run" onClick={() => pick('latest')}>
                <b>Latest</b><span className="muted">follows each new run{run ? ` · now run ${run.id}` : ''}</span>
              </button>
              {runs.map((r) => (
                <button key={String(r.id)} type="button" role="option" aria-selected={runPick === String(r.id)} className="cc-run" onClick={() => pick(String(r.id))}>
                  <b className="mono">run {String(r.id)}</b>
                  <span>{modeName(r.mode)}</span>
                  <span className="muted">seed {r.seed}</span>
                  {!r.endedAt && <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>live</span>}
                </button>
              ))}
              {!runs.length && <div className="muted" style={{ padding: '6px 8px' }}>No runs yet.</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
