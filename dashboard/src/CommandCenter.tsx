// The title bar's command center: one button showing the repository and the run, opening a
// dropdown with two sections. Repository = the existing repo picker from the Control tab (paste a
// GitHub link), which drives the paired laptop's daemon (npm run control, through SpacetimeDB).
// Run = which run the whole screen shows.
import { useEffect, useRef, useState } from 'react';
import type * as R from '@bindings/types.ts';
import { RepoPicker } from './ControlTab.tsx';
import { useMachine } from './machine.tsx';

const RECENT_KEY = 'insync.recentRepos';
const loadRecent = (): string[] => { try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).filter((x) => typeof x === 'string' && x).slice(0, 5); } catch { return []; } };
const saveRecent = (xs: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(xs.slice(0, 5))); } catch { /* private window */ } };
/** "https://github.com/acme/shop.git" -> "acme/shop" for the recent list. */
const shortName = (repo: string) => repo.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');

function RepoSection({ openRun }: { openRun?: R.Run }) {
  const { status, send, mine } = useMachine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [recent, setRecent] = useState<string[]>(loadRecent);

  if (!status) {
    return (
      <div className="cc-off" style={{ display: 'block' }}>
        {mine.length ? 'Your paired laptop is offline.' : 'No laptop is paired with this browser yet.'} On
        the laptop that should do the work, open a terminal in the repo root, run <span className="mono">git checkout main</span>, <span className="mono">git pull</span> and <span className="mono">npm install</span>,
        then <span className="mono">npm run control</span>, and open the pairing link it prints (or enter its code in the Control tab). Then pick the repository here.
        (If npm says <span className="mono">Missing script: "control"</span>, that checkout isn't on an up-to-date main.)
      </div>
    );
  }
  const locked = status.processes.some((p) => p.status === 'running' && p.key !== 'clone');
  async function set(repo: string): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      await send('repo', { repo });
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
        {repoLabel ? <span className="mono ellipsis cc-repo">{repoLabel}</span> : <span className="cc-repo" style={{ fontWeight: 600 }}>Choose a repository</span>}
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
