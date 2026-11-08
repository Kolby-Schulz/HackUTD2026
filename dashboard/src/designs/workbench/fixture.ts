// Sample data for the workbench artboards: the planted demo, 70 s into a with-InSync run.
// Two conflicts are resolved and a third is being decided, so agent-b is paused. Everything is
// derived with the dashboard's own model functions, so the "Current" variant matches the real app.
import type { Tables } from '../../model.ts';
import { agentCards, calledAgents, cases, codeMap, coordFocus, coordinator, edits, feed, runWindow, savingsNow, tokenStats } from '../../model.ts';

const T0 = 1_800_000_000_000;
const ts = (sec: number) => ({ toMillis: () => BigInt(T0 + Math.round(sec * 1000)), microsSinceUnixEpoch: BigInt(T0 + Math.round(sec * 1000)) * 1000n });
export const NOW = T0 + 70_000;

const FEES = 'src/billing/fees.ts#calculateFee';
const LATE = 'src/billing/fees.ts#calculateLateFee';
const INVOICE = 'src/billing/invoice.ts#buildInvoice';
const TOTAL = 'src/checkout/checkout.ts#computeTotal';
const RECEIPT = 'src/checkout/checkout.ts#buildReceipt';
const DATES = 'src/billing/dates.ts#formatDate';
const CENTS = 'src/billing/money.ts#formatCents';

let n = 0;
const usage = (sec: number, runId: number, agentId: string, prompt: number, completion: number, extra: Record<string, unknown> = {}) => ({
  id: BigInt(++n), runId: BigInt(runId), agentId, taskId: 1n, attempt: 1, purpose: 'code', promptTokens: prompt, completionTokens: completion,
  wasted: false, createdAt: ts(sec), cacheReadTokens: 0, costUsd: 0.02, ...extra,
});

const agent = (id: string, name: string, status: string, task?: bigint) => ({
  id, identity: {}, name, ownerDev: id, machine: id === 'agent-b' ? 'ethan-mbp' : 'kolby-mbp', model: 'claude-code', status,
  currentTaskId: task, tokenBudget: 120000n, lastHeartbeat: ts(68),
});
const sym = (id: string, version = 1, signature = `${id.split('#')[1]}()`) => ({
  id, name: id.split('#')[1], kind: 'function', file: id.split('#')[0], signature, signatureHash: 'h', behaviorNote: '', version, updatedAt: ts(0),
});

const DIFF_A = `--- a/src/billing/fees.ts
+++ b/src/billing/fees.ts
@@ -1,6 +1,8 @@
 export const FEE_BPS = 250;

 export function calculateFee(amountCents: number): number {
-  return Math.floor((amountCents * FEE_BPS) / 10000);
+  // half-up to the cent (1020 -> 26, was 25)
+  return Math.round((amountCents * FEE_BPS) / 10000);
 }
+
+export const calculateLateFee = (amountCents: number): number => calculateFee(amountCents) * 2;`;

const DIFF_B = `--- a/src/checkout/checkout.ts
+++ b/src/checkout/checkout.ts
@@ -10,4 +10,10 @@ export function computeTotal(cart: Cart): number {
   return subtotal + calculateFee(subtotal);
 }
+
+export function buildReceipt(order: Order): Receipt {
+  const total = computeTotal(order.cart);
+  return { id: order.id, total: formatCents(total), date: formatDate(order.date) };
+}`;

export const tables = {
  agents: [agent('agent-a', 'agent-a', 'working', 1n), agent('agent-b', 'agent-b', 'paused', 2n), agent('coordinator', 'Coordinator', 'working')],
  tasks: [
    { id: 1n, title: 'Add late fees to invoices', description: '', agentId: 'agent-a', status: 'in_progress', attempt: 1, runId: 2n },
    { id: 2n, title: 'Add a receipt to checkout', description: '', agentId: 'agent-b', status: 'paused', attempt: 1, runId: 2n },
  ],
  symbols: [sym(INVOICE), sym(FEES, 2, 'calculateFee(amountCents: number): number'), sym(TOTAL), sym(CENTS), sym(LATE)],
  edges: [
    { id: 1n, callerId: INVOICE, calleeId: FEES }, { id: 2n, callerId: TOTAL, calleeId: FEES },
    { id: 3n, callerId: INVOICE, calleeId: CENTS }, { id: 4n, callerId: LATE, calleeId: FEES },
  ],
  plans: [
    { id: 1n, agentId: 'agent-a', taskId: 1n, summary: 'Round fees half-up, add late fee', active: true, createdAt: ts(2) },
    { id: 2n, agentId: 'agent-b', taskId: 2n, summary: 'Receipt with total and date', active: true, createdAt: ts(3) },
  ],
  planItems: [
    { id: 1n, planId: 1n, agentId: 'agent-a', symbolId: FEES, intent: 'modify' },
    { id: 2n, planId: 1n, agentId: 'agent-a', symbolId: DATES, intent: 'create', signature: 'formatDate(d: Date): string' },
    { id: 3n, planId: 2n, agentId: 'agent-b', symbolId: TOTAL, intent: 'depend' },
    { id: 4n, planId: 2n, agentId: 'agent-b', symbolId: RECEIPT, intent: 'create', signature: 'buildReceipt(order: Order): Receipt' },
  ],
  claims: [{ symbolId: FEES, agentId: 'agent-a', claimedAt: ts(4), expiresAt: ts(304) }],
  changes: [
    { id: 1n, agentId: 'agent-a', symbolId: FEES, kind: 'behavior', oldSignature: undefined, newSignature: undefined, description: 'Rounds half-up to the cent', createdAt: ts(28) },
    { id: 2n, agentId: 'agent-a', symbolId: LATE, kind: 'created', oldSignature: undefined, newSignature: 'calculateLateFee(amountCents: number): number', description: '', createdAt: ts(58) },
  ],
  conflicts: [
    { id: 1n, kind: 'duplicate', symbolId: DATES, agentA: 'agent-a', agentB: 'agent-b', details: 'agent-b plans to create formatOrderDate, which duplicates agent-a’s planned formatDate (same types (Date) => string).', status: 'resolved', createdAt: ts(6), resolvedAt: ts(16.4) },
    { id: 2n, kind: 'broken_dependency', symbolId: FEES, agentA: 'agent-a', agentB: 'agent-b', details: 'agent-a changed calculateFee to round half-up; agent-b depends on computeTotal, which calls it.', status: 'resolved', createdAt: ts(28), resolvedAt: ts(50.2) },
    { id: 3n, kind: 'broken_dependency', symbolId: LATE, agentA: 'agent-a', agentB: 'agent-b', details: 'agent-a created calculateLateFee on top of calculateFee; agent-b’s receipt total calls computeTotal.', status: 'resolving', createdAt: ts(61), resolvedAt: undefined },
  ],
  decisions: [
    { id: 1n, conflictId: 1n, ownerAgent: 'agent-a', instructionsA: 'Keep formatDate in dates.ts and export it.', instructionsB: 'Don’t create formatOrderDate; import formatDate from billing/dates.ts.', reason: 'agent-a planned it first and it fits both tasks.', createdAt: ts(16.1) },
    { id: 2n, conflictId: 2n, ownerAgent: 'agent-a', instructionsA: 'Keep the half-up rounding in calculateFee.', instructionsB: 'computeTotal already includes the rounded fee; don’t round again in buildReceipt.', reason: 'The task asks for half-up fees; agent-b only reads the total.', createdAt: ts(49.8) },
  ],
  instructions: [
    { id: 1n, agentId: 'agent-a', conflictId: 1n, text: 'Keep formatDate in dates.ts and export it.', acknowledged: true, createdAt: ts(16.4) },
    { id: 2n, agentId: 'agent-b', conflictId: 1n, text: 'Import formatDate from billing/dates.ts.', acknowledged: true, createdAt: ts(16.4) },
    { id: 3n, agentId: 'agent-b', conflictId: 2n, text: 'calculateFee was changed by agent-a. Pause and wait for the coordinator.', acknowledged: true, createdAt: ts(28) },
    { id: 4n, agentId: 'agent-a', conflictId: 2n, text: 'Keep the half-up rounding in calculateFee.', acknowledged: true, createdAt: ts(50.2) },
    { id: 5n, agentId: 'agent-b', conflictId: 2n, text: 'Don’t round again in buildReceipt.', acknowledged: true, createdAt: ts(50.2) },
    { id: 6n, agentId: 'agent-b', conflictId: 3n, text: 'calculateLateFee was created by agent-a. Pause and wait for the coordinator.', acknowledged: false, createdAt: ts(61) },
  ],
  runs: [
    { id: 1n, mode: 'without_contract', seed: 7, startedAt: ts(-900), endedAt: ts(-600) },
    { id: 2n, mode: 'with_contract', seed: 7, startedAt: ts(0), endedAt: undefined },
  ],
  usage: [
    ...Array.from({ length: 14 }, (_, i) => usage(-900 + i * 5, 1, i % 2 ? 'agent-b' : 'agent-a', 9000, 1400, { wasted: i > 9 })),
    usage(10, 2, 'agent-a', 9000, 1200, { cacheReadTokens: 3000 }), usage(22, 2, 'agent-b', 7000, 900, { cacheReadTokens: 2000 }),
    usage(16, 2, 'coordinator', 2600, 400, { purpose: 'coordination' }), usage(40, 2, 'agent-a', 8000, 1500, { cacheReadTokens: 2500 }),
    usage(50, 2, 'coordinator', 3100, 500, { purpose: 'coordination' }), usage(60, 2, 'agent-a', 6000, 1100, { cacheReadTokens: 1800 }),
  ],
  savings: [
    { id: 1n, runId: 2n, agentId: 'agent-b', kind: 'early_stop', tokensAvoidedEst: 6400, note: '', createdAt: ts(29) },
    { id: 2n, runId: 2n, agentId: 'agent-b', kind: 'reuse', tokensAvoidedEst: 1500, note: '', createdAt: ts(17) },
    { id: 3n, runId: 2n, agentId: 'agent-a', kind: 'context_slice', tokensAvoidedEst: 2200, note: '', createdAt: ts(12) },
  ],
  fileEdits: [
    { id: 1n, agentId: 'agent-a', file: 'src/billing/fees.ts', diff: DIFF_A, symbolIds: [FEES, LATE], createdAt: ts(57) },
    { id: 2n, agentId: 'agent-b', file: 'src/checkout/checkout.ts', diff: DIFF_B, symbolIds: [RECEIPT, TOTAL], createdAt: ts(26) },
  ],
} as unknown as Tables;

const run = tables.runs[1];
const w = runWindow(run, NOW);
const all = agentCards(tables, run, NOW);
const called = calledAgents(tables, run, NOW);

export const demo = {
  agents: all.filter((a) => called.has(a.id)),
  waiting: all.filter((a) => !called.has(a.id)),
  coord: coordinator(tables, run, NOW),
  events: feed(tables, w),
  cases: cases(tables, w),
  edits: edits(tables, w),
  map: codeMap(tables, w, NOW),
  focus: coordFocus(tables, w),
  savings: savingsNow(tables, run, NOW),
  tokens: tokenStats(tables, run),
};
