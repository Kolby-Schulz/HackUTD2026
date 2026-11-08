// Contract MCP server (spec sections 10, 11). Owner: agents.
// Claude Code workers launch this via --mcp-config; it wraps @contract/client.
// It runs as its own process, so it connects with the WORKER's identity: the worker
// passes CONTRACT_AGENT_ID, CONTRACT_TOKEN, CONTRACT_TASK_ID and CONTRACT_REPO_DIR down.
// The worker script (not this server) handles register_agent, heartbeats, pauses and
// token logging, so this connects with noHeartbeat.
//
// stdout is the MCP stdio channel: never console.log here (console.error/warn are fine).
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ClaimedError, connect, estimateTokens, type ContractClient, type Instruction } from '@contract/client';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Claude Code starts us in the agent's worktree, so load the monorepo's .env explicitly.
loadEnv({ path: resolve(REPO, '.env'), quiet: true });

/** Tool names are fixed by the spec (section 11, plus docs/spec-additions-summary-tools.md). */
export const TOOLS = [
  'declare_plan', // -> client.publishPlan
  'claim_symbol', // -> client.claim
  'release_claim', // -> client.release
  'report_change', // -> client.reportChange
  'get_context', // -> client.getContext
  'find_existing', // -> client.findExisting
  'get_instructions', // -> client.pendingInstructions (+ ack)
  'get_summary', // -> client.getSummary
  'put_summary', // -> client.putSummary
] as const;

/** find_existing matches at or above this score count as a reuse (same name, or same types + shared token). */
export const REUSE_MIN_SCORE = 0.8;
/**
 * Estimated tokens a duplicate helper costs to write and later clean up (spec section 15:
 * "tokens the duplicate cost in the baseline run"). Set CONTRACT_REUSE_EST_TOKENS from a
 * measured baseline run; the default is a rough per-helper figure.
 */
const REUSE_EST_TOKENS = Number(process.env.CONTRACT_REUSE_EST_TOKENS ?? 1500);

const ID_HINT =
  'Symbol ids look like "<file>#<name>" or "<file>#Class.method", with the file relative to your working directory ' +
  '(e.g. "src/billing/fees.ts#calculateFee"). Use find_existing to look ids up.';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
const ok = (v: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : json(v) }] });
const fail = (msg: string): ToolResult => ({ content: [{ type: 'text', text: msg }], isError: true });

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`contract mcp: ${name} is not set (the worker script passes it)`);
  return v;
}

/** Instructions shown to the model, without internal fields. */
const showInstructions = (list: Instruction[]) =>
  list.map((i) => ({ id: i.id, text: i.text, ...(i.conflictId !== undefined ? { conflict_id: i.conflictId } : {}) }));

/**
 * Builds the MCP server around a client promise. Exported for tests: pass any
 * ContractClient (a fake works) and a task id.
 */
export function createServer(clientP: Promise<ContractClient>, taskId: bigint): McpServer {
  const server = new McpServer({ name: 'contract', version: '0.1.0' });
  const reused = new Set<string>(); // log one reuse saving per existing symbol per process

  /** Runs a tool body with the connected client; any error becomes a tool error, never a crash. */
  const tool =
    <A>(body: (c: ContractClient, args: A) => Promise<ToolResult>) =>
    async (args: A): Promise<ToolResult> => {
      try {
        return await body(await clientP, args);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return fail(/unknown symbol/.test(msg) ? `${msg}. ${ID_HINT}` : msg);
      }
    };

  /** Unacknowledged instructions are delivered once: returned to the model, then acked. */
  async function takeInstructions(c: ContractClient) {
    const list = c.pendingInstructions();
    for (const i of list) await c.ack(i.id).catch(() => {});
    return showInstructions(list);
  }

  server.registerTool(
    'declare_plan',
    {
      description:
        'Call before editing. Declares the functions you will modify, create or depend on (call). ' +
        'Replaces your previous plan. Returns any instructions Contract has for you right away ' +
        '(for example: reuse an existing helper instead of creating a duplicate). ' +
        ID_HINT,
      inputSchema: {
        summary: z.string().describe('One line: what you are about to do'),
        items: z
          .array(
            z.object({
              symbol_id: z.string(),
              intent: z.enum(['modify', 'create', 'depend']),
              signature: z
                .string()
                .optional()
                .describe('For intent create: the full signature you will write, e.g. formatDate(d: Date): string'),
            }),
          )
          .describe('Every function you will modify or create, and the ones your code calls (depend)'),
      },
    },
    tool(async (c, { summary, items }: { summary: string; items: { symbol_id: string; intent: 'modify' | 'create' | 'depend'; signature?: string }[] }) => {
      await c.publishPlan(
        taskId,
        summary,
        items.map((i) => ({ symbolId: i.symbol_id, intent: i.intent, ...(i.signature ? { signature: i.signature } : {}) })),
      );
      return ok({ plan: 'published', items: items.length, instructions: await takeInstructions(c) });
    }),
  );

  server.registerTool(
    'claim_symbol',
    {
      description:
        'Call before modifying a function. Fails if another agent holds it; then do not edit it, ' +
        'call get_instructions and wait for the coordinator. ' +
        ID_HINT,
      inputSchema: {
        symbol_id: z.string(),
        ttl_secs: z.number().int().positive().optional().describe('Claim lifetime, default 300 s'),
      },
    },
    tool(async (c, { symbol_id, ttl_secs }: { symbol_id: string; ttl_secs?: number }) => {
      try {
        await c.claim(symbol_id, ttl_secs);
      } catch (e) {
        if (e instanceof ClaimedError) {
          return fail(`${symbol_id} is claimed by ${e.holder}. Do not edit it; call get_instructions and follow the coordinator.`);
        }
        throw e;
      }
      return ok(`claimed ${symbol_id}`);
    }),
  );

  server.registerTool(
    'release_claim',
    {
      description: 'Release a claim when you are done modifying a function.',
      inputSchema: { symbol_id: z.string() },
    },
    tool(async (c, { symbol_id }: { symbol_id: string }) => {
      await c.release(symbol_id);
      return ok(`released ${symbol_id}`);
    }),
  );

  server.registerTool(
    'report_change',
    {
      description:
        "Call right after changing a function's signature or behavior (e.g. how it rounds), or after " +
        'creating or removing one. Contract tells agents whose code depends on it.',
      inputSchema: {
        symbol_id: z.string(),
        kind: z.enum(['signature', 'behavior', 'created', 'removed']),
        new_signature: z.string().optional().describe("The new signature as written, for 'signature' and 'created'"),
        description: z.string().describe('What changed, in one sentence'),
      },
    },
    tool(
      async (
        c,
        a: { symbol_id: string; kind: 'signature' | 'behavior' | 'created' | 'removed'; new_signature?: string; description: string },
      ) => {
        await c.reportChange(a.symbol_id, a.kind, { newSignature: a.new_signature, description: a.description });
        return ok({ reported: a.symbol_id, kind: a.kind, instructions: await takeInstructions(c) });
      },
    ),
  );

  server.registerTool(
    'get_context',
    {
      description:
        'Signatures, behavior notes and callers/callees of these functions and their neighbors. ' +
        'Much cheaper than reading whole files; use it first. ' +
        ID_HINT,
      inputSchema: {
        symbol_ids: z.array(z.string()).min(1),
        depth: z.number().int().min(0).max(3).optional().describe('Neighbor hops, default 1'),
      },
    },
    tool(async (c, { symbol_ids, depth }: { symbol_ids: string[]; depth?: number }) => {
      const slice = await c.getContext(symbol_ids, depth ?? 1);
      if (!slice.length) return fail(`none of ${symbol_ids.join(', ')} are in the code map. ${ID_HINT}`);
      return ok(slice);
    }),
  );

  server.registerTool(
    'find_existing',
    {
      description:
        'Call before writing any new helper. Finds existing functions with the same or a similar name, ' +
        'or the same parameter and return types. Reuse a match instead of writing a duplicate.',
      inputSchema: {
        name: z.string().describe('Name you would give the new helper, e.g. formatDate'),
        params: z.array(z.string()).optional().describe('Parameter types, e.g. ["Date"]'),
        returns: z.string().optional().describe('Return type, e.g. "string"'),
      },
    },
    tool(async (c, q: { name: string; params?: string[]; returns?: string }) => {
      const matches = await c.findExisting(q);
      const best = matches[0];
      if (best && best.score >= REUSE_MIN_SCORE && !reused.has(best.symbolId)) {
        reused.add(best.symbolId);
        await c
          .logSaving('reuse', REUSE_EST_TOKENS, `find_existing ${q.name} -> ${best.symbolId}`)
          .catch((e: unknown) => console.error(`contract mcp: logSaving failed: ${String(e)}`));
      }
      return ok({
        matches: matches.map((m) => ({ symbol_id: m.symbolId, signature: m.signature, score: m.score })),
        advice: best && best.score >= REUSE_MIN_SCORE ? `Reuse ${best.symbolId} instead of writing a new helper.` : 'No close match; you may create it (declare it in your plan first).',
      });
    }),
  );

  server.registerTool(
    'get_instructions',
    {
      description: "Coordinator instructions for you that you haven't seen yet. Check after each step and follow them.",
      inputSchema: {},
    },
    tool(async (c) => {
      const list = await takeInstructions(c);
      return ok(list.length ? { instructions: list } : 'No new instructions. Continue your task.');
    }),
  );

  server.registerTool(
    'get_summary',
    {
      description:
        'Call before reading a whole file. Returns a summary another agent cached for the current ' +
        "content of this file; much cheaper than reading it. On a miss, read the file and call put_summary.",
      inputSchema: { file: z.string().describe('Path relative to your working directory, e.g. src/billing/fees.ts') },
    },
    tool(async (c, { file }: { file: string }) => {
      const summary = await c.getSummary(file);
      if (summary !== undefined) return ok({ file, summary });
      return ok(
        `No cached summary for ${file} (or the file changed). Read it, then call put_summary with 2-5 lines: ` +
          'what each exported function does, plus rounding, units and side effects.',
      );
    }),
  );

  server.registerTool(
    'put_summary',
    {
      description:
        'After reading a whole file, cache a short summary of it (2-5 lines: what each exported function does, ' +
        'plus rounding, units and side effects) so other agents can skip reading it. Tied to the current content.',
      inputSchema: {
        file: z.string().describe('Path relative to your working directory'),
        summary: z.string().min(1),
      },
    },
    tool(async (c, { file, summary }: { file: string; summary: string }) => {
      await c.putSummary(file, summary, estimateTokens(summary));
      return ok(`cached summary of ${file}`);
    }),
  );

  return server;
}

async function main() {
  // The SpacetimeDB SDK logs with console.log, which would corrupt the stdio channel.
  console.log = console.error;
  const agentId = env('CONTRACT_AGENT_ID');
  const taskId = BigInt(env('CONTRACT_TASK_ID'));
  // Connect in the background so the MCP handshake isn't held up; tools await it.
  const clientP = connect({
    host: env('SPACETIME_HOST'),
    dbName: env('SPACETIME_DB_NAME'),
    token: env('CONTRACT_TOKEN'),
    noHeartbeat: true,
    repoDir: process.env.CONTRACT_REPO_DIR ?? process.cwd(),
    agent: { id: agentId, name: agentId, ownerDev: '', machine: '', model: 'claude-code', tokenBudget: 0 },
  });
  clientP.catch((e: unknown) => console.error(`contract mcp: connect failed: ${String(e)}`));

  const server = createServer(clientP, taskId);
  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    await clientP.then((c) => c.disconnect()).catch(() => {});
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(`contract mcp: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
