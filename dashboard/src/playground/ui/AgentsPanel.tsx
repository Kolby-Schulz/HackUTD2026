// Agent controls in the right panel: add, pause all, speed, clear board, and the "drive from code"
// snippet. `children` (the presence list) sits between the controls and the footer.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { opId } from '../core/ids';
import { selectIds } from './board/state';
import { viewCenter } from './kit';
import type { SlotProps } from './slotProps';
import '../styles/agents.css';

export function AgentsPanel({ board, rt, cursors, children }: SlotProps & { children?: ReactNode }) {
  const [speed, setSpeed] = useState(1);
  const me = board.me;
  const agents = cursors.filter((c) => c.kind === 'agent');
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
      </div>
      <div className="pg-row">
        <label>Speed</label>
        <div className="pg-seg">
          {[0.5, 1, 2, 4].map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => { setSpeed(v); rt?.setSpeed(v); }}>{v}×</button>
          ))}
        </div>
      </div>
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
