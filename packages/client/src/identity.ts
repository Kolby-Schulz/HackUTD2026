// Saved SpacetimeDB tokens per agent id (.contract/identities.json at the monorepo root,
// gitignored, mode 0600). The worker, scripts/lib.ts, `npm run join` and the MCP server /
// hooks of joined editors (issue #22) all share this file, so editor configs never hold a token.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const identitiesFile = (monorepo: string) => join(monorepo, '.contract', 'identities.json');

/** Same key format everywhere: a token is only valid on the server and database it came from. */
export const identityKey = (agentId: string, env: NodeJS.ProcessEnv = process.env) =>
  `${agentId}@${env.SPACETIME_DB_NAME}@${env.SPACETIME_HOST}`;

export function readSavedToken(monorepo: string, agentId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const f = identitiesFile(monorepo);
  if (!existsSync(f)) return undefined;
  try {
    return (JSON.parse(readFileSync(f, 'utf8')) as Record<string, string>)[identityKey(agentId, env)];
  } catch {
    return undefined;
  }
}

export function writeSavedToken(monorepo: string, agentId: string, token: string, env: NodeJS.ProcessEnv = process.env): void {
  const f = identitiesFile(monorepo);
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(readFileSync(f, 'utf8')) as Record<string, string>;
  } catch { /* first save */ }
  if (all[identityKey(agentId, env)] === token) return;
  all[identityKey(agentId, env)] = token;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
}
