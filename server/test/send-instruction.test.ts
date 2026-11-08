// send_instruction (issue #11): operator messages from the dashboard.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, mod, all, type Harness } from './helpers';

const send = (t: Harness, agent_id: string, text: string) =>
  t.as('outsider', (ctx) => mod.send_instruction(ctx, { agent_id, text }));
const texts = (t: Harness, id: string) => all(t.db.instruction.agent_id.filter(id)).map((i) => i.text);
const setStatus = (t: Harness, id: string, status: string) =>
  t.internal((ctx) => ctx.db.agent.id.update({ ...ctx.db.agent.id.find(id)!, status }));

describe('send_instruction', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    for (const id of ['agent-a', 'agent-b', 'agent-c', 'coordinator']) register(t, id);
  });

  it('sends one agent an operator-marked instruction with no conflict', () => {
    send(t, 'agent-a', '  use cents everywhere  ');
    const rows = all(t.db.instruction.agent_id.filter('agent-a'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'Operator: use cents everywhere', acknowledged: false, conflict_id: undefined });
    expect(texts(t, 'agent-b')).toEqual([]);
  });

  it("'*' reaches every working or paused worker, never the coordinator", () => {
    setStatus(t, 'agent-a', 'working');
    setStatus(t, 'agent-b', 'paused');
    setStatus(t, 'coordinator', 'working');
    send(t, '*', 'stop and explain your plan');
    expect(texts(t, 'agent-a')).toEqual(['Operator: stop and explain your plan']);
    expect(texts(t, 'agent-b')).toEqual(['Operator: stop and explain your plan']);
    expect(texts(t, 'agent-c')).toEqual([]); // idle
    expect(texts(t, 'coordinator')).toEqual([]);
  });

  it('rejects empty text, unknown agents, the coordinator, and * with nobody working', () => {
    expect(() => send(t, 'agent-a', '   ')).toThrow(/empty/);
    expect(() => send(t, 'agent-z', 'hi')).toThrow(/unknown agent/);
    expect(() => send(t, 'coordinator', 'hi')).toThrow(/unknown agent/);
    expect(() => send(t, '*', 'hi')).toThrow(/no working agents/);
    expect(all(t.db.instruction.iter())).toEqual([]);
  });
});
