// contract-hook (spec section 11, "Automatic change reporting"). Owner: agents.
// Claude Code runs it after every Edit|Write|MultiEdit via the PostToolUse hook in
// agents/worker/hook-settings.json (and scripts/join-clients.ts for joined editors).
//
// Thin on purpose: it hands the edited path to this agent's sidecar (sidecar.ts), which keeps
// one SpacetimeDB connection open and the mapper loaded, and exits without waiting for the
// report. Only node built-ins load on that path. With no sidecar running (a joined editor
// without `npm run watch-agent`, or the sidecar is down) it falls back to report.ts, which
// parses the file and reports over a fresh connection: the same result, seconds slower.
// Always exits 0.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askSidecar, type HookInput } from './sidecar-client.ts';

/** Body of POST /edit on the sidecar. */
export interface EditRequest {
  filePath: string;
  cwd: string;
  repoDir: string;
  sessionKey: string;
  /** Answer only once the report reached the server (the latency script); hooks don't wait. */
  wait?: boolean;
}

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
  const agentId = process.env.CONTRACT_AGENT_ID;
  const filePath = input.tool_input?.file_path;
  if (!agentId || !filePath) return; // not running under a Contract agent, or nothing edited
  const req: EditRequest = {
    filePath,
    cwd: input.cwd,
    repoDir: process.env.CONTRACT_REPO_DIR ?? input.cwd,
    sessionKey: input.session_id ?? agentId,
  };
  if (await askSidecar(agentId, '/edit', req, 1000)) return;
  const { directReport } = await import('./report.ts');
  await directReport(input);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setTimeout(() => {
    console.error('contract-hook: timed out');
    process.exit(0);
  }, 10_000).unref();
  main()
    .catch((e: unknown) => console.error(`contract-hook: ${e instanceof Error ? e.message : String(e)}`))
    .finally(() => process.exit(0));
}
