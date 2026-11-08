// The variant agent's SpacetimeDB loop: register like any agent, watch queued variant jobs, take one at a time
// (start_variant_job is the lock: it throws if another agent took the job), lease the folder with claim_design,
// generate, typecheck, commit, and finish or fail the job. Every model call is logged with log_tokens.
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { connect, DbConnection, type rows } from '@contract/client';
import type { LLM } from '@contract/llm';
import { generate } from './generate.ts';
import { commitFolder, parentContext, readScreen, removeFolder, typecheck, variantFolders, writeFolder } from './repo.ts';

/** The page counts agents whose id starts with this as variant agents (dashboard/src/variants/store.ts). */
export const AGENT_PREFIX = 'variant-';
const CLAIM_TTL_SECS = 600;
/** The model the page sends when it leaves the choice to the agent (dashboard/src/variants/store.ts). */
export const DEFAULT_MODEL = 'default';

export interface Options { repo: string; model?: string; agentModel: string }

/** `slug-of-the-brief`, unique among folders and variant rows of the screen. */
export function variantId(brief: string, taken: ReadonlySet<string>): string {
  const base = `gen-${brief.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'variant'}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

const nodeOf = (screen: string, id: string | undefined) => (id?.startsWith(`${screen}/`) ? id.slice(screen.length + 1) : null);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A connection with the agent's identity that reconnects by itself after a drop (the SDK keeps subscriptions and
 * callbacks). `onReconnect` runs after each reconnect, so jobs queued while the socket was down are picked up.
 * When the SDK gives up, the process exits non-zero rather than idling without jobs.
 */
function rawConnect(token: string, onReconnect: () => void, timeoutMs = 10_000): Promise<DbConnection> {
  const host = process.env.SPACETIME_HOST!;
  const dbName = process.env.SPACETIME_DB_NAME!;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`no response from ${host} (${dbName}) within ${timeoutMs} ms`)), timeoutMs);
    let connected = false;
    const conn: DbConnection = DbConnection.builder()
      .withUri(host)
      .withDatabaseName(dbName)
      .withToken(token)
      .withAutomaticReconnect()
      .onConnect(() => {
        if (connected) { console.log('[variants] reconnected'); onReconnect(); return; }
        connected = true;
        conn
          .subscriptionBuilder()
          .onApplied(() => (clearTimeout(timer), res(conn)))
          .onError((ctx) => (clearTimeout(timer), rej(new Error(`subscription failed: ${String(ctx.event ?? 'unknown')}`))))
          .subscribe(['SELECT * FROM variant_job', 'SELECT * FROM variant', 'SELECT * FROM variant_mix', 'SELECT * FROM design_claim']);
      })
      .onConnectError((_ctx, err, attempt, delayMs) => {
        if (!connected) { clearTimeout(timer); rej(err); return; }
        if (attempt === undefined) { console.error(`[variants] reconnect failed for good: ${err.message}`); process.exit(1); }
        console.warn(`[variants] reconnect attempt ${attempt} in ${delayMs} ms (${err.message})`);
      })
      .onDisconnect((_ctx, err, attempt, delayMs) => {
        if (attempt === undefined) {
          if (!err) return; // our own disconnect() on Ctrl-C
          console.error(`[variants] disconnected: ${err.message}`);
          process.exit(1);
        }
        console.warn(`[variants] connection lost${err ? ` (${err.message})` : ''}; reconnecting in ${delayMs} ms`);
      })
      .build();
  });
}

export async function runLive(llm: LLM, o: Options): Promise<void> {
  const host = process.env.SPACETIME_HOST;
  const dbName = process.env.SPACETIME_DB_NAME;
  if (!host || !dbName) throw new Error('SPACETIME_HOST and SPACETIME_DB_NAME must be set (see .env.example)');
  const machine = process.env.CONTRACT_MACHINE || hostname();
  const agentId = `${AGENT_PREFIX}${machine.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
  const client = await connect({ host, dbName, agent: { id: agentId, name: 'variant agent', ownerDev: '', machine, model: o.agentModel, tokenBudget: 0 } });
  let next = async () => {};
  const conn = await rawConnect(client.token, () => void next());
  const me = conn.identity;
  if (!me) throw new Error('connected without an identity');
  const isMe = (lease: rows.DesignClaim) => lease.holder === agentId && lease.holderIdentity.isEqual(me);
  const design = existsSync(join(o.repo, 'DESIGN.md')) ? readFileSync(join(o.repo, 'DESIGN.md'), 'utf8') : '';

  const mixSources = (screen: string) => (id: string) => {
    const mix = conn.db.variantMix.id.find(`${screen}/${id}`);
    if (!mix) return undefined;
    try { return Object.values(JSON.parse(mix.slots) as Record<string, string>).map((v) => nodeOf(screen, v)).filter((v): v is string => !!v); } catch { return []; }
  };

  async function handle(job: rows.VariantJob) {
    const screen = readScreen(o.repo, job.screen);
    const taken = new Set([
      ...variantFolders(o.repo, job.screen),
      ...[...conn.db.variant.iter()].filter((v) => v.screen === job.screen).map((v) => nodeOf(job.screen, v.id)!).filter(Boolean),
    ]);
    const id = variantId(job.brief, taken);
    const full = `${job.screen}/${id}`;
    try {
      await conn.reducers.startVariantJob({ jobId: job.id, agentId, variantId: full });
    } catch (e) {
      console.log(`[variants] job ${job.id} taken elsewhere (${msg(e)})`);
      return;
    }
    const target = `variant:${full}`;
    const t0 = Date.now();
    let commit: string | undefined;
    try {
      // claim_design records contention instead of throwing; the lease is ours only if the row names us.
      await conn.reducers.claimDesign({ target, kind: 'variant', scope: job.screen, intent: 'replace', ttlSecs: CLAIM_TTL_SECS, actor: agentId, agentId });
      const lease = conn.db.designClaim.target.find(target);
      if (!lease || !isMe(lease)) throw new Error(`folder ${full} is leased by ${lease?.holder ?? 'someone else'}`);

      const parent = nodeOf(job.screen, job.parent);
      console.log(`[variants] job ${job.id}: ${full}${parent ? ` from ${parent}` : ''}: ${job.brief}`);
      const result = await generate(
        { screen, id, parent, brief: job.brief, context: parentContext(o.repo, job.screen, parent, mixSources(job.screen)), design, model: job.model && job.model !== DEFAULT_MODEL ? job.model : o.model },
        {
          llm,
          onUsage: (u, attempt) => client.logTokens(job.id, attempt, 'design', u),
          check: async (files) => { writeFolder(o.repo, job.screen, id, files); return typecheck(o.repo, job.screen, id); },
        },
      );
      commit = await commitFolder(o.repo, job.screen, id, `Variant ${full}: ${result.answer.title}\n\nBrief: ${job.brief}`);
      const tokens = BigInt(result.usage.prompt_tokens + result.usage.completion_tokens);
      await conn.reducers.finishVariantJob({ jobId: job.id, agentId, commit, tokens, costUsd: result.usage.cost_usd, durationMs: BigInt(Date.now() - t0) });
      console.log(`[variants] job ${job.id} done: ${commit.slice(0, 7)} after ${result.attempts} attempt(s)`);
    } catch (e) {
      // A committed folder stays: it is in git history. The job still fails, and says which commit holds it.
      if (!commit) removeFolder(o.repo, job.screen, id);
      const error = commit ? `committed ${commit.slice(0, 7)} but could not finish the job: ${msg(e)}` : msg(e);
      console.error(`[variants] job ${job.id} failed: ${error}`);
      await conn.reducers.failVariantJob({ jobId: job.id, agentId, error: error.slice(0, 500) }).catch((err: unknown) => console.error(`[variants] fail_variant_job: ${msg(err)}`));
    } finally {
      await conn.reducers.releaseDesignClaim({ target }).catch(() => {});
    }
  }

  // One job at a time, oldest first; a job queued while busy is picked up after.
  let busy = false;
  next = async () => {
    if (busy) return;
    const job = [...conn.db.variantJob.iter()].filter((j) => j.status === 'queued').sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (!job) return;
    busy = true;
    try { await handle(job); } catch (e) { console.error(`[variants] job ${job.id}: ${msg(e)}`); } finally { busy = false; }
    void next();
  };
  conn.db.variantJob.onInsert(() => void next());
  conn.db.variantJob.onUpdate(() => void next());
  console.log(`[variants] ${agentId} connected to ${dbName}; writing variants into ${o.repo}; waiting for jobs (Ctrl-C to stop)`);
  void next();

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[variants] stopping');
    conn.disconnect();
    await client.disconnect();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
