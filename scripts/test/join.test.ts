// npm run join preflight checks (issue #19) and the merge's test counter.
import { describe, it, expect } from 'vitest';
import { claudeCheck, envCheck, nodeCheck } from '../join.ts';
import { countTests } from '../merge.ts';

describe('join checks', () => {
  it('needs Node 22+', () => {
    expect(nodeCheck('22.1.0').ok).toBe(true);
    expect(nodeCheck('20.11.0')).toMatchObject({ ok: false, fix: expect.stringMatching(/Node 22/) });
  });
  it('needs .env with a server; warns that localhost is one-laptop only', () => {
    expect(envCheck({}, false).map((c) => c.ok)).toEqual([false, false]);
    const local = envCheck({ SPACETIME_HOST: 'ws://localhost:3000', SPACETIME_DB_NAME: 'contract' }, true);
    expect(local).toMatchObject([{ ok: true, fix: expect.stringMatching(/maincloud/) }]);
    expect(envCheck({ SPACETIME_HOST: 'wss://maincloud.spacetimedb.com', SPACETIME_DB_NAME: 'x' }, true)).toMatchObject([{ ok: true }]);
  });
  it('reads claude auth status', () => {
    expect(claudeCheck(() => '{"loggedIn":true,"authMethod":"claude.ai"}')).toMatchObject({ ok: true });
    expect(claudeCheck(() => '{"loggedIn":false}')).toMatchObject({ ok: false, fix: expect.stringMatching(/log in/) });
    expect(claudeCheck(() => { throw new Error('ENOENT'); })).toMatchObject({ ok: false, fix: expect.stringMatching(/install/) });
  });
});

describe('countTests', () => {
  it('reads vitest and node:test output', () => {
    expect(countTests(' Tests  4 passed | 1 failed (5)')).toEqual({ passed: 4, failed: 1 });
    expect(countTests('ℹ tests 3\nℹ pass 3\nℹ fail 0')).toEqual({ passed: 3, failed: 0 });
  });
});
