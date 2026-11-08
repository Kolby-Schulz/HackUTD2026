// Hook sidecar (sidecar.ts): the thin hooks' fast path over 127.0.0.1, answered from a live
// connection's cache. A fake connection stands in for SpacetimeDB.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbConnection } from '@contract/client';
import { symbolRanges } from '@contract/mapper';
import { Sidecar } from '../src/sidecar.ts';
import { askSidecar, readSidecar, sidecarFile } from '../src/sidecar-client.ts';

const SRC = 'export function a(): number {\n  return 1;\n}\n';
const FUTURE = BigInt(Date.now() + 600_000) * 1000n;

function fakeConn(o: { claims?: { symbolId: string; agentId: string }[]; plan?: boolean; status?: string } = {}) {
  const ids = symbolRanges('src/x.ts', SRC).map((r) => r.id);
  const calls: { reducer: string; args: unknown }[] = [];
  const agents = [{ id: 'agent-a', status: o.status ?? 'working', ownerDev: 'kim', machine: 'lap-a' }, { id: 'agent-b', status: 'working', ownerDev: 'lee', machine: 'lap-b' }];
  const conn = {
    db: {
      symbol: { iter: () => ids.map((id) => ({ id, file: 'src/x.ts', signature: 'a(): number', signatureHash: 'x' })) },
      claim: { iter: () => (o.claims ?? []).map((c) => ({ ...c, expiresAt: { microsSinceUnixEpoch: FUTURE } })) },
      conflict: { iter: () => [] },
      plan: { iter: () => (o.plan === false ? [] : [{ agentId: 'agent-a', active: true }]) },
      agent: { iter: () => agents, id: { find: (id: string) => agents.find((a) => a.id === id) } },
    },
    subscriptionBuilder() {
      let applied = () => {};
      const b = { onApplied: (cb: () => void) => ((applied = cb), b), onError: () => b, subscribe: () => applied() };
      return b;
    },
    reducers: {
      reportChange: async (args: unknown) => void calls.push({ reducer: 'report_change', args }),
      reportEdit: async (args: unknown) => void calls.push({ reducer: 'report_edit', args }),
    },
  };
  return { conn: conn as unknown as DbConnection, calls, ids };
}

function tempRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'sidecar-'));
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/x.ts'), SRC);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

const open: Sidecar[] = [];
afterEach(() => open.splice(0).forEach((s) => s.close()));

async function start(conn: DbConnection, repo: string) {
  const s = new Sidecar({ agentId: 'agent-a', getConn: () => conn, repo, log: () => {} });
  open.push(s);
  await s.listen();
  return s;
}

const guardReq = (repo: string) => ({
  input: { cwd: repo, tool_name: 'Edit', tool_input: { file_path: join(repo, 'src/x.ts'), old_string: 'return 1;' } },
  repoDir: repo,
  enforce: true,
});

describe('sidecar', () => {
  it('answers the hooks over 127.0.0.1 with the secret from its port file', async () => {
    const repo = tempRepo();
    await start(fakeConn().conn, repo);
    expect(readSidecar('agent-a', repo)?.pid).toBe(process.pid);
    expect(await askSidecar('agent-a', '/ping', {}, 1000, repo)).toMatchObject({ ok: true, agentId: 'agent-a' });
    expect(await askSidecar('agent-b', '/ping', {}, 1000, repo)).toBeUndefined(); // no sidecar: the hook falls back
  });

  it('rejects a request without the secret', async () => {
    const repo = tempRepo();
    await start(fakeConn().conn, repo);
    const info = readSidecar('agent-a', repo)!;
    writeFileSync(sidecarFile('agent-a', repo), JSON.stringify({ ...info, secret: 'wrong' }));
    expect(await askSidecar('agent-a', '/ping', {}, 1000, repo)).toBeUndefined();
  });

  it("blocks an edit to another agent's claimed symbol from the cache", async () => {
    const repo = tempRepo();
    const f = fakeConn();
    const blocked = await start(fakeConn({ claims: [{ symbolId: f.ids[0]!, agentId: 'agent-b' }] }).conn, repo);
    const v = await blocked.guard(guardReq(repo));
    expect(v.code).toBe(2);
    expect(v.message).toMatch(/claimed by agent-b \(lee, lap-b\)/);
  });

  it('lets a claimed, planned edit through, and asks for a claim otherwise', async () => {
    const repo = tempRepo();
    const ids = fakeConn().ids;
    const mine = await start(fakeConn({ claims: [{ symbolId: ids[0]!, agentId: 'agent-a' }] }).conn, repo);
    expect(await askSidecar('agent-a', '/guard', guardReq(repo), 3000, repo)).toEqual({ code: 0 });
    mine.close();
    await start(fakeConn().conn, repo);
    const v = await askSidecar<{ code: number; message: string }>('agent-a', '/guard', guardReq(repo), 3000, repo);
    expect(v?.code).toBe(2);
    expect(v?.message).toMatch(/claim before you change it/);
  });

  it('reports an edit over the open connection, skipping non-source files', async () => {
    const repo = tempRepo();
    const f = fakeConn();
    await start(f.conn, repo);
    const base = { cwd: repo, repoDir: repo, sessionKey: `test-${process.pid}-${Date.now()}` };
    expect(await askSidecar('agent-a', '/edit', { ...base, filePath: join(repo, 'README.md') }, 1000, repo)).toMatchObject({ skipped: true });
    const r = await askSidecar<{ file: string; totalMs: number }>('agent-a', '/edit', { ...base, filePath: join(repo, 'src/x.ts'), wait: true }, 10_000, repo);
    expect(r?.file).toBe('src/x.ts');
    const edit = f.calls.find((c) => c.reducer === 'report_edit')?.args as { file: string; diff: string; symbolIds: string[] };
    expect(edit.file).toBe('src/x.ts');
    expect(edit.diff).toMatch(/\+export function a/);
  });
});
