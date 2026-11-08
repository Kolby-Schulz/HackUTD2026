// Agent host election for the live board: exactly one tab runs the agents. It holds the `board-host` service lock,
// renewing it every RENEW_MS (the server treats a lock older than 30 s as stale). Other tabs retry on the same
// beat, so when the host tab closes or drops, the next tab takes over within about 30 s.
import type { BoardTransport } from './types';

export const HOST_SERVICE = 'board-host';
export const RENEW_MS = 10_000;

export interface HostTimers { setInterval(f: () => void, ms: number): unknown; clearInterval(h: unknown): void }
const defaultTimers: HostTimers = { setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) };

export interface HostElection { isHost(): boolean; dispose(): void }

/** `holder` is this tab's id. `onChange` fires whenever this tab gains or loses the host role. */
export function electHost(t: Pick<BoardTransport, 'status' | 'onStatus' | 'claimService' | 'releaseService'>, holder: string,
  onChange: (host: boolean) => void, timers: HostTimers = defaultTimers): HostElection {
  let host = false;
  let disposed = false;
  const set = (v: boolean) => { if (!disposed && v !== host) { host = v; onChange(v); } };
  const tick = () => {
    if (disposed) return;
    if (t.status() !== 'live') { set(false); return; }
    t.claimService(HOST_SERVICE, holder).then(() => set(true), () => set(false));
  };
  const timer = timers.setInterval(tick, RENEW_MS);
  const offStatus = t.onStatus((s) => (s === 'live' ? tick() : set(false)));
  tick();
  return {
    isHost: () => host,
    dispose() {
      disposed = true;
      timers.clearInterval(timer);
      offStatus();
      if (host && t.status() === 'live') t.releaseService(HOST_SERVICE, holder).catch(() => { /* goes stale on its own */ });
    },
  };
}
