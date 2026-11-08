import { describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import { createChatStore, GENERAL } from '../chat/store';
import { CONTENTION_THRESHOLD } from '../presence/claims';
import { attachClaims } from '../presence/claims';
import { createCoordinator } from './coordinator';
import type { BoardEvent } from '../core/types';

function setup(extra: Partial<Parameters<typeof createCoordinator>[0]> = {}) {
  let t = 1000;
  const board = createBoard({ now: () => t });
  attachClaims(board, { sweepMs: 0 });
  board.actors.spawn({ id: 'agent-juno', kind: 'agent', name: 'Juno' });
  board.actors.spawn({ id: 'agent-rex', kind: 'agent', name: 'Rex' });
  const chat = createChatStore();
  const ruled: BoardEvent[] = [];
  board.events.subscribe({ kinds: ['conflict.ruled'] }, (e) => ruled.push(e));
  const redirects: Array<[string, number]> = [];
  const co = createCoordinator({ board, chat, pickSlot: () => 6, onRedirect: (a, s) => redirects.push([a, s]), ...extra });
  let n = 0;
  const run = (actor: string, commands: any[]) => board.exec({ actor, opId: `op${++n}`, commands });
  run('human-you', [{ t: 'shape.create', kind: 'frame', props: { x: 0, y: 0, w: 300, h: 300, name: 'Hero section' }, id: 'f1' }]);
  const claim = (a: string) => run(a, [{ t: 'claim.acquire', target: { kind: 'frame', id: 'f1' } }]);
  const poke = (a: string) => { t += 1000; return run(a, [{ t: 'shape.translate', ids: ['f1'], dx: 1, dy: 0 }]); };
  const contend = (loser: string) => { for (let i = 0; i < CONTENTION_THRESHOLD; i++) poke(loser); };
  return { board, chat, co, ruled, redirects, run, claim, contend, poke };
}

describe('coordinator', () => {
  it('stays quiet below the contention threshold', () => {
    const s = setup();
    s.claim('agent-juno');
    s.poke('agent-rex'); s.poke('agent-rex');
    expect(s.co.rulings()).toHaveLength(0);
    expect(s.chat.thread(GENERAL)).toHaveLength(0);
  });

  it('rules once: holder keeps, loser moves to the slot, one card, one event', () => {
    const s = setup();
    s.claim('agent-juno');
    s.contend('agent-rex'); s.poke('agent-rex');
    const rs = s.co.rulings();
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ holder: 'agent-juno', loser: 'agent-rex', slot: 6, human: false });
    expect(rs[0].text).toBe('Juno keeps Hero section; Rex moves to slot 7');
    const cards = s.chat.thread(GENERAL).filter((m) => m.body.kind === 'conflict');
    expect(cards).toHaveLength(1);
    expect(cards[0].text).toBe(rs[0].text);
    expect(s.ruled).toHaveLength(1);
    expect(s.redirects).toEqual([['agent-rex', 6]]);
    // the loser says so in the General thread
    expect(s.chat.thread(GENERAL).some((m) => m.from === 'agent-rex' && m.text.includes('slot 7'))).toBe(true);
  });

  it('overrule swaps the holder, the claim and the slot', () => {
    const s = setup({ pickSlot: (() => { let k = 6; return () => k++; })() });
    s.claim('agent-juno');
    s.contend('agent-rex');
    const r = s.co.overrule(s.co.rulings()[0].conflictId)!;
    expect(r).toMatchObject({ holder: 'agent-rex', loser: 'agent-juno', slot: 7, overruled: 1 });
    expect(s.board.claims.list().map((c) => c.holder)).toEqual(['agent-rex']);
    expect(s.chat.thread(GENERAL).find((m) => m.body.kind === 'conflict')!.text).toBe('Rex keeps Hero section; Juno moves to slot 8 (you overruled)');
    expect(s.ruled).toHaveLength(2);
  });

  it('a human holder always wins and gets no slot; it cannot be overruled', () => {
    const s = setup();
    s.run('human-you', [{ t: 'claim.acquire', target: { kind: 'frame', id: 'f1' } }]);
    s.contend('agent-rex');
    const rs = s.co.rulings();
    expect(rs).toHaveLength(1);
    {
      expect(rs[0]).toMatchObject({ holder: 'human-you', slot: null, human: true });
      expect(s.co.overrule(rs[0].conflictId)).toBeUndefined();
    }
  });
});
