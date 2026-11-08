// Watcher sidecar for agents without Claude Code hooks (issue #22: Cursor, Codex, anything
// that edits files). Run it next to the editor:
//   npm run watch-agent -- --agent agent-c --dir ../my-app
// Every time a source file under --dir changes on disk it does what contract-hook does after
// an Edit: report_change for created/removed/re-signed symbols (so Rule 1 fires even if the
// model forgets) and report_edit with the diff (dashboard Code tab). Uses the agent's saved
// identity from `npm run join`.
import { resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { watch } from 'chokidar';
import { isMappable, SKIP_DIRS } from '@contract/mapper';
import { hookAgent, reportFile } from './hook.ts';
import { repoFile } from './summary-hook.ts';

const { values } = parseArgs({ options: { agent: { type: 'string' }, dir: { type: 'string', default: process.cwd() } } });
if (values.agent) process.env.CONTRACT_AGENT_ID = values.agent;
const agent = hookAgent();
if (!agent) {
  console.error('[watch] usage: npm run watch-agent -- --agent <id> --dir <repo folder>   (run `npm run join -- --agent <id>` first)');
  process.exit(1);
}
const repoDir = resolve(process.env.INIT_CWD ?? process.cwd(), values.dir!);
const log = (m: string) => console.log(`[watch] ${m}`);
const DEBOUNCE_MS = 400;
const sessionKey = `watch-${agent.agentId}-${process.pid}`;

const pending = new Map<string, ReturnType<typeof setTimeout>>();
let queue = Promise.resolve();
const onChange = (path: string) => {
  const rel = repoFile(path, repoDir, repoDir);
  if (!rel || !isMappable(rel)) return;
  clearTimeout(pending.get(rel));
  pending.set(rel, setTimeout(() => {
    pending.delete(rel);
    queue = queue
      .then(() => reportFile({ ...agent, repoDir, rel, sessionKey, log }))
      .catch((e: unknown) => log(`${rel}: ${e instanceof Error ? e.message : String(e)}`));
  }, DEBOUNCE_MS));
};

const watcher = watch(repoDir, {
  ignoreInitial: true,
  ignored: (path) => {
    const name = path.slice(path.lastIndexOf(sep) + 1);
    return path !== repoDir && (SKIP_DIRS.has(name) || name.startsWith('.'));
  },
});
watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);
watcher.on('ready', () => log(`watching ${repoDir} as ${agent.agentId} (Ctrl-C to stop)`));
process.on('SIGINT', async () => {
  await watcher.close();
  await queue;
  process.exit(0);
});
