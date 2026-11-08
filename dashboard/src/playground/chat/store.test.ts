import { describe, expect, it, vi } from 'vitest';
import { createBoard } from '../core/commands';
import type { BoardEvent } from '../core/types';
import { chatSayHandler, createChatStore, trimMessages, YOU } from './store';

const agent = { name: 'Iris', color: '#7c3aed' };
const text = (t: string) => ({ kind: 'text' as const, text: t });

describe('chat store', () => {
  it('appends in order per thread', () => {
    const s = createChatStore();
    s.post({ thread: 'a', from: 'a', ...agent, body: text('one') });
    s.post({ thread: 'general', from: YOU, name: 'You', color: '#000', body: text('two') });
    s.post({ thread: 'a', from: 'a', ...agent, body: text('three') });
    expect(s.thread('a').map((m) => m.text)).toEqual(['one', 'three']);
    expect(s.messages()).toHaveLength(3);
  });

  it('counts unread for loud agent messages only, and the active thread stays read', () => {
    const s = createChatStore();
    s.post({ thread: 'a', from: 'a', ...agent, body: text('hi') });
    s.post({ thread: 'a', from: 'a', ...agent, body: { kind: 'status', text: 'drawing' } });
    s.post({ thread: 'a', from: YOU, name: 'You', color: '#000', body: text('mine') });
    expect(s.unread()).toEqual({ a: 1 });
    s.setActive('a');
    expect(s.unread()).toEqual({});
    s.post({ thread: 'a', from: 'a', ...agent, body: { kind: 'action', summary: 'Changed fill', tx: 't1', layers: [] } });
    expect(s.unread()).toEqual({});
    s.setActive('general');
    s.post({ thread: 'a', from: 'a', ...agent, body: text('later') });
    expect(s.unread()).toEqual({ a: 1 });
    s.markRead('a');
    expect(s.unread()).toEqual({});
  });

  it('notifies subscribers and hands out a new array each change', () => {
    const s = createChatStore();
    const cb = vi.fn();
    const off = s.subscribe(cb);
    const before = s.messages();
    const m = s.post({ thread: 'a', from: 'a', ...agent, body: { kind: 'action', summary: 'x', tx: 't', layers: ['s1'] } });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(s.messages()).not.toBe(before);
    s.update(m.id, { body: { kind: 'action', summary: 'x', tx: 't', layers: ['s1'], undone: true } });
    expect(s.thread('a')[0].body).toMatchObject({ undone: true });
    off();
    s.post({ thread: 'a', from: 'a', ...agent, body: text('y') });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('round-trips through toJSON / load, keeping unread counts', () => {
    const s = createChatStore();
    s.post({ thread: 'a', from: 'a', ...agent, body: text('hi'), ctx: 'Frame › Button', shapeId: 's1', pin: 'p1' });
    s.post({ thread: 'a', from: 'a', ...agent, body: text('there') });
    s.markRead('a');
    s.post({ thread: 'a', from: 'a', ...agent, body: text('new') });
    const json = JSON.parse(JSON.stringify(s.toJSON()));
    const t = createChatStore();
    t.load(json);
    expect(t.messages()).toEqual(s.messages());
    expect(t.unread()).toEqual({ a: 1 });
    t.load({ junk: true });
    expect(t.messages()).toHaveLength(3);
  });
});

describe('chat.say through the board', () => {
  it('appends in order and emits message.created with to', () => {
    const store = createChatStore();
    let board: ReturnType<typeof createBoard>;
    board = createBoard({ extra: (a, c) => chatSayHandler(store, board.events, (id) => board.actors.get(id))(a, c) });
    const iris = board.actors.spawn({ kind: 'agent', name: 'Iris' });
    const seen: BoardEvent[] = [];
    board.subscribe({ kinds: ['message.created'] }, (e) => seen.push(e));
    const r = board.exec({
      actor: iris.id, opId: 'o1',
      commands: [
        { t: 'chat.say', thread: iris.id, body: text('first') },
        { t: 'chat.say', thread: 'general', body: text('second'), to: [board.me] },
      ],
    });
    expect(r.ok).toBe(true);
    expect(store.messages().map((m) => m.text)).toEqual(['first', 'second']);
    expect(store.messages()[0].name).toBe('Iris');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ t: 'message.created', thread: 'general', to: [board.me], messageId: store.messages()[1].id });
  });
});

describe('chat store persistence and routing cards (WP-63)', () => {
  it('keeps routedBy and a text override through toJSON/load', () => {
    const s = createChatStore();
    s.post({ thread: 'general', from: 'claude', ...agent, body: { kind: 'routing', to: 'agent-i', why: 'author' }, text: 'Routed to Iris (made this)', routedBy: { to: 'agent-i', why: 'author' } });
    const t = createChatStore();
    t.load(JSON.parse(JSON.stringify(s.toJSON())));
    expect(t.messages()[0].text).toBe('Routed to Iris (made this)');
    expect(t.messages()[0].routedBy).toEqual({ to: 'agent-i', why: 'author' });
  });
  it('caps messages, dropping status and routing lines first', () => {
    const s = createChatStore();
    const mk = (i: number, kind: 'text' | 'status') => ({ thread: 'a', from: 'a', ...agent, id: `m${i}`, body: kind === 'text' ? text('x') : { kind: 'status' as const, text: 's' } });
    s.post(mk(0, 'text'));
    for (let i = 1; i <= 5; i++) s.post(mk(i, 'status'));
    s.load({ v: 1, messages: s.messages(), seen: {} });
    expect(trimMessages(s.messages(), 3).map((m) => m.id)).toEqual(['m0', 'm4', 'm5']);
  });
  it('ignores a corrupt payload and bad seen counters', () => {
    const s = createChatStore();
    s.load('garbage'); s.load({ v: 1, messages: 'no' });
    expect(s.messages()).toEqual([]);
    s.load({ v: 1, messages: [], seen: { a: 'x', b: 2 } });
    expect(s.toJSON().seen).toEqual({ b: 2 });
  });
});
