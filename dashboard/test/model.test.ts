// Unit tests for the table -> panel derivations, using the demo story from spec section 3.
import { describe, expect, it } from 'vitest';
import type { Tables } from '../src/model.ts';
import { agentCards, cases, codeMap, coordinator, edits, feed, modeSummary, runWindow, timeline, tokensOf, tokenStats } from '../src/model.ts';

const T0 = 1_800_000_000_000;
const ts = (sec: number) => ({ toMillis: () => BigInt(T0 + Math.round(sec * 1000)) });
const FEES = 'src/billing/fees.ts#calculateFee';
const TOTAL = 'src/checkout/checkout.ts#computeTotal';
const INVOICE = 'src/billing/invoice.ts#buildInvoice';
const DATES = 'src/billing/dates.ts#formatDate';

function usage(id: number, runId: number, agentId: string, prompt: number, completion: number, extra: Partial<Record<string, unknown>> = {}) {
  return { id: BigInt(id), runId: BigInt(runId), agentId, taskId: 1n, attempt: 1, purpose: 'code', promptTokens: prompt, completionTokens: completion,
    wasted: false, createdAt: ts(id), cacheReadTokens: 0, costUsd: 0.1, ...extra };
}

function story(): Tables {
  const agent = (id: string, name: string, status: string, task: bigint) => ({ id, identity: {}, name, ownerDev: id === 'agent-a' ? 'Alice' : 'Bob', machine: 'laptop', model: 'claude-code', status, currentTaskId: task, tokenBudget: 120000n, lastHeartbeat: ts(0) });
  const sym = (id: string, version = 1) => ({ id, name: id.split('#')[1], kind: 'function', file: id.split('#')[0], signature: `${id.split('#')[1]}()`, signatureHash: 'h', behaviorNote: '', version, updatedAt: ts(0) });
  return {
    agents: [agent('agent-b', 'Agent B', 'paused', 2n), agent('agent-a', 'Agent A', 'working', 1n), agent('coordinator', 'Coordinator', 'working', 0n)],
    tasks: [
      { id: 1n, title: 'Add late fees to invoices', description: '', agentId: 'agent-a', status: 'in_progress', attempt: 1, runId: 2n },
      { id: 2n, title: 'Add a receipt to checkout', description: '', agentId: 'agent-b', status: 'paused', attempt: 2, runId: 2n },
    ],
    symbols: [sym(INVOICE), sym(FEES, 2), sym(TOTAL)],
    edges: [{ id: 1n, callerId: INVOICE, calleeId: FEES }, { id: 2n, callerId: TOTAL, calleeId: FEES }],
    plans: [
      { id: 1n, agentId: 'agent-a', taskId: 1n, summary: 'Round fees half-up', active: true, createdAt: ts(2) },
      { id: 2n, agentId: 'agent-b', taskId: 2n, summary: 'Receipt', active: true, createdAt: ts(3) },
    ],
    planItems: [
      { id: 1n, planId: 1n, agentId: 'agent-a', symbolId: FEES, intent: 'modify' },
      { id: 2n, planId: 1n, agentId: 'agent-a', symbolId: DATES, intent: 'create' },
      { id: 3n, planId: 2n, agentId: 'agent-b', symbolId: FEES, intent: 'depend' },
    ],
    claims: [{ symbolId: FEES, agentId: 'agent-a', claimedAt: ts(4), expiresAt: ts(304) }],
    changes: [{ id: 1n, agentId: 'agent-a', symbolId: FEES, kind: 'behavior', oldSignature: undefined, newSignature: undefined, description: 'Rounds half-up', createdAt: ts(28) }],
    conflicts: [
      { id: 1n, kind: 'duplicate', symbolId: DATES, agentA: 'agent-a', agentB: 'agent-b', details: 'same formatter', status: 'resolved', createdAt: ts(6), resolvedAt: ts(8.7) },
      { id: 2n, kind: 'broken_dependency', symbolId: FEES, agentA: 'agent-a', agentB: 'agent-b', details: 'B depends on it', status: 'resolving', createdAt: ts(28), resolvedAt: undefined },
    ],
    decisions: [{ id: 1n, conflictId: 1n, ownerAgent: 'agent-a', instructionsA: 'own it', instructionsB: 'reuse it', reason: 'planned first', createdAt: ts(8.6) }],
    instructions: [
      { id: 1n, agentId: 'agent-a', conflictId: 1n, text: 'You own formatDate', acknowledged: true, createdAt: ts(8.7) },
      { id: 2n, agentId: 'agent-b', conflictId: 1n, text: 'Reuse formatDate', acknowledged: true, createdAt: ts(8.7) },
      { id: 3n, agentId: 'agent-b', conflictId: 2n, text: 'Pause', acknowledged: false, createdAt: ts(28) },
    ],
    runs: [
      { id: 1n, mode: 'without_contract', seed: 7, startedAt: ts(-500), endedAt: ts(-200) },
      { id: 2n, mode: 'with_contract', seed: 7, startedAt: ts(0), endedAt: undefined },
    ],
    usage: [
      usage(10, 2, 'agent-a', 5000, 1000, { cacheReadTokens: 4000 }), // 2000
      usage(12, 2, 'agent-b', 3000, 500, { wasted: true }), // 3500 wasted
      usage(14, 2, 'coordinator', 1000, 200, { purpose: 'coordination' }), // 1200
      usage(-300, 1, 'agent-a', 9000, 1000), // 10000
      usage(-290, 1, 'agent-b', 4000, 1000, { purpose: 'merge_fix', wasted: true }), // 5000
    ],
    savings: [{ id: 1n, runId: 2n, agentId: 'agent-b', kind: 'early_stop', tokensAvoidedEst: 4000, note: '', createdAt: ts(29) }],
  } as unknown as Tables;
}

const NOW = T0 + 30_000;

describe('tokens', () => {
  it('counts fresh prompt plus completion, not cache reads', () => {
    expect(tokensOf(story().usage[0])).toBe(2000);
  });
  it('splits useful, wasted and Contract’s own for the selected run', () => {
    const t = story();
    const s = tokenStats(t, t.runs[1]);
    expect([s.useful, s.wasted, s.contract, s.total]).toEqual([2000, 3500, 1200, 6700]);
    expect(s.cached).toBe(4000);
    expect(s.savings.find((x) => x.kind === 'early_stop')).toMatchObject({ tokens: 4000, count: 1 });
  });
});

describe('agents', () => {
  it('sorts worker agents, skips the coordinator, and says what a paused agent waits on', () => {
    const t = story();
    const cards = agentCards(t, t.runs[1], NOW);
    expect(cards.map((c) => c.id)).toEqual(['agent-a', 'agent-b']);
    const b = cards[1];
    expect(b.status).toBe('Paused');
    expect(b.waitingOn).toBe('2');
    expect(b.attempt).toBe(2);
    expect(b.wasted).toBe(3500);
    expect(cards[0].claims).toEqual(['calculateFee']);
  });
  it('drops expired claims', () => {
    const t = story();
    expect(agentCards(t, t.runs[1], T0 + 400_000)[0].claims).toEqual([]);
  });
  it('reports the coordinator as working while a conflict is resolving', () => {
    const t = story();
    expect(coordinator(t, t.runs[1], NOW)).toMatchObject({ status: 'Working', note: 'Resolving conflict #2', tokens: 1200 });
  });
});

describe('conflicts', () => {
  it('builds detected / decided / pushed steps', () => {
    const t = story();
    const cs = cases(t, runWindow(t.runs[1], NOW));
    const done = cs.find((c) => c.key === '1')!;
    expect(done.steps.map((s) => [s.label, s.state])).toEqual([['Detected', 'done'], ['Decided', 'done'], ['Pushed', 'done']]);
    expect(done.durationText).toBe('2.6s');
    expect(done.owner?.name).toBe('Agent A');
    const open = cs.find((c) => c.key === '2')!;
    expect(open.open).toBe(true);
    expect(open.steps.map((s) => s.state)).toEqual(['done', 'running', 'waiting']);
  });
  it('folds a conflict, its decision and its pushes into one thread', () => {
    const t = story();
    const w = runWindow(t.runs[1], NOW);
    const cs = cases(t, w);
    const entries = timeline(feed(t, w), cs);
    const thread1 = entries.find((e) => e.type === 'thread' && e.thread.case.key === '1');
    expect(thread1 && thread1.type === 'thread' && thread1.thread.items.map((i) => i.kind)).toEqual(['conflict', 'decision', 'instruction', 'instruction']);
    // plans, claims and changes stay on the rail
    expect(entries.filter((e) => e.type === 'event').map((e) => e.type === 'event' && e.event.kind).sort()).toEqual(['change', 'claim', 'plan', 'plan']);
  });
  it('credits pushes to the coordinator and names the target agent', () => {
    const t = story();
    const ev = feed(t, runWindow(t.runs[1], NOW)).find((e) => e.key === 'push3')!;
    expect(ev.actor.name).toBe('Coordinator');
    expect(ev.verb).toBe('pushed to Agent B');
  });
  it('names the owner by agent name and orders same-instant events cause first', () => {
    const t = story();
    const w = runWindow(t.runs[1], NOW);
    const ev = feed(t, w);
    expect(ev.find((e) => e.kind === 'decision')!.verb).toBe('decided: Agent A owns formatDate');
    // conflict #2 and its pause push share a timestamp: newest-first puts the push above the conflict
    const at28 = ev.filter((e) => e.time === '00:28.0').map((e) => e.kind);
    expect(at28).toEqual(['instruction', 'conflict', 'change']);
    const th = timeline(ev, cases(t, w)).find((e) => e.type === 'thread' && e.thread.case.key === '2');
    expect(th && th.type === 'thread' && th.thread.items.map((i) => i.kind)).toEqual(['conflict', 'instruction']);
  });
});

describe('code map', () => {
  it('puts callers left of callees, marks state, and adds planned creates as ghosts', () => {
    const t = story();
    const m = codeMap(t, runWindow(t.runs[1], NOW), NOW);
    const by = Object.fromEntries(m.nodes.map((n) => [n.name, n]));
    expect(by.buildInvoice.col).toBe(0);
    expect(by.calculateFee.col).toBe(1);
    expect(by.calculateFee.state).toBe('conflict');
    expect(by.formatDate).toMatchObject({ ghost: true, state: 'planned' });
    expect(m.edges.every((e) => e.hot)).toBe(true);
  });
});

describe('scoreboard', () => {
  it('uses finished runs per mode and falls back to a running one', () => {
    const t = story();
    const wo = modeSummary(t, 'without_contract', NOW)!;
    expect(wo).toMatchObject({ runs: 1, running: false, total: 15000, wasted: 5000, mergeFix: 5000, mergeFixAgents: 1 });
    const wi = modeSummary(t, 'with_contract', NOW)!;
    expect(wi).toMatchObject({ runs: 0, running: true, total: 6700, conflictsCaught: 2 });
  });
});

describe('operator messages (issue #11)', () => {
  const withMsgs = () => {
    const t = story();
    t.instructions = [...t.instructions,
      { id: 4n, agentId: 'agent-a', conflictId: undefined, text: 'Operator: use cents everywhere', acknowledged: true, createdAt: ts(20) },
      { id: 5n, agentId: 'agent-a', conflictId: undefined, text: 'Operator: skip the tests', acknowledged: false, createdAt: ts(25) },
      { id: 6n, agentId: 'agent-a', conflictId: undefined, text: 'src/x.ts#f may already do this; reuse it', acknowledged: false, createdAt: ts(26) },
    ] as unknown as Tables['instructions'];
    return t;
  };
  it('lists them on the agent card with read state, without rule hints', () => {
    const a = agentCards(withMsgs(), withMsgs().runs[1], NOW).find((c) => c.id === 'agent-a')!;
    expect(a.messages.map((m) => [m.text, m.acked])).toEqual([['use cents everywhere', true], ['skip the tests', false]]);
  });
  it('shows them in the feed from the operator', () => {
    const t = withMsgs();
    const ev = feed(t, runWindow(t.runs[1], NOW));
    const op = ev.find((e) => e.key === 'push5')!;
    expect(op).toMatchObject({ actor: { id: 'operator', name: 'Operator' }, verb: 'messaged Agent A · delivered', sub: 'skip the tests' });
    expect(ev.find((e) => e.key === 'push4')!.verb).toBe('messaged Agent A · read');
    expect(ev.find((e) => e.key === 'push6')!.actor.id).toBe('coordinator');
  });
});

describe('live code (issue #24)', () => {
  const withEdits = () => {
    const t = story();
    t.fileEdits = [
      { id: 1n, agentId: 'agent-a', file: 'src/billing/fees.ts', diff: '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-  floor\n+  round\n+  // half-up', symbolIds: [FEES], createdAt: ts(27) },
      { id: 2n, agentId: 'agent-b', file: 'src/checkout/checkout.ts', diff: '+x', symbolIds: [TOTAL], createdAt: ts(29) },
      { id: 3n, agentId: 'agent-a', file: 'src/old.ts', diff: '+x', symbolIds: [], createdAt: ts(-300) }, // earlier run
    ] as unknown as Tables['fileEdits'];
    return t;
  };
  it('lists edits in the run, newest first, filtered by symbol', () => {
    const t = withEdits();
    const w = runWindow(t.runs[1], NOW);
    expect(edits(t, w).map((e) => e.id)).toEqual(['2', '1']);
    expect(edits(t, w, FEES)).toMatchObject([{ id: '1', stat: '+2 −1', symbols: ['calculateFee'], agent: { id: 'agent-a' } }]);
  });
  it('puts edit rows in the feed', () => {
    const t = withEdits();
    const ev = feed(t, runWindow(t.runs[1], NOW)).find((e) => e.key === 'edit1')!;
    expect(ev).toMatchObject({ kind: 'edit', verb: 'edited fees.ts (calculateFee)', sub: '+2 −1' });
  });
});
