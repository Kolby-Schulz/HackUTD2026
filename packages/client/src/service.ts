// Singleton services (issue #19): exactly one coordinator and one watching mapper per
// database, even with two laptops. Wraps the server's claim_service / release_service.
import { randomUUID } from 'node:crypto';
import type { DbConnection } from './bindings/index.ts';

export const SERVICE_HEARTBEAT_MS = 10_000;

type Reducers = Pick<DbConnection['reducers'], 'claimService' | 'releaseService'>;

export interface ServiceLock {
  /** Stops the heartbeat and releases the row. */
  release(): Promise<void>;
}

/**
 * Claims `name` (throws "… is already running on <machine>" if another live process holds
 * it; on a server without claim_service it warns and returns a no-op lock), then re-claims every SERVICE_HEARTBEAT_MS. If the lock is lost (another laptop took
 * over a stale row), onLost is called and the heartbeat stops.
 */
export async function holdService(reducers: Reducers, name: string, machine: string, onLost?: (why: string) => void): Promise<ServiceLock> {
  const holder = `${machine}:${process.pid}:${randomUUID().slice(0, 8)}`;
  try {
    await reducers.claimService({ name, machine, holder });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (/already running/.test(why)) throw e;
    // An older server module without claim_service: run unlocked rather than not at all.
    console.warn(`[contract] could not take the ${name} lock (${why}); running without it. Republish the server module to enable it.`);
    return { release: async () => {} };
  }
  const timer = setInterval(() => {
    reducers.claimService({ name, machine, holder }).catch((e: unknown) => {
      const why = e instanceof Error ? e.message : String(e);
      if (/already running/.test(why)) {
        clearInterval(timer);
        onLost?.(why);
      }
      // Anything else (a dropped connection) just skips a beat; the next one retries.
    });
  }, SERVICE_HEARTBEAT_MS);
  timer.unref?.();
  return {
    async release() {
      clearInterval(timer);
      await reducers.releaseService({ name, holder }).catch(() => undefined);
    },
  };
}
