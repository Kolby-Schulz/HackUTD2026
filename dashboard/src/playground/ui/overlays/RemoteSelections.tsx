// Other actors' selections (thin outline) and the shapes they are editing (thick outline + name tag),
// in each actor's colour. Screen space: boxes follow the paint frame and labels keep a constant size.
// "Editing" comes from the soft locks (they carry no subscription, so a short interval re-reads them).
// Also draws the pulse ring that PresenceList asks for when you jump to an actor.
import { useCallback, useEffect, useRef, useState } from 'react';
import { absRect } from '../../core/tree';
import type { ActorId, ShapeId } from '../../core/types';
import type { BoardKit } from '../../core/commands';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';
import '../../styles/presence.css';

export interface RemoteOutline { key: string; actor: ActorId; shapeId: ShapeId; editing: boolean }

const MAX_OUTLINES = 200;
const LOCK_POLL_MS = 250;
const PULSE_MS = 1100;

/** Pure: who else is selecting or editing what. A held lock wins over a plain selection of the same shape. */
export function remoteOutlines(board: Pick<BoardKit, 'actors' | 'selection' | 'locks' | 'me'>): RemoteOutline[] {
  const out = new Map<string, RemoteOutline>();
  for (const a of board.actors.list()) {
    if (a.id === board.me) continue;
    for (const id of board.selection.get(a.id).ids) out.set(`${a.id}:${id}`, { key: `${a.id}:${id}`, actor: a.id, shapeId: id, editing: false });
  }
  for (const l of board.locks.list()) {
    if (l.holder === board.me) continue;
    out.set(`${l.holder}:${l.shapeId}`, { key: `${l.holder}:${l.shapeId}`, actor: l.holder, shapeId: l.shapeId, editing: true });
  }
  return [...out.values()].slice(0, MAX_OUTLINES);
}

// ---- pulse (AGENT-20): PresenceList calls pulseActor(id); the overlay shows a ring on that cursor ----
const pulses = new Map<ActorId, number>();
const pulseSubs = new Set<() => void>();
export function pulseActor(id: ActorId, now: number = Date.now()) {
  pulses.set(id, now);
  pulseSubs.forEach((f) => f());
  setTimeout(() => { if (pulses.get(id) === now) { pulses.delete(id); pulseSubs.forEach((f) => f()); } }, PULSE_MS);
}

export function RemoteSelections() {
  const env = useBoardEnv();
  const { board } = env;
  const [list, setList] = useState<RemoteOutline[]>([]);
  const [ringed, setRinged] = useState<ActorId[]>([]);
  const keyRef = useRef('');
  const els = useRef(new Map<string, HTMLDivElement>());
  const rings = useRef(new Map<ActorId, HTMLDivElement>());

  const refresh = useCallback(() => {
    const next = remoteOutlines(board);
    const k = next.map((o) => o.key + (o.editing ? '!' : '')).join('|');
    if (k !== keyRef.current) { keyRef.current = k; setList(next); }
  }, [board]);

  useEffect(() => {
    refresh();
    const offs = [board.selection.subscribe(refresh), board.actors.subscribe(refresh), board.presence.subscribe(refresh)];
    const t = setInterval(refresh, LOCK_POLL_MS);
    return () => { offs.forEach((f) => f()); clearInterval(t); };
  }, [board, refresh]);

  useEffect(() => {
    const sync = () => { setRinged([...pulses.keys()]); env.paint.wake(); };
    pulseSubs.add(sync);
    return () => { pulseSubs.delete(sync); };
  }, [env]);

  usePainter((cam) => {
    const st = board.doc.getState();
    for (const [key, el] of els.current) {
      const o = list.find((x) => x.key === key);
      const s = o && st.shapes.get(o.shapeId);
      const r = o && s && !s.deleted ? absRect(st, o.shapeId) : null;
      if (!r) { el.style.display = 'none'; continue; }
      const p = w2v(cam, r);
      el.style.display = '';
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.style.width = `${r.w * cam.z}px`;
      el.style.height = `${r.h * cam.z}px`;
    }
    for (const [id, el] of rings.current) {
      const p = board.presence.get(id);
      if (p?.x === undefined || p.y === undefined) { el.style.display = 'none'; continue; }
      const v = w2v(cam, { x: p.x, y: p.y });
      el.style.display = '';
      el.style.transform = `translate(${v.x}px, ${v.y}px)`;
    }
  });

  return (
    <>
      {list.map((o) => {
        const a = board.actors.get(o.actor);
        return (
          <div key={o.key} className={'pg-rsel' + (o.editing ? ' editing' : '')} style={{ ['--c' as string]: a?.color, display: 'none' }}
            ref={(el) => { if (el) els.current.set(o.key, el); else els.current.delete(o.key); }}>
            {o.editing && <span className="pg-rtag">{a?.name ?? o.actor}</span>}
          </div>
        );
      })}
      {ringed.map((id) => (
        <div key={id} className="pg-pulse" style={{ ['--c' as string]: board.actors.get(id)?.color, display: 'none' }}
          ref={(el) => { if (el) rings.current.set(id, el); else rings.current.delete(id); }}><i /></div>
      ))}
    </>
  );
}
