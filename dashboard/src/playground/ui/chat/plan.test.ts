import { describe, expect, it } from 'vitest';
import type { RouterAgent, RouterInput } from '../../agents/router';
import { routingCard } from '../../agents/router';
import { createThreadStore } from '../../comments/threads';
import type { Shape } from '../../core/types';
import { mkShape } from '../../agents/fakes.test';
import { planMessage } from './plan';
import { routeFor } from '../comments/route';

const iris: RouterAgent = { id: 'agent-iris', name: 'Iris', role: 'Layout' };
const juno: RouterAgent = { id: 'agent-juno', name: 'Juno', role: 'Copy' };
const kai: RouterAgent = { id: 'agent-kai', name: 'Kai' };

function view(shapes: Shape[]) {
  const map = new Map(shapes.map((s) => [s.id, s]));
  const children = new Map<string | null, string[]>();
  for (const s of shapes) children.set(s.parent, [...(children.get(s.parent) ?? []), s.id]);
  return { shapes: map, children };
}
const shapes = [mkShape('f', { kind: 'frame', createdBy: 'human-you' }), mkShape('r', { parent: 'f', createdBy: 'agent-iris', x: 0, y: 0, w: 100, h: 100 })];
const inp = (agents: RouterAgent[], o: Partial<RouterInput> = {}): RouterInput => ({ agents, doc: view(shapes), ...o });

describe('planMessage (General routing)', () => {
  it('splits a landing page request into one request per agent', () => {
    const p = planMessage('build a landing page: hero, stats, profile card', inp([iris, juno, kai]));
    expect(p.deliveries).toHaveLength(3);
    expect(p.deliveries.map((d) => d.text)).toEqual(['build a hero section', 'build a stats widget', 'build a profile card']);
    expect(new Set(p.deliveries.map((d) => d.decision.to)).size).toBe(3);
    expect(p.deliveries.every((d) => d.decision.why === 'split')).toBe(true);
  });
  it('a plain General message goes to one agent, deterministically', () => {
    const a = planMessage('make the title bigger', inp([iris, juno]));
    const b = planMessage('make the title bigger', inp([iris, juno]));
    expect(a.deliveries).toHaveLength(1);
    expect(a.deliveries[0].decision).toEqual(b.deliveries[0].decision);
  });
  it('@mention wins; unknown and ambiguous names stop the send with an error line', () => {
    expect(planMessage('@Juno write a headline', inp([iris, juno])).deliveries[0].decision).toMatchObject({ to: 'agent-juno', why: 'mention' });
    expect(planMessage('@Nobody hi', inp([iris, juno]))).toMatchObject({ errors: ['No agent named @Nobody on this board.'], deliveries: [] });
    const twin = [{ id: 'a1', name: 'Sam A' }, { id: 'a2', name: 'Sam B' }];
    expect(planMessage('@Sam hi', inp(twin)).errors).toHaveLength(1);
  });
  it('a stopped mention is reported and not delivered; @all fans out', () => {
    const p = planMessage('@Iris hi', inp([{ ...iris, stopped: true }, juno]));
    expect(p.stopped.map((a) => a.id)).toEqual(['agent-iris']);
    expect(p.deliveries).toEqual([]);
    expect(planMessage('@all stop', inp([iris, juno])).deliveries.map((d) => d.decision.to)).toEqual(['agent-iris', 'agent-juno']);
  });
  it('a layer note is never split and routes to the layer author', () => {
    const p = planMessage('build a hero, stats and profile card', inp([iris, juno], { shapeId: 'r' }));
    expect(p.deliveries).toHaveLength(1);
    expect(p.deliveries[0].decision).toMatchObject({ to: 'agent-iris', why: 'author', label: 'made this' });
  });
  it('the routing card text names the agent and the reason', () => {
    const d = planMessage('x', inp([iris], { shapeId: 'r' })).deliveries[0].decision;
    expect(routingCard(d, () => 'Iris').text).toBe('Routed to Iris (made this)');
  });
});

describe('routeFor', () => {
  it('uses the router with runtime agents and carries the label', () => {
    const board = { doc: { getState: () => view(shapes) }, actors: { get: (id: string) => ({ id, name: id === 'agent-iris' ? 'Iris' : id }) }, claims: undefined, presence: { get: () => undefined } };
    const rt = { agentIds: () => ['agent-iris'], isStopped: () => false, tasks: () => [] };
    expect(routeFor(board as never, rt as never, 'r')).toEqual({ thread: 'agent-iris', how: 'author', label: 'made this' });
    expect(routeFor(board as never, null, 'r')).toMatchObject({ thread: 'general', how: 'general' });
  });
});

describe('layer comment threads', () => {
  it('create a numbered thread on the layer; a human message forwards once; the agent finishing marks it answered', () => {
    const store = createThreadStore();
    const sent: string[] = [];
    store.onHumanMessage((t, m) => sent.push(`${t.chat}:${m.text}`));
    const t = store.addOnLayer(view(shapes), 'r', { x: 10, y: 20 }, { chat: 'agent-iris', color: '#f00' })!;
    store.reply(t.id, { from: 'you', name: 'You', color: '#00f', text: 'bigger' });
    expect(t.n).toBe(1);
    expect(sent).toEqual(['agent-iris:bigger']);
    store.markAnswered(t.id);
    expect(store.get(t.id)!.state).toBe('answered');
    store.reply(t.id, { from: 'agent-iris', name: 'Iris', color: '#f00', text: 'done' });
    expect(sent).toHaveLength(1);
  });
});
