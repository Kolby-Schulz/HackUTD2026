// Shared fakes for the agents tests: a virtual clock, a recording PresenceBus and a small FAKE Board.
// (A *.test.ts file so it stays inside the files WP-10 owns; real-board tests are skipped until WP-08.)
import { expect, it } from 'vitest';
import type { Actor, ActorId, Board, Command, Presence, PresenceBus, Result, Shape } from '../core/types';
import type { Clock } from './choreographer';

/** Virtual time: sleep advances `t` at once. Yields to the macrotask queue now and then so polling tests can run. */
export function fakeClock(yieldEvery = 40): Clock & { t: number } {
  let n = 0;
  const c = {
    t: 0,
    now: () => c.t,
    async sleep(ms: number) {
      c.t += ms;
      if (++n % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
    },
  };
  return c;
}

export function fakePresence() {
  const state = new Map<ActorId, Presence>();
  const log: Array<Partial<Presence> & { actor: ActorId }> = [];
  const bus: PresenceBus = {
    publish(p) { log.push(p); state.set(p.actor, { lastInputAt: 0, ...state.get(p.actor), ...p } as Presence); },
    get: (a) => state.get(a),
    subscribe: () => () => {},
  };
  return { bus, log, state };
}

export type GestureRec = { actor: ActorId; label: string; cmds: Command[]; updates: number; committed: boolean; aborted: boolean };
export type Batch = { actor: ActorId; commands: Command[]; label?: string };

export function fakeBoard(o: { shapes?: Shape[] } = {}) {
  const presence = fakePresence();
  const actors = new Map<ActorId, Actor>();
  const gestures: GestureRec[] = [];
  const batches: Batch[] = [];
  const shapes = new Map((o.shapes ?? []).map((s) => [s.id, s]));
  const ok = (): Result => ({ ok: true });
  const board = {
    exec(b: Batch & { opId: string }) {
      batches.push({ actor: b.actor, commands: b.commands, label: b.label });
      return { ok: true, seq: batches.length, results: b.commands.map(ok) };
    },
    gesture(actor: ActorId, label: string) {
      const rec: GestureRec = { actor, label, cmds: [], updates: 0, committed: false, aborted: false };
      gestures.push(rec);
      return {
        update(cmds: Command[]) { rec.cmds = cmds.slice(); rec.updates++; },
        commit() { rec.committed = true; return { ok: true, seq: 1, results: rec.cmds.map(ok) }; },
        abort() { rec.aborted = true; },
      };
    },
    undo: () => false, redo: () => false,
    revert: () => ({ ok: false, error: 'invalid', message: 'fake' }) as Result,
    subscribe: () => () => {},
    snapshot: () => ({ rev: 0, seq: 0, shapes: [...shapes.values()], selection: [], actors: [...actors.values()] }),
    doc: { getState: () => ({ rev: 0, lamport: 0, shapes, children: new Map(), meta: { name: 'fake' } }) },
    presence: presence.bus,
    actors: {
      get: (id: ActorId) => actors.get(id), list: () => [...actors.values()],
      register: (a: Actor) => { actors.set(a.id, a); }, remove: (id: ActorId) => { actors.delete(id); }, subscribe: () => () => {},
    },
  } as unknown as Board;
  return { board, presence, actors, gestures, batches, shapes };
}

export function mkShape(id: string, o: Partial<Shape> = {}): Shape {
  return { id, kind: 'rect', parent: null, index: 'V', createdBy: 'human-you', name: id, x: 0, y: 0, w: 100, h: 50, fills: [{ type: 'solid', color: '#fff' }], stamps: {}, ...o } as Shape;
}

/** Poll (macrotask turns) until `cond` holds or give up. */
export async function until(cond: () => boolean, turns = 4000) {
  for (let i = 0; i < turns && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(cond()).toBe(true);
}

it('fake clock advances virtual time', async () => {
  const c = fakeClock();
  await c.sleep(30);
  expect(c.now()).toBe(30);
});
