// Editor configs written by `npm run join -- --client …` (issue #22).
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { clientFiles, codexToml, upsertBlock, withClaudeSettings, withMcpServer, type JoinInfo } from '../join-clients.ts';
import { joinedRules } from '../../agents/worker/src/rules.ts';
import { pausedMessage } from '../../agents/worker/src/claim-guard.ts';

const info: JoinInfo = {
  monorepo: '/c', dir: '/w/app', agentId: 'dana', name: 'Dana', owner: 'Dana', machine: 'mbp', taskId: 7n,
  host: 'wss://maincloud.spacetimedb.com', dbName: 'db', rules: 'RULES',
};

describe('join --client configs', () => {
  it('adds the contract MCP server without a token, keeping other servers', () => {
    const out = JSON.parse(withMcpServer(JSON.stringify({ mcpServers: { other: { command: 'x' } }, extra: 1 }), info, 'p'));
    expect(out.extra).toBe(1);
    expect(out.mcpServers.other).toEqual({ command: 'x' });
    expect(out.mcpServers.contract).toMatchObject({ command: process.execPath, args: [join('/c', 'node_modules/tsx/dist/cli.mjs'), join('/c', 'packages/mcp/src/index.ts')] });
    expect(out.mcpServers.contract.env).toMatchObject({ CONTRACT_AGENT_ID: 'dana', CONTRACT_TASK_ID: '7', CONTRACT_HEARTBEAT: '1', CONTRACT_REPO_DIR: '/w/app' });
    expect(JSON.stringify(out)).not.toMatch(/TOKEN/);
  });

  it('merges Claude Code settings idempotently: env, MCP approval, guard + report hooks', () => {
    const first = withClaudeSettings(JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine' }] }] } }), info, 'p');
    const twice = JSON.parse(withClaudeSettings(first, info, 'p'));
    expect(twice.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(twice.enabledMcpjsonServers).toEqual(['contract']);
    expect(twice.env).toMatchObject({ CONTRACT_REPO: '/c', CONTRACT_AGENT_ID: 'dana', SPACETIME_DB_NAME: 'db' });
    expect(twice.hooks.PreToolUse).toHaveLength(2); // theirs + our guard, not duplicated
    expect(twice.hooks.PreToolUse[1].hooks[0].command).toMatch(/claim-guard\.ts/);
    expect(twice.hooks.PostToolUse.map((e: { hooks: { command: string }[] }) => e.hooks[0].command)).toEqual([expect.stringMatching(/hook\.ts/)]);
  });

  it('refuses to overwrite a broken JSON file', () => {
    expect(() => withMcpServer('{ nope', info, '/w/app/.mcp.json')).toThrow(/not valid JSON/);
  });

  it('replaces its marked block in AGENTS.md / CLAUDE.local.md, keeping the rest', () => {
    const once = upsertBlock('# Mine\n', 'v1');
    const again = upsertBlock(once, 'v2');
    expect(again).toMatch(/^# Mine\n\n<!-- contract:begin/);
    expect(again).toContain('v2');
    expect(again).not.toContain('v1');
  });

  it('writes the right files per client', () => {
    const at = (p: string) => join('/w/app', p); // \ on Windows, / elsewhere
    expect(clientFiles('claude-code', info).map((f) => f.path)).toEqual([at('.mcp.json'), at('.claude/settings.local.json'), at('CLAUDE.local.md')]);
    expect(clientFiles('cursor', info).map((f) => f.path)).toEqual([at('.cursor/mcp.json'), at('.cursor/rules/contract.mdc')]);
    expect(clientFiles('cursor', info)[1].write(undefined)).toMatch(/^---\ndescription: .*\nalwaysApply: true\n---/);
    expect(clientFiles('codex', info).map((f) => f.path)).toEqual([at('AGENTS.md')]);
    expect(codexToml(info)).toContain(`[mcp_servers.contract]\ncommand = ${JSON.stringify(process.execPath)}`);
  });

  it('rules tell hook-less agents to report changes and every agent to wait when paused', () => {
    expect(joinedRules(false)).toMatch(/call report_change yourself/);
    expect(joinedRules(true)).toMatch(/reported automatically/);
    expect(joinedRules(true)).toMatch(/you are paused/);
    expect(pausedMessage(' on conflict #3')).toMatch(/^Contract: you are paused on conflict #3\./);
  });
});
