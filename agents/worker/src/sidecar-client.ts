// The hooks' side of the sidecar channel (sidecar.ts). Owner: agents.
// Node built-ins only: hook.ts and claim-guard.ts import this on every edit, so it must stay
// cheap (no mapper, no SpacetimeDB SDK). Every failure returns undefined, and the hook then
// falls back to doing the work itself.
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Contract checkout this file lives in (the worker sets CONTRACT_REPO to the same place). */
export const MONOREPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface HookInput {
  session_id?: string;
  cwd: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input: { file_path?: string };
}

/** What a running sidecar writes so hooks can find it: its port and a per-run secret. */
export interface SidecarInfo {
  port: number;
  secret: string;
  pid: number;
  agentId: string;
}

/** `.contract/sidecar/<agent id>.json` in the monorepo (gitignored, mode 600). */
export function sidecarFile(agentId: string, repo = MONOREPO): string {
  return join(repo, '.contract', 'sidecar', `${agentId.replace(/[^\w.-]/g, '_')}.json`);
}

export function readSidecar(agentId: string, repo = MONOREPO): SidecarInfo | undefined {
  try {
    const info = JSON.parse(readFileSync(sidecarFile(agentId, repo), 'utf8')) as SidecarInfo;
    return Number.isInteger(info.port) && info.secret ? info : undefined;
  } catch {
    return undefined;
  }
}

/**
 * POSTs `body` as JSON to this agent's sidecar and returns its JSON answer, or undefined when
 * there is no sidecar, it doesn't answer within `timeoutMs`, or it answers with an error.
 */
export function askSidecar<T>(agentId: string, path: string, body: unknown, timeoutMs: number, repo = MONOREPO): Promise<T | undefined> {
  const info = readSidecar(agentId, repo);
  if (!info) return Promise.resolve(undefined);
  return new Promise((done) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: info.port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-contract-secret': info.secret },
        timeout: timeoutMs,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c));
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 300) return done(undefined);
          try {
            done(JSON.parse(text) as T);
          } catch {
            done(undefined);
          }
        });
        res.on('error', () => done(undefined));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => done(undefined));
    req.end(data);
  });
}
