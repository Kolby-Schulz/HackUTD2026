// Live tests for the Contract MCP server: two real MCP server processes (one per worker),
// spoken to over stdio by the MCP SDK client exactly as Claude Code would, against a
// running SpacetimeDB. Covers the spec section 14 Rule 1 scenario and the Rule 2 reuse path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connect, DbConnection, type ContractClient } from '@contract/client';
import { TOOLS } from '../src/index';
import { LIVE_DB, LIVE_WS } from './env';

const RUN = Math.random().toString(36).slice(2, 8);
const id = (n: string) => `${n}-${RUN}`;
const FEES = 'src/billing/fees.ts#calculateFee';
const CHECKOUT = 'src/checkout/checkout.ts#checkout';
const DATE = 'src/utils/date.ts#formatDate';
const SERVER = fileURLToPath(new URL('../src/index.ts', import.meta.url));

// A demo-repo-like folder so get_context can estimate the tokens it saved.
const repoDir = mkdtempSync(join(tmpdir(), 'contract-mcp-'));
mkdirSync(join(repoDir, 'src/billing'), { recursive: true });
writeFileSync(
  join(repoDir, 'src/billing/fees.ts'),
  `export function calculateFee(amountCents: number): number {\n${'  // fee rules\n'.repeat(80)}  return Math.floor(amountCents * 0.029);\n}\n`,
);

type Tool = { text: string; isError: boolean; json: () => any };

/** One worker: its ContractClient (the worker script's side) and its MCP server process. */
interface Worker {
  contract: ContractClient;
  mcp: Client;
  call: (name: string, args?: Record<string, unknown>) => Promise<Tool>;
}

async function startWorker(agentId: string, taskId: bigint): Promise<Worker> {
  const contract = await connect({
    host: LIVE_WS,
    dbName: LIVE_DB,
    agent: { id: agentId, name: agentId, ownerDev: 'live-test', machine: 'ci', model: 'claude-code', tokenBudget: 200_000 },
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', SERVER],
    env: {
      ...(process.env as Record<string, string>),
      CONTRACT_AGENT_ID: agentId,
      CONTRACT_TOKEN: contract.token,
      CONTRACT_TASK_ID: String(taskId),
      CONTRACT_REPO_DIR: repoDir,
      SPACETIME_HOST: LIVE_WS,
      SPACETIME_DB_NAME: LIVE_DB,
    },
    stderr: 'pipe',
  });
  const mcp = new Client({ name: 'live-test', version: '0' });
  await mcp.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Tool> => {
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0].text;
    return { text, isError: !!r.isError, json: () => JSON.parse(text) };
  };
  return { contract, mcp, call };
}

function rawConnect(): Promise<DbConnection> {
  return new Promise((res, rej) => {
    const conn: DbConnection = DbConnection.builder()
      .withUri(LIVE_WS)
      .withDatabaseName(LIVE_DB)
      .onConnect(() => conn.subscriptionBuilder().onApplied(() => res(conn)).subscribeToAllTables())
      .onConnectError((_c, e) => rej(e))
      .build();
  });
}

async function waitFor<T>(check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const rows = <T>(it: Iterable<T>) => [...it];

/**
 * The worker's next non-empty get_instructions list, or undefined while there is none yet.
 * The empty reply is plain text ("No new instructions. Continue your task.") that also contains
 * the word "instructions", so match the JSON reply, not the word: the MCP server's own cache
 * can trail the admin connection by a few ms.
 */
async function nextInstructions(w: Worker): Promise<{ text: string }[] | undefined> {
  const g = await w.call('get_instructions');
  if (g.isError || !g.text.trimStart().startsWith('{')) return undefined;
  const list = g.json().instructions as { text: string }[] | undefined;
  return list?.length ? list : undefined;
}

let admin: DbConnection; // plays the mapper, the seed script and the coordinator
let a: Worker;
let b: Worker;

beforeAll(async () => {
  admin = await rawConnect();
  await admin.reducers.registerAgent({ id: 'coordinator', name: 'coordinator', ownerDev: 'live-test', machine: 'ci', model: 'x', tokenBudget: 0n });
  await admin.reducers.upsertSymbols({
    file: 'src/billing/fees.ts',
    symbols: [{ id: FEES, name: 'calculateFee', kind: 'function', signature: 'calculateFee(amountCents: number): number', signatureHash: 'h1', behaviorNote: 'rounds down' }],
    edges: [],
  });
  await admin.reducers.upsertSymbols({
    file: 'src/checkout/checkout.ts',
    symbols: [{ id: CHECKOUT, name: 'checkout', kind: 'function', signature: 'checkout(cart: Cart): Receipt', signatureHash: 'h1', behaviorNote: '' }],
    edges: [{ callerId: CHECKOUT, calleeId: FEES }],
  });
  await admin.reducers.upsertSymbols({
    file: 'src/utils/date.ts',
    symbols: [{ id: DATE, name: 'formatDate', kind: 'function', signature: 'formatDate(d: Date): string', signatureHash: 'h1', behaviorNote: '' }],
    edges: [],
  });
  await admin.reducers.startRun({ mode: 'with_contract', seed: 7 }).catch(() => {}); // a run may already be open
  a = await startWorker(id('agent-a'), 1n);
  b = await startWorker(id('agent-b'), 2n);
});

afterAll(async () => {
  for (const w of [a, b]) {
    await w?.mcp.close().catch(() => {});
    await w?.contract.disconnect();
  }
  admin?.disconnect();
});

describe('contract mcp over stdio', () => {
  it('lists the seven spec tools', async () => {
    // Act
    const { tools } = await a.mcp.listTools();

    // Assert
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
  });

  it('find_existing suggests formatDate and logs one reuse saving', async () => {
    // Act
    const r = await a.call('find_existing', { name: 'toDisplayDate', params: ['Date'], returns: 'string' });
    await a.call('find_existing', { name: 'toDisplayDate', params: ['Date'], returns: 'string' });

    // Assert
    expect(r.json().matches[0]).toMatchObject({ symbol_id: DATE });
    expect(r.json().advice).toMatch(/Reuse/);
    const savings = await waitFor(() => {
      const s = rows(admin.db.tokenSaving.iter()).filter((x) => x.agentId === id('agent-a') && x.kind === 'reuse');
      return s.length ? s : undefined;
    });
    await new Promise((r) => setTimeout(r, 200)); // a second (wrong) row would arrive by now
    expect(rows(admin.db.tokenSaving.iter()).filter((x) => x.agentId === id('agent-a') && x.kind === 'reuse')).toHaveLength(savings.length);
    expect(savings).toHaveLength(1);
  });

  it('get_context returns the slice with callers and logs a context_slice saving', async () => {
    // Act
    const r = await a.call('get_context', { symbol_ids: [FEES] });

    // Assert
    const slice = r.json();
    expect(slice[0]).toMatchObject({ id: FEES, behaviorNote: 'rounds down', callers: [CHECKOUT] });
    await waitFor(() => rows(admin.db.tokenSaving.iter()).find((x) => x.agentId === id('agent-a') && x.kind === 'context_slice'));
  });

  it('declare_plan with an unknown symbol is a tool error with an id hint', async () => {
    // Act
    const r = await a.call('declare_plan', { summary: 'bad', items: [{ symbol_id: 'src/nope.ts#ghost', intent: 'modify' }] });

    // Assert
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/unknown symbol.*find_existing/s);
  });

  it("declare_plan returns Rule 2's reuse instruction right away (duplicate formatter)", async () => {
    // Act: B plans to call calculateFee and to write its own date formatter.
    const r = await b.call('declare_plan', {
      summary: 'receipt',
      items: [
        { symbol_id: FEES, intent: 'depend' },
        { symbol_id: 'src/checkout/receipt.ts#format_date', intent: 'create' },
      ],
    });

    // Assert
    expect(r.isError).toBe(false);
    // formatDate came from the mapper (pre-existing code, no creating agent), so Rule 2 sends a
    // reuse hint rather than opening a duplicate conflict (server checkDuplicates, PR #12).
    expect(r.json().instructions.map((i: { text: string }) => i.text)).toEqual([
      `${DATE} may already do this (same normalized name 'formatdate'); reuse it if it fits instead of writing src/checkout/receipt.ts#format_date.`,
    ]);
    const plan = rows(admin.db.plan.iter()).find((p) => p.agentId === id('agent-b') && p.active);
    expect(plan?.taskId).toBe(2n);
    // Delivered once: acked, so get_instructions doesn't repeat it.
    expect((await b.call('get_instructions')).text).toMatch(/No new instructions/);
  });

  it('claim_symbol: A takes calculateFee, B is told A holds it (Rule 3)', async () => {
    // Arrange
    await a.call('declare_plan', { summary: 'half-up fees', items: [{ symbol_id: FEES, intent: 'modify' }] });

    // Act
    const mine = await a.call('claim_symbol', { symbol_id: FEES });
    const theirs = await b.call('claim_symbol', { symbol_id: FEES });

    // Assert
    expect(mine.isError).toBe(false);
    expect(theirs.isError).toBe(true);
    expect(theirs.text).toMatch(new RegExp(`claimed by ${id('agent-a')}`));
    await waitFor(() =>
      rows(admin.db.conflict.iter()).find((c) => c.kind === 'claim_contention' && c.agentB === id('agent-b') && c.symbolId === FEES),
    );
  });

  it('Rule 1: report_change pauses B; B sees the notice, then the coordinator decision', async () => {
    // Act 1: A changes how calculateFee rounds.
    const r = await a.call('report_change', { symbol_id: FEES, kind: 'behavior', description: 'rounds half-up to the cent' });

    // Assert 1
    expect(r.isError).toBe(false);
    await waitFor(() => admin.db.agent.id.find(id('agent-b'))?.status === 'paused');
    const notice = await waitFor(() => nextInstructions(b));
    expect(notice.map((i: { text: string }) => i.text)).toEqual([`${FEES} was changed by ${id('agent-a')}. Pause and wait for the coordinator.`]);
    const conflict = rows(admin.db.conflict.iter()).find(
      (c) => c.kind === 'broken_dependency' && c.agentB === id('agent-b') && c.status === 'open',
    )!;
    expect(conflict).toBeDefined();

    // Act 2: the coordinator takes the conflict, then resolves it.
    await admin.reducers.markConflictResolving({ conflictId: conflict.id });
    await expect(admin.reducers.markConflictResolving({ conflictId: conflict.id })).rejects.toThrow(/is resolving, not open/);
    await admin.reducers.resolveConflict({
      conflictId: conflict.id,
      ownerAgent: id('agent-a'),
      instructionsA: 'Keep the half-up rounding.',
      instructionsB: 'Do not round again in checkout; use calculateFee as is.',
      reason: 'A owns fee rounding.',
    });

    // Assert 2
    await waitFor(() => admin.db.agent.id.find(id('agent-b'))?.status === 'working');
    const decision = await waitFor(() => nextInstructions(b));
    expect(decision.map((i: { text: string }) => i.text)).toEqual(['Do not round again in checkout; use calculateFee as is.']);
    await waitFor(() =>
      rows(admin.db.instruction.iter())
        .filter((i) => i.agentId === id('agent-b'))
        .every((i) => i.acknowledged),
    );
  });

  it('release_claim frees calculateFee; releasing again is a tool error', async () => {
    // Act
    const first = await a.call('release_claim', { symbol_id: FEES });
    const again = await a.call('release_claim', { symbol_id: FEES });

    // Assert
    expect(first.isError).toBe(false);
    expect(again.isError).toBe(true);
    await waitFor(() => !admin.db.claim.symbolId.find(FEES));
  });
});
