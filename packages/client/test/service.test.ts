// holdService (issue #19): refuses when another process holds the lock, degrades on old servers.
import { describe, it, expect, vi } from 'vitest';
import { holdService } from '../src/service.ts';

const reducers = (claim: () => Promise<void>) => ({ claimService: vi.fn(claim), releaseService: vi.fn(async () => {}) }) as never;

describe('holdService', () => {
  it('throws when another process holds it', async () => {
    await expect(holdService(reducers(async () => { throw new Error('coordinator is already running on laptop-1'); }), 'coordinator', 'l2')).rejects.toThrow(/already running/);
  });
  it('runs unlocked (with a warning) when the server has no claim_service', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lock = await holdService(reducers(async () => { throw new Error('no such reducer'); }), 'coordinator', 'l1');
    await lock.release();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/running without it/));
    warn.mockRestore();
  });
  it('claims with a per-process holder and releases it', async () => {
    const r = reducers(async () => {});
    const lock = await holdService(r, 'mapper', 'l1');
    await lock.release();
    const [claimArgs] = (r as unknown as { claimService: { mock: { calls: [{ holder: string }][] } } }).claimService.mock.calls[0];
    expect(claimArgs.holder).toMatch(/^l1:\d+:/);
    expect((r as unknown as { releaseService: { mock: { calls: unknown[][] } } }).releaseService.mock.calls[0][0]).toEqual({ name: 'mapper', holder: claimArgs.holder });
  });
});
