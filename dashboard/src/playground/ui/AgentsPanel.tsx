// Agent controls in the right panel: add, pause all, speed, clear board, and the "drive from code"
// snippet. `children` (the presence list) sits between the controls and the footer.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { setActionRuntime } from '../actions/agents';
import { probeBridge } from '../agents/llm';
import { formatChip, usageStore } from '../agents/usage';
import { toast } from '../core/toast';
import { opId } from '../core/ids';
import { selectIds } from './board/state';
import { viewCenter } from './kit';
import type { SlotProps } from './slotProps';
import '../styles/agents.css';

const BRIDGE_KEY = 'pg.llmBridge';
const readBridge = () => { try { return localStorage.getItem(BRIDGE_KEY) ?? ''; } catch { return ''; } };

/** Totals, per-agent chips and the optional local-bridge URL. Off unless a URL is set. */
function LlmSection({ rt, ids }: { rt: SlotProps['rt']; ids: string[] }) {
  const [, tick] = useState(0);
  const [url, setUrl] = useState(readBridge);
  useEffect(() => usageStore.subscribe(() => tick((n) => n + 1)), []);
  const save = (v: string) => { setUrl(v); try { localStorage.setItem(BRIDGE_KEY, v); } catch { /* storage may be blocked */ } };
  const addLlm = async () => {
    if (!(await probeBridge(url))) { toast('LLM bridge offline', { variant: 'warn', key: 'llm-offline', onceMs: 3000 }); return; }
    try { rt?.spawn({ at: viewCenter(), driver: 'llm' }); } catch { toast('LLM driver is not wired in this build', { variant: 'warn' }); }
  };
  const t = usageStore.totals();
  return (
    <>
      <div className="pg-row">
        <label>LLM bridge</label>
        <input value={url} placeholder="off (http://localhost:8787)" onChange={(e) => save(e.target.value.trim())} aria-label="LLM bridge URL" />
      </div>
      {url && <div className="pg-actions"><button onClick={addLlm}>+ LLM agent</button></div>}
      {t.calls > 0 && (
        <details>
          <summary>Usage {formatChip(t)}</summary>
          {ids.filter((id) => usageStore.get(id).calls > 0).map((id) => {
            const u = usageStore.get(id);
            return <div key={id} className="pg-row"><label>{id}</label><span>{formatChip(u)} · {u.calls} calls · p50 {Math.round(u.p50_ms)} ms</span></div>;
          })}
        </details>
      )}
    </>
  );
}

export function AgentsPanel({ board, rt, cursors, children }: SlotProps & { children?: ReactNode }) {
  const [speed, setSpeed] = useState(() => {
    try { const v = Number(localStorage.getItem('pg.agentSpeed')); return [0, 0.5, 1, 2, 4].includes(v) && localStorage.getItem('pg.agentSpeed') !== null ? v : 1; } catch { return 1; }
  });
  useEffect(() => { rt?.setSpeed(speed); }, [rt]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActionRuntime(rt); return () => setActionRuntime(null); }, [rt]);
  const pickSpeed = (v: number) => {
    setSpeed(v); rt?.setSpeed(v);
    try { localStorage.setItem('pg.agentSpeed', String(v)); } catch { /* storage may be blocked */ }
  };
  const me = board.me;
  const agents = cursors.filter((c) => c.kind === 'agent');
  const allStopped = agents.length > 0 && agents.every((c) => c.state === 'stopped');
  const allPaused = agents.length > 0 && agents.every((c) => c.state === 'paused');

  const clearBoard = () => {
    if (!rt) return;
    const n = rt.agentIds().length;
    selectIds(board, []);
    rt.reset();   // stops every agent; an interrupted build commits what it drew on its next tick
    setTimeout(() => {
      const roots = [...(board.doc.getState().children.get(null) ?? [])];
      if (roots.length) board.exec({ actor: me, opId: opId(me), commands: [{ t: 'shape.delete', ids: roots }], label: 'Clear board' });
      rt.resetSlots();
      for (let i = 0; i < n; i++) rt.spawn({ at: viewCenter() });
    }, 200);
  };

  return (
    <>
      <div className="pg-h">Cursors <span>{cursors.length}</span></div>
      <div className="pg-actions">
        <button className="primary" onClick={() => rt?.spawn({ at: viewCenter() })}>+ Agent</button>
        <button onClick={() => { for (let i = 0; i < 5; i++) rt?.spawn({ at: viewCenter() }); }}>+5</button>
        <button onClick={() => rt?.setAllPaused(!allPaused)}>{allPaused ? 'Resume' : 'Pause'} all</button>
        {allStopped
          ? <button onClick={() => agents.forEach((c) => rt?.restart(c.id))} title="Restart every stopped agent">Restart all</button>
          : <button onClick={() => rt?.stopAll(board.actors.get(me)?.name ?? 'you')} title="Stop every agent (Ctrl/Cmd+Shift+.)">Stop all</button>}
      </div>
      <div className="pg-row">
        <label>Speed</label>
        <div className="pg-seg">
          {[0, 0.5, 1, 2, 4].map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => pickSpeed(v)} title={v === 0 ? 'Step mode' : undefined}>{v === 0 ? 'Step' : `${v}×`}</button>
          ))}
        </div>
      </div>
      {speed === 0 && <div className="pg-actions"><button onClick={() => rt?.step()}>Step</button></div>}
      <LlmSection rt={rt} ids={usageStore.agents()} />
      {children}
      <div className="pg-foot">
        <button onClick={clearBoard}>Clear board</button>
        <details>
          <summary>Drive a cursor from code</summary>
          <pre>{`const id = board.addCursor('Claude')
await board.moveCursor(id, 400, 200)
board.press(id, true)
board.addShape({ x: 400, y: 200,
  w: 160, h: 90, fill: '#a259ff' })
board.exec({ t: 'shape.update',
  ids: [id], patch: { opacity: .5 } })
board.spawnAgent()`}</pre>
        </details>
      </div>
    </>
  );
}
