// The Contract MCP tools, driven through a real MCP client over an in-memory
// transport, against a fake ContractClient.
import { describe, it, expect, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ClaimedError, noopClient, type ContractClient, type Instruction } from '@contract/client';
import { createServer, TOOLS } from '../src/index.ts';
import { CONTRACT_RULES } from '../../../agents/worker/src/rules.ts';

type Call = [string, ...unknown[]];

function fakeClient() {
  const calls: Call[] = [];
  const pending: Instruction[] = [];
  const base = noopClient('agent-a', async () => {});
  const c: ContractClient = {
    ...base,
    publishPlan: async (...a) => void calls.push(['publishPlan', ...a]),
    claim: async (id) => {
      calls.push(['claim', id]);
      if (id === 'taken') throw new ClaimedError(id, 'agent-b');
    },
    release: async (id) => void calls.push(['release', id]),
    reportChange: async (...a) => {
      calls.push(['reportChange', ...a]);
      if (a[0] === 'nope') throw new Error("plan item references unknown symbol 'nope'");
    },
    getContext: async (ids) =>
      ids.includes('src/a.ts#f') ? [{ id: 'src/a.ts#f', signature: 'f(): void', behaviorNote: '', callers: [], callees: [] }] : [],
    findExisting: async (q) =>
      q.name === 'format_date' ? [{ symbolId: 'src/util.ts#formatDate', signature: 'formatDate(d: Date): string', score: 1 }] : [],
    pendingInstructions: () => pending.filter((i) => !i.acknowledged),
    ack: async (id) => {
      const i = pending.find((p) => p.id === id);
      if (i) i.acknowledged = true;
    },
    logSaving: async (...a) => void calls.push(['logSaving', ...a]),
    getSummary: async (file) => (file === 'src/a.ts' ? 'f: does nothing.' : undefined),
    putSummary: async (...a) => {
      calls.push(['putSummary', ...a]);
      if (a[0] === 'missing.ts') throw new Error("putSummary: can't read missing.ts");
    },
  };
  return { c, calls, pending };
}

async function setup() {
  const f = fakeClient();
  const server = createServer(Promise.resolve(f.c), 7n);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0].text, isError: !!r.isError };
  };
  return { ...f, client, call };
}

describe('contract mcp tools', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });

  it('lists exactly the spec tools', async () => {
    // Act
    const { tools } = await t.client.listTools();

    // Assert
    expect(tools.map((x) => x.name).sort()).toEqual([...TOOLS].sort());
  });

  it('declare_plan publishes with the task id and returns pending instructions once', async () => {
    // Arrange
    t.pending.push({ id: 1n, agentId: 'agent-a', text: 'Reuse formatDate', acknowledged: false });

    // Act
    const r = await t.call('declare_plan', { summary: 'late fees', items: [{ symbol_id: 'src/a.ts#f', intent: 'modify' }] });
    const again = await t.call('get_instructions');

    // Assert
    expect(t.calls[0]).toEqual(['publishPlan', 7n, 'late fees', [{ symbolId: 'src/a.ts#f', intent: 'modify' }]]);
    expect(JSON.parse(r.text).instructions).toEqual([{ id: '1', text: 'Reuse formatDate' }]);
    expect(again.text).toMatch(/No new instructions/);
  });

  it('declare_plan forwards the signature of a planned create', async () => {
    // Act
    await t.call('declare_plan', {
      summary: 'receipt',
      items: [{ symbol_id: 'src/r.ts#formatOrderDate', intent: 'create', signature: 'formatOrderDate(d: Date): string' }],
    });

    // Assert
    expect(t.calls[0]).toEqual([
      'publishPlan',
      7n,
      'receipt',
      [{ symbolId: 'src/r.ts#formatOrderDate', intent: 'create', signature: 'formatOrderDate(d: Date): string' }],
    ]);
  });

  it('claim_symbol reports who holds a taken symbol as a tool error', async () => {
    // Act
    const r = await t.call('claim_symbol', { symbol_id: 'taken' });

    // Assert
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/claimed by agent-b/);
  });

  it('claim_symbol and release_claim pass through', async () => {
    // Act
    const a = await t.call('claim_symbol', { symbol_id: 'src/a.ts#f' });
    const b = await t.call('release_claim', { symbol_id: 'src/a.ts#f' });

    // Assert
    expect([a.isError, b.isError]).toEqual([false, false]);
    expect(t.calls).toEqual([['claim', 'src/a.ts#f'], ['release', 'src/a.ts#f']]);
  });

  it('report_change forwards kind, signature and description', async () => {
    // Act
    await t.call('report_change', { symbol_id: 'src/a.ts#f', kind: 'behavior', description: 'rounds half-up' });

    // Assert
    expect(t.calls[0]).toEqual(['reportChange', 'src/a.ts#f', 'behavior', { newSignature: undefined, description: 'rounds half-up' }]);
  });

  it('turns server errors into tool errors with an id hint', async () => {
    // Act
    const r = await t.call('report_change', { symbol_id: 'nope', kind: 'behavior', description: 'x' });

    // Assert
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/unknown symbol.*find_existing/);
  });

  it('get_context returns the slice, or an error for unknown ids', async () => {
    // Act
    const hit = await t.call('get_context', { symbol_ids: ['src/a.ts#f'] });
    const miss = await t.call('get_context', { symbol_ids: ['x'] });

    // Assert
    expect(JSON.parse(hit.text)[0].signature).toBe('f(): void');
    expect(miss.isError).toBe(true);
  });

  it('find_existing logs one reuse saving per matched symbol', async () => {
    // Act
    const r = await t.call('find_existing', { name: 'format_date' });
    await t.call('find_existing', { name: 'format_date' });
    await t.call('find_existing', { name: 'nothing' });

    // Assert
    expect(JSON.parse(r.text).advice).toMatch(/Reuse src\/util.ts#formatDate/);
    const savings = t.calls.filter((c) => c[0] === 'logSaving');
    expect(savings).toHaveLength(1);
    expect(savings[0].slice(0, 2)).toEqual(['logSaving', 'reuse']);
  });

  it('get_summary returns a cached summary, or tells the model to read and put_summary', async () => {
    // Act
    const hit = await t.call('get_summary', { file: 'src/a.ts' });
    const miss = await t.call('get_summary', { file: 'src/b.ts' });

    // Assert
    expect(JSON.parse(hit.text)).toEqual({ file: 'src/a.ts', summary: 'f: does nothing.' });
    expect(miss.isError).toBe(false);
    expect(miss.text).toMatch(/No cached summary for src\/b.ts.*put_summary/);
  });

  it('put_summary passes the file, summary and a token estimate; bad paths are tool errors', async () => {
    // Act
    const r = await t.call('put_summary', { file: 'src/a.ts', summary: 'f: does nothing at all.' });
    const bad = await t.call('put_summary', { file: 'missing.ts', summary: 'x' });

    // Assert
    expect(r.text).toBe('cached summary of src/a.ts');
    const [, file, summary, tokens] = t.calls[0];
    expect([file, summary]).toEqual(['src/a.ts', 'f: does nothing at all.']);
    expect(tokens).toBeGreaterThan(0);
    expect(bad.isError).toBe(true);
  });

  it('the worker rules mention every tool', () => {
    for (const name of TOOLS) expect(CONTRACT_RULES).toContain(name);
  });
});
