// Editor configs written by `npm run join -- --client …` (issue #22). Pure functions over
// file contents, so they're unit-tested; join.ts does the reading and writing.
// No tokens go into these files: the MCP server and hooks read the agent's saved identity.
import { join } from 'node:path';

export type ClientKind = 'claude-code' | 'cursor' | 'codex';
export const CLIENTS: ClientKind[] = ['claude-code', 'cursor', 'codex'];

export interface JoinInfo {
  monorepo: string; // absolute path of this repo (tsx, MCP server, hooks)
  dir: string; // the folder the editor works in
  agentId: string;
  name: string;
  owner: string;
  machine: string;
  taskId: bigint;
  host: string;
  dbName: string;
  rules: string;
}

export interface FileEdit {
  path: string; // absolute
  /** New content given the current one (undefined = file doesn't exist yet). */
  write: (current: string | undefined) => string;
}

const BEGIN = '<!-- contract:begin (written by npm run join; safe to delete) -->';
const END = '<!-- contract:end -->';

/** Replaces our marked block in a text file, or appends it. */
export function upsertBlock(current: string | undefined, body: string): string {
  const block = `${BEGIN}\n${body.trim()}\n${END}\n`;
  if (!current) return block;
  const i = current.indexOf(BEGIN);
  const j = current.indexOf(END);
  if (i >= 0 && j > i) return current.slice(0, i) + block + current.slice(j + END.length).replace(/^\n/, '');
  return current.replace(/\n*$/, '\n\n') + block;
}

export function mcpServer(info: JoinInfo) {
  return {
    command: join(info.monorepo, 'node_modules/.bin/tsx'),
    args: [join(info.monorepo, 'packages/mcp/src/index.ts')],
    env: {
      CONTRACT_AGENT_ID: info.agentId,
      CONTRACT_TASK_ID: String(info.taskId),
      CONTRACT_REPO_DIR: info.dir,
      CONTRACT_HEARTBEAT: '1',
      CONTRACT_AGENT_NAME: info.name,
      CONTRACT_OWNER: info.owner,
      CONTRACT_MACHINE: info.machine,
      SPACETIME_HOST: info.host,
      SPACETIME_DB_NAME: info.dbName,
    },
  };
}

const parseJson = (s: string | undefined, path: string): Record<string, unknown> => {
  if (!s?.trim()) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    throw new Error(`${path} is not valid JSON; fix or remove it and run join again`);
  }
};

/** Merges servers.contract into an MCP JSON config ({ mcpServers: {...} }), keeping the rest. */
export function withMcpServer(current: string | undefined, info: JoinInfo, path: string): string {
  const cfg = parseJson(current, path);
  const servers = { ...(cfg.mcpServers as Record<string, unknown> | undefined), contract: mcpServer(info) };
  return JSON.stringify({ ...cfg, mcpServers: servers }, null, 2) + '\n';
}

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };

/** Claude Code settings.local.json: our env, hooks and MCP approval merged into whatever is there. */
export function withClaudeSettings(current: string | undefined, info: JoinInfo, path: string): string {
  const cfg = parseJson(current, path) as {
    env?: Record<string, string>;
    hooks?: Record<string, HookEntry[]>;
    enabledMcpjsonServers?: string[];
  } & Record<string, unknown>;
  const tsx = `"$CONTRACT_REPO/node_modules/.bin/tsx"`;
  const ours = (script: string) => `${tsx} "$CONTRACT_REPO/agents/worker/src/${script}"`;
  const isOurs = (e: HookEntry) => e.hooks.some((h) => h.command.includes('$CONTRACT_REPO/agents/worker/src/'));
  const hooks = { ...(cfg.hooks ?? {}) };
  hooks.PreToolUse = [...(hooks.PreToolUse ?? []).filter((e) => !isOurs(e)),
    { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: ours('claim-guard.ts'), timeout: 10 }] }];
  hooks.PostToolUse = [...(hooks.PostToolUse ?? []).filter((e) => !isOurs(e)),
    { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: ours('hook.ts'), timeout: 15 }] }];
  return JSON.stringify({
    ...cfg,
    env: {
      ...(cfg.env ?? {}),
      CONTRACT_REPO: info.monorepo,
      CONTRACT_AGENT_ID: info.agentId,
      CONTRACT_REPO_DIR: info.dir,
      SPACETIME_HOST: info.host,
      SPACETIME_DB_NAME: info.dbName,
    },
    enabledMcpjsonServers: [...new Set([...(cfg.enabledMcpjsonServers ?? []), 'contract'])],
    hooks,
  }, null, 2) + '\n';
}

/** Codex reads MCP servers from ~/.codex/config.toml; we print this rather than edit a global file. */
export function codexToml(info: JoinInfo): string {
  const s = mcpServer(info);
  const q = (v: string) => JSON.stringify(v);
  return [
    '[mcp_servers.contract]',
    `command = ${q(s.command)}`,
    `args = [${s.args.map(q).join(', ')}]`,
    `env = { ${Object.entries(s.env).map(([k, v]) => `${k} = ${q(v)}`).join(', ')} }`,
  ].join('\n');
}

/** The files each client needs, relative to the editor's folder. */
export function clientFiles(kind: ClientKind, info: JoinInfo): FileEdit[] {
  const at = (p: string) => join(info.dir, p);
  if (kind === 'claude-code') {
    return [
      { path: at('.mcp.json'), write: (c) => withMcpServer(c, info, at('.mcp.json')) },
      { path: at('.claude/settings.local.json'), write: (c) => withClaudeSettings(c, info, at('.claude/settings.local.json')) },
      { path: at('CLAUDE.local.md'), write: (c) => upsertBlock(c, `# Contract\n\n${info.rules}`) },
    ];
  }
  if (kind === 'cursor') {
    return [
      { path: at('.cursor/mcp.json'), write: (c) => withMcpServer(c, info, at('.cursor/mcp.json')) },
      { path: at('.cursor/rules/contract.mdc'), write: () => `---\ndescription: Contract multi-agent coordination rules\nalwaysApply: true\n---\n\n${info.rules}\n` },
    ];
  }
  return [{ path: at('AGENTS.md'), write: (c) => upsertBlock(c, `# Contract\n\n${info.rules}`) }];
}
