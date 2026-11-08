import { describe, expect, it } from 'vitest';
import type { Shape } from '../core/types';
import { mkShape } from './fakes.test';
import {
  applyMention, mentionQuery, needsAllConfirm, parseMentions, route, routingCard, splitGeneral, suggestMentions,
} from './router';
import type { RouterAgent, RouterInput } from './router';

const iris: RouterAgent = { id: 'agent-iris', name: 'Iris', role: 'Layout' };
const juno: RouterAgent = { id: 'agent-juno', name: 'Juno', role: 'Copy' };

function doc(shapes: Shape[]) {
  const map = new Map(shapes.map((s) => [s.id, s]));
  const children = new Map<string | null, string[]>();
  for (const s of shapes) children.set(s.parent, [...(children.get(s.parent) ?? []), s.id]);
  return { shapes: map, children };
}
function input(o: Partial<RouterInput> & { agents: RouterAgent[]; at?: Record<string, number[]> }): RouterInput {
  const at = o.at ?? {};
  return {
    doc: doc([mkShape('f', { kind: 'frame', createdBy: 'human-you' }), mkShape('r', { parent: 'f', createdBy: 'human-you', x: 0, y: 0, w: 100, h: 100 })]),
    presence: { get: (id) => (at[id] ? { x: at[id][0], y: at[id][1] } : undefined) },
    ...o,
  };
}

describe('route policy', () => {
  it('a layer inside Iris claim goes to Iris even when Juno is nearer', () => {
    const inp = input({ agents: [iris, juno], at: { 'agent-iris': [900, 900], 'agent-juno': [50, 50] }, shapeId: 'r', claims: { covering: () => [{ holder: 'agent-iris' }] } });
    expect(route(inp)).toMatchObject({ to: 'agent-iris', why: 'claim', label: 'claimed this frame' });
  });
  it('@Juno overrides claim and author', () => {
    const inp = input({ agents: [iris, juno], shapeId: 'r', claims: { covering: () => [{ holder: 'agent-iris' }] } });
    const m = parseMentions('@Juno make it purple', inp.agents);
    expect(route(inp, m)).toMatchObject({ to: 'agent-juno', why: 'mention' });
  });
  it('author, then frame author, then nearest', () => {
    const d = doc([mkShape('f', { kind: 'frame', createdBy: 'agent-juno' }), mkShape('r', { parent: 'f', createdBy: 'agent-iris' }), mkShape('q', { parent: 'f', createdBy: 'human-you' })]);
    const base = { agents: [iris, juno], doc: d, at: { 'agent-iris': [0, 0], 'agent-juno': [10, 10] } };
    expect(route(input({ ...base, shapeId: 'r' }))).toMatchObject({ to: 'agent-iris', why: 'author' });
    expect(route(input({ ...base, shapeId: 'q' }))).toMatchObject({ to: 'agent-juno', why: 'frame-author' });
    const free = doc([mkShape('q', { createdBy: 'human-you', x: 400, y: 0, w: 20, h: 20 })]);
    expect(route(input({ agents: [iris, juno], doc: free, shapeId: 'q', at: { 'agent-iris': [0, 0], 'agent-juno': [405, 5] } }))).toMatchObject({ to: 'agent-juno', why: 'nearest' });
  });
  it('an explicit author field beats the creator; a removed author falls through', () => {
    const d = doc([mkShape('r', { createdBy: 'human-you', author: 'agent-iris' })]);
    expect(route(input({ agents: [iris, juno], doc: d, shapeId: 'r' })).to).toBe('agent-iris');
    expect(route(input({ agents: [juno], doc: d, shapeId: 'r', at: { 'agent-juno': [0, 0] } }))).toMatchObject({ to: 'agent-juno', why: 'nearest' });
  });
  it('text layers prefer a Copy-role agent over a nearer one', () => {
    const d = doc([mkShape('t', { kind: 'text', createdBy: 'human-you', x: 0, y: 0, w: 10, h: 10 })]);
    expect(route(input({ agents: [iris, juno], doc: d, shapeId: 't', at: { 'agent-iris': [0, 0], 'agent-juno': [500, 500] } }))).toMatchObject({ to: 'agent-juno', why: 'role' });
  });
  it('nearest prefers an idle agent; ties go to the shorter queue then name', () => {
    const busyNear = { ...iris, load: 2 };
    expect(route(input({ agents: [busyNear, juno], shapeId: 'r', at: { 'agent-iris': [50, 50], 'agent-juno': [800, 800] } })).to).toBe('agent-juno');
    expect(route(input({ agents: [{ ...juno, load: 1 }, { ...iris, load: 1 }], shapeId: 'r' })).to).toBe('agent-iris');
  });
  it('skips stopped agents and routes to general with no agents', () => {
    expect(route(input({ agents: [{ ...iris, stopped: true }], shapeId: 'r' }))).toMatchObject({ to: 'general', why: 'general', label: 'no agents yet' });
    expect(route(input({ agents: [] }))).toMatchObject({ to: 'general' });
  });
  it('a General message without a layer goes to the least busy agent', () => {
    expect(route(input({ agents: [{ ...iris, load: 3 }, juno] })).to).toBe('agent-juno');
  });
});

describe('mentions', () => {
  const agents = [iris, juno, { id: 'agent-ada', name: 'Ada Lovelace' }, { id: 'agent-ada2', name: 'Ada King' }, { ...juno, id: 'agent-stop', name: 'Sol', stopped: true }];
  it('resolves names case-insensitively, reports unknown, ambiguous and stopped', () => {
    const m = parseMentions('@iris and @JUNO, @Nobody @ada @Sol', agents);
    expect(m.agents.map((a) => a.name)).toEqual(['Iris', 'Juno', 'Sol']);
    expect(m.unknown).toEqual(['Nobody']);
    expect(m.ambiguous).toEqual(['ada']);
    expect(m.stopped.map((a) => a.name)).toEqual(['Sol']);
  });
  it('exact full names disambiguate; emails and code/quotes are ignored', () => {
    expect(parseMentions('@AdaKing hi', agents).agents.map((a) => a.id)).toEqual(['agent-ada2']);
    const m = parseMentions('mail me@iris.com, `@Iris`, "@Juno"', agents);
    expect(m.agents).toEqual([]); expect(m.unknown).toEqual([]);
  });
  it('@all is flagged and guarded above 5 agents', () => {
    expect(parseMentions('@all hi', agents).all).toBe(true);
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `agent-${i}`, name: `A${i}` }));
    expect(needsAllConfirm(many)).toBe(true);
    expect(needsAllConfirm(many.slice(0, 5))).toBe(false);
  });
  it('autocomplete: query at the caret, suggestions, insertion', () => {
    expect(mentionQuery('hey @Ir')).toEqual({ query: 'Ir', start: 4 });
    expect(mentionQuery('hey @Ir there', 7)).toEqual({ query: 'Ir', start: 4 });
    expect(mentionQuery('mail me@x')).toBeNull();
    expect(mentionQuery('say `@Ir')).toBeNull();
    expect(suggestMentions('', agents).map((s) => s.name)).toEqual(['Ada King', 'Ada Lovelace', 'Iris', 'Juno', 'all']);
    expect(suggestMentions('i', agents)[0].name).toBe('Iris');
    expect(suggestMentions('so', agents, { includeStopped: true }).map((s) => s.name)).toEqual(['Sol']);
    const r = applyMention('hey @Ir there', 4, 7, 'Iris');
    expect(r).toEqual({ text: 'hey @Iris  there', caret: 10 });
  });
});

describe('general split (demo beat 3)', () => {
  const three = [iris, juno, { id: 'agent-kai', name: 'Kai' }];
  it('hero, stats, profile card -> one request per agent', () => {
    const parts = splitGeneral('build a landing page: hero, stats, profile card', input({ agents: three }))!;
    expect(parts.map((p) => p.part)).toEqual(['hero', 'stats', 'profile card']);
    expect(new Set(parts.map((p) => p.agent.id)).size).toBe(3);
    expect(parts.map((p) => p.text)).toEqual(['build a hero section', 'build a stats widget', 'build a profile card']);
  });
  it('wraps with fewer agents, prefers idle ones, and ignores single-part or non-build text', () => {
    const parts = splitGeneral('build hero, stats, profile card', input({ agents: [{ ...iris, load: 1 }, juno] }))!;
    expect(parts.map((p) => p.agent.name)).toEqual(['Juno', 'Iris', 'Juno']);
    expect(splitGeneral('build a hero', input({ agents: three }))).toBeNull();
    expect(splitGeneral('what is a hero and stats', input({ agents: three }))).toBeNull();
    expect(splitGeneral('build hero, stats', input({ agents: [] }))).toBeNull();
  });
});

describe('routing card', () => {
  const nameOf = (id: string) => (id === 'agent-iris' ? 'Iris' : id);
  it('reads "Routed to Iris (made this)"', () => {
    expect(routingCard({ to: 'agent-iris', why: 'author', label: 'made this' }, nameOf)).toEqual({
      body: { kind: 'routing', to: 'agent-iris', why: 'author' }, text: 'Routed to Iris (made this)',
    });
  });
  it('maps new reasons onto the frozen body union, and general says no agents', () => {
    expect(routingCard({ to: 'agent-iris', why: 'split', label: 'split by template' }, nameOf).body).toMatchObject({ why: 'manual' });
    expect(routingCard({ to: 'general', why: 'general', label: 'no agents yet' }, nameOf).text).toBe('No agents yet');
  });
});
