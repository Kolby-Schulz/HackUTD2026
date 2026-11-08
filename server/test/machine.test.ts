// Laptop daemons (scripts/control.ts): machine rows, pairing, the command queue, process and chat rows.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, mod, all, type Harness, type Who } from './helpers';

const DAEMON: Who = 'mapper'; // any distinct identity works as "the laptop's daemon"
const DASH: Who = 'worker-a'; // a paired dashboard
const STRANGER: Who = 'outsider';

const idOf = (t: Harness, who: Who) => t.as(who, (ctx) => ctx.sender);
const register = (t: Harness, who: Who = DAEMON, id = 'ethan-mbp') => t.as(who, (ctx) => mod.register_machine(ctx, { id }));
const grant = (t: Harness, who: Who, machine_id = 'ethan-mbp', by: Who = DAEMON) => {
  const identity = idOf(t, who); // outside the transaction: the harness can't nest them
  t.as(by, (ctx) => mod.grant_machine_access(ctx, { machine_id, identity, label: who }));
};
const send = (t: Harness, who: Who, action = 'coordinator', args_json = '{}', machine_id = 'ethan-mbp') =>
  t.as(who, (ctx) => mod.send_machine_command(ctx, { machine_id, action, args_json }));

describe('machine daemons', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    register(t);
  });

  it('only paired dashboards (and the daemon) can queue commands', () => {
    expect(() => send(t, STRANGER)).toThrow(/isn't paired/);
    grant(t, DASH);
    send(t, DASH, 'worker', '{"id":"agent-a"}');
    send(t, DAEMON, 'reset');
    expect(all(t.db.machineCommand.iter()).map((c) => [c.action, c.status])).toEqual([['worker', 'pending'], ['reset', 'pending']]);
    expect(() => send(t, DASH, 'rm -rf')).toThrow(/unknown action/);
  });

  it('only the daemon pairs dashboards and finishes commands', () => {
    expect(() => grant(t, STRANGER, 'ethan-mbp', DASH)).toThrow(/another daemon/);
    grant(t, DASH);
    grant(t, DASH); // idempotent
    expect(all(t.db.machineAccess.iter())).toHaveLength(1);
    send(t, DASH);
    const [cmd] = all(t.db.machineCommand.iter());
    expect(() => t.as(DASH, (ctx) => mod.finish_machine_command(ctx, { command_id: cmd.id, ok: true, error: '' }))).toThrow(/another daemon/);
    t.as(DAEMON, (ctx) => mod.finish_machine_command(ctx, { command_id: cmd.id, ok: false, error: 'boom' }));
    expect(t.db.machineCommand.id.find(cmd.id)).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('a dashboard can unpair itself but not others', () => {
    grant(t, DASH);
    grant(t, STRANGER);
    const dash = idOf(t, DASH);
    const stranger = idOf(t, STRANGER);
    expect(() => t.as(STRANGER, (ctx) => mod.revoke_machine_access(ctx, { machine_id: 'ethan-mbp', identity: dash }))).toThrow(/only the daemon/);
    t.as(STRANGER, (ctx) => mod.revoke_machine_access(ctx, { machine_id: 'ethan-mbp', identity: stranger }));
    expect(all(t.db.machineAccess.iter()).map((a) => a.label)).toEqual([DASH]);
  });

  it('another identity takes over a machine id only when it went silent, and loses the old pairings', () => {
    grant(t, DASH);
    send(t, DASH);
    expect(() => register(t, STRANGER)).toThrow(/online with another daemon/);
    t.advance(61);
    register(t, STRANGER);
    const stranger = idOf(t, STRANGER);
    expect(t.db.machine.id.find('ethan-mbp')?.identity.equals(stranger)).toBe(true);
    expect(all(t.db.machineAccess.iter())).toHaveLength(0);
    expect(all(t.db.machineCommand.iter())).toHaveLength(0);
    expect(() => send(t, DASH)).toThrow(/isn't paired/);
  });

  it('caps queued commands, process logs and chat', () => {
    grant(t, DASH);
    for (let i = 0; i < 20; i++) send(t, DASH);
    expect(() => send(t, DASH)).toThrow(/commands waiting/);
    t.as(DAEMON, (ctx) =>
      mod.put_machine_process(ctx, {
        machine_id: 'ethan-mbp', proc_key: 'worker:agent-a', label: 'Worker agent-a', long: true, status: 'running',
        code: undefined, started_at_ms: 1, ended_at_ms: undefined, log: 'x'.repeat(20_000),
      }),
    );
    expect(t.db.machineProcess.key.find('ethan-mbp/worker:agent-a')?.log).toHaveLength(16_000);
    for (let i = 0; i < 205; i++) t.as(DAEMON, (ctx) => mod.post_machine_chat(ctx, { machine_id: 'ethan-mbp', role: 'event', text: `m${i}`, at_ms: i }));
    const chat = all(t.db.machineChat.iter());
    expect(chat).toHaveLength(200);
    expect(chat.map((m) => m.text)).toContain('m204');
    expect(chat.map((m) => m.text)).not.toContain('m0');
  });

  it('pairs through a request only the daemon can accept, and always clears it', () => {
    const proof = 'a'.repeat(64);
    expect(() => t.as(DASH, (ctx) => mod.request_machine_pairing(ctx, { machine_id: 'ethan-mbp', proof: 'nope' }))).toThrow(/sha256/);
    t.as(DASH, (ctx) => mod.request_machine_pairing(ctx, { machine_id: 'ethan-mbp', proof }));
    t.as(STRANGER, (ctx) => mod.request_machine_pairing(ctx, { machine_id: 'ethan-mbp', proof }));
    const [mine, theirs] = all(t.db.machinePairRequest.iter());
    expect(() => t.as(DASH, (ctx) => mod.resolve_machine_pairing(ctx, { request_id: mine.id, accept: true, label: 'x' }))).toThrow(/another daemon/);
    t.as(DAEMON, (ctx) => mod.resolve_machine_pairing(ctx, { request_id: mine.id, accept: true, label: 'browser' }));
    t.as(DAEMON, (ctx) => mod.resolve_machine_pairing(ctx, { request_id: theirs.id, accept: false, label: '' }));
    expect(all(t.db.machinePairRequest.iter())).toHaveLength(0);
    expect(all(t.db.machineAccess.iter()).map((a) => a.label)).toEqual(['browser']);
    send(t, DASH);
    expect(() => send(t, STRANGER)).toThrow(/isn't paired/);
  });

  it('keeps at most 20 pairing requests per machine', () => {
    for (let i = 0; i < 25; i++) t.as(STRANGER, (ctx) => mod.request_machine_pairing(ctx, { machine_id: 'ethan-mbp', proof: 'b'.repeat(64) }));
    expect(all(t.db.machinePairRequest.iter())).toHaveLength(20);
  });
});
