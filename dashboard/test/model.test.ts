// Unit tests for the table -> panel derivations, using the demo story from spec section 3.
import { describe, expect, it } from 'vitest';
import type { MapNode, Tables } from '../src/model.ts';
import { GX, langOf, layoutMap, W } from '../src/mapLayout.ts';
import { agentCards, cases, codeMap, MAP_IDLE_MS, coordinator, edits, feed, modeSummary, replayAt, replayMarks, runWindow, timeline, tokensOf, tokenStats } from '../src/model.ts';

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
    const m = codeMap(t, runWindow(t.runs[1], NOW), NOW, Infinity);
    const by = Object.fromEntries(m.nodes.map((n) => [n.name, n]));
    expect(by.buildInvoice.col).toBe(0);
    expect(by.calculateFee.col).toBe(1);
    expect(by.calculateFee.state).toBe('conflict');
    expect(by.formatDate).toMatchObject({ ghost: true, state: 'planned' });
    expect(m.edges.every((e) => e.hot)).toBe(true);
  });
  it('marks what agents work on as active, their callers as context, and lets work time out', () => {
    const t = story();
    const w = runWindow(t.runs[1], NOW);
    const flags = (now: number) => Object.fromEntries(codeMap(t, w, now).nodes.map((n) => [n.name, n.active ? 'active' : n.context ? 'context' : '-']));
    // every function stays on the map; untouched callers of calculateFee are context
    expect(flags(NOW)).toEqual({ buildInvoice: 'context', computeTotal: 'context', calculateFee: 'active', formatDate: 'active' });
    expect(codeMap(t, w, NOW)).toMatchObject({ total: 3, activeCount: 2 });
    // conflict resolved and claim released: formatDate (last touched at 8.7s) fades, then goes idle
    t.conflicts = t.conflicts.map((c) => ({ ...c, status: 'resolved', resolvedAt: c.resolvedAt ?? ts(29) })) as unknown as Tables['conflicts'];
    t.claims = [];
    const late = T0 + 8_700 + MAP_IDLE_MS;
    expect(codeMap(t, w, late - 10_000).nodes.find((n) => n.name === 'formatDate')!.fading).toBe(true);
    expect(flags(late + 1).formatDate).toBe('-');
    expect(flags(late + 1).calculateFee).toBe('active');
    expect(Object.values(flags(T0 + 29_000 + MAP_IDLE_MS + 1))).toEqual(['-', '-', '-', '-']);
  });
  it('wraps a crowded call-depth level into extra columns instead of one tall one', () => {
    const t = story();
    const extra = Array.from({ length: 100 }, (_, i) => ({ ...t.symbols[0], id: `src/big/f${i}.ts#f${i}`, name: `f${i}`, file: `src/big/f${i}.ts` }));
    t.symbols = [...t.symbols, ...extra] as unknown as Tables['symbols'];
    const m = codeMap(t, runWindow(t.runs[1], NOW), NOW, Infinity);
    const rows = Math.max(...m.nodes.map((n) => n.row)) + 1;
    const cols = Math.max(...m.nodes.map((n) => n.col)) + 1;
    expect(rows).toBeLessThanOrEqual(15);
    expect(cols).toBeGreaterThan(6);
    // callers still sit left of their callees
    const at = Object.fromEntries(m.nodes.map((n) => [n.id, n.col]));
    for (const e of m.edges) expect(at[e.source]).toBeLessThan(at[e.target]);
  });
  it('keeps a claimed function active however long it sits idle', () => {
    const t = story();
    t.conflicts = [];
    t.claims = [{ symbolId: FEES, agentId: 'agent-a', claimedAt: ts(4), expiresAt: ts(10_000) }] as unknown as Tables['claims'];
    const m = codeMap(t, runWindow(t.runs[1], NOW), T0 + 5_000_000);
    expect(m.nodes.filter((n) => n.active).map((n) => n.name)).toEqual(['calculateFee']);
  });
});

describe('code map layout', () => {
  const node = (id: string, col: number, row: number, active = false, context = false) =>
    ({ id, name: id, file: `src/${id}.py`, kind: 'function', version: 1, owners: [], state: 'idle', ghost: false, active, context, fading: false, col, row }) as MapNode;
  // three columns of five; agents work on a0 and c4, a1 calls a0 (context);
  // a0 reaches c4 only through b2 and b3, which are collapsed
  const grid = ['a', 'b', 'c'].flatMap((k, col) => Array.from({ length: 5 }, (_, row) => node(`${k}${row}`, col, row, `${k}${row}` === 'a0' || `${k}${row}` === 'c4', `${k}${row}` === 'a1')));
  const edges = [
    { id: '1', source: 'a1', target: 'a0', hot: false },
    { id: '2', source: 'a0', target: 'b2', hot: false }, { id: '3', source: 'b2', target: 'b3', hot: false }, { id: '4', source: 'b3', target: 'c4', hot: false },
    { id: '5', source: 'b0', target: 'b1', hot: false },
  ];

  it('draws every function when nobody is working or the user expanded the map', () => {
    const idle = grid.map((n) => ({ ...n, active: false, context: false }));
    expect(layoutMap(idle, edges, false)).toMatchObject({ focused: false, shown: 15 });
    const full = layoutMap(grid, edges, true);
    expect(full.items).toHaveLength(15);
    // the agents' section stands out: everything not in play is dimmed
    expect(full.items.filter((i) => !i.dim).map((i) => i.id).sort()).toEqual(['a0', 'a1', 'c4']);
  });
  it('draws only the functions in play, packed, with a "â‹¯" link through collapsed ones', () => {
    const l = layoutMap(grid, edges, false);
    expect(l).toMatchObject({ focused: true, shown: 3 });
    // a1 -> a0 -> (b2, b3 collapsed) -> c4: three columns, nothing else drawn
    expect(l.items.map((i) => `${i.id}@${i.x / (W + GX)},${i.y}`)).toEqual(['a1@0,0', 'a0@1,0', 'c4@2,0']);
    expect(l.items.find((i) => i.id === 'a1')).toMatchObject({ faded: true });
    expect(l.edges).toEqual([
      { id: '1', source: 'a1', target: 'a0', hot: false },
      { id: 'via:a0>c4', source: 'a0', target: 'c4', hot: false, via: true },
    ]);
  });
  it('names the language of a file for its badge', () => {
    expect(langOf('src/a.tsx')?.label).toBe('TS');
    expect(langOf('pkg/x.py')?.name).toBe('Python');
    expect(langOf('main.go')?.label).toBe('GO');
    expect(langOf('README')).toBeUndefined();
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

describe('offline laptops (issue #19)', () => {
  it('marks an agent offline after 45 s without a heartbeat, and shows its last edit', () => {
    const t = story();
    t.fileEdits = [{ id: 1n, agentId: 'agent-a', file: 'src/billing/fees.ts', diff: '+x', symbolIds: [], createdAt: ts(20) }] as unknown as Tables['fileEdits'];
    const at = (n: number) => agentCards(t, t.runs[1], n).find((c) => c.id === 'agent-a')!;
    expect(at(T0 + 30_000)).toMatchObject({ offline: false, lastEdit: { file: 'fees.ts', ago: 10_000 } });
    expect(at(T0 + 46_000).offline).toBe(true);
  });
});

describe('replay (issue #27)', () => {
  const ended = () => {
    const t = story();
    t.runs = [t.runs[0], { ...t.runs[1], endedAt: ts(60) }] as unknown as Tables['runs'];
    t.conflicts = [t.conflicts[0], { ...t.conflicts[1], status: 'resolved', resolvedAt: ts(40) }] as unknown as Tables['conflicts'];
    return t;
  };
  it('drops rows created after T and reopens conflicts resolved later', () => {
    const t = ended();
    const at = (s: number) => replayAt(t, t.runs[1], T0 + s * 1000);
    expect(at(7).conflicts.map((c) => [String(c.id), c.status])).toEqual([['1', 'resolving']]);
    expect(at(30).conflicts.map((c) => [String(c.id), c.status])).toEqual([['1', 'resolved'], ['2', 'resolving']]);
    expect(at(45).conflicts.map((c) => c.status)).toEqual(['resolved', 'resolved']);
    expect(at(11).usage.map((u) => Number(u.id))).toEqual([10]);
    expect(at(13).usage.map((u) => Number(u.id))).toEqual([10, 12, ]);
  });
  it('rebuilds agent states: paused on an open Rule 1 conflict, running before the end', () => {
    const t = ended();
    const cards = (s: number) => agentCards(replayAt(t, t.runs[1], T0 + s * 1000), replayAt(t, t.runs[1], T0 + s * 1000).runs[1], T0 + s * 1000);
    expect(cards(30).find((c) => c.id === 'agent-b')!.status).toBe('Paused');
    expect(cards(45).find((c) => c.id === 'agent-b')!.status).toBe('Working');
    expect(replayAt(t, t.runs[1], T0 + 30_000).runs[1].endedAt).toBeUndefined();
  });
  it('lists conflicts as jump marks', () => {
    const t = ended();
    expect(replayMarks(t, t.runs[1])).toEqual([{ at: 6000, label: '#1 Duplicate implementation' }, { at: 28000, label: '#2 Broken dependency' }]);
  });
});

describe('workbench', () => {
  it('lists every agent planning a ghost symbol, and the holder of a claimed one', async () => {
    const { codeMap } = await import('../src/model.ts');
    const t = story();
    const by = Object.fromEntries(codeMap(t, runWindow(t.runs[1], NOW), NOW, Infinity).nodes.map((n) => [n.name, n]));
    expect(by.formatDate.owners.map((p) => p.id)).toEqual(['agent-a']);
    expect(by.calculateFee.owners.map((p) => p.id)).toEqual(['agent-a']);
    expect(by.buildInvoice.owners).toEqual([]);
  });
  it('tells one symbol\u2019s story oldest first, ending with how its conflict was resolved', async () => {
    const { symbolHistory } = await import('../src/model.ts');
    const t = story();
    const h = symbolHistory(t, runWindow(t.runs[1], NOW), DATES);
    expect(h.map((x) => x.tone)).toEqual(['plan', 'conflict', 'resolved']);
    expect(h[2].title).toBe('Resolved in 2.6s');
  });
  it('measures tokens saved against the last without run at the same point, never estimated', async () => {
    const { savingsNow } = await import('../src/model.ts');
    const t = story();
    expect(savingsNow(t, t.runs[1], NOW)).toEqual({ current: 6700, base: 0, saved: 0 });
    expect(savingsNow(t, t.runs[1], T0 + 220_000)).toEqual({ current: 6700, base: 15000, saved: 8300 });
    expect(savingsNow(t, t.runs[0], NOW)).toEqual({ current: 15000 });
  });
  it('puts the coordinator on the open conflict and the run in the code stage after a change', async () => {
    const { coordFocus, runStage } = await import('../src/model.ts');
    const t = story();
    const w = runWindow(t.runs[1], NOW);
    expect(coordFocus(t, w)).toEqual({ symbolId: FEES, conflict: '2', resolving: true });
    expect(runStage(t, t.runs[1], w)).toBe('Code');
    expect(runStage(t, t.runs[0], runWindow(t.runs[0], NOW))).toBe('Merge');
  });
});

describe('changes tab', () => {
  it('numbers diff lines from the hunk header and drops file headers', async () => {
    const { diffLines } = await import('../src/Changes.tsx');
    const d = 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -10,3 +10,3 @@ export function fee()\n const a = 1;\n-return Math.trunc(fee);\n+return Math.round(fee * 100) / 100;\n }\n';
    const l = diffLines(d);
    expect(l.map((x) => x.kind)).toEqual(['hunk', 'ctx', 'del', 'add', 'ctx']);
    expect(l[1]).toMatchObject({ oldNo: 10, newNo: 10 });
    expect(l[2]).toMatchObject({ oldNo: 11, text: 'return Math.trunc(fee);' });
    expect(l[3]).toMatchObject({ newNo: 11 });
    expect(l[4]).toMatchObject({ oldNo: 12, newNo: 12 });
    expect(l[0].text).toBe('export function fee()');
  });
});

describe('called agents', () => {
  it('lists agents with work in the run and leaves registered idle workers out', async () => {
    const { calledAgents } = await import('../src/model.ts');
    const t = story();
    const c = { ...t.agents[0], id: 'agent-c', name: 'Agent C', status: 'idle', currentTaskId: undefined };
    const withC = { ...t, agents: [...t.agents, c] } as unknown as Tables;
    expect([...calledAgents(withC, withC.runs[1], NOW)].sort()).toEqual(['agent-a', 'agent-b']);
    expect(calledAgents(withC, undefined, NOW).size).toBe(0);
  });
});
