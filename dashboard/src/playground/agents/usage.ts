// Token / cost / latency per agent (AGENT-19). Pure: no React, no DOM. The LLM driver records every
// bridge call here; the agents panel subscribes. Scripted agents never record (zeros).
// Clearing the board does not reset usage; only `reset()` does.

export interface UsageReport { prompt_tokens: number; completion_tokens: number; cost_usd?: number; estimated?: boolean }
export interface CallLog { at: number; label: string; prompt_tokens: number; completion_tokens: number; ms: number; ok: boolean; estimated: boolean }
export interface AgentUsage {
  prompt_tokens: number; completion_tokens: number; cost_usd: number; costKnown: boolean; estimated: boolean;
  calls: number; p50_ms: number; last_ms: number; log: CallLog[];
}

export const LOG_CAP = 500;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const empty = (): AgentUsage => ({ prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, costKnown: false, estimated: false, calls: 0, p50_ms: 0, last_ms: 0, log: [] });

/** Hand-written guard: missing or junk fields from the bridge count as 0. */
export function normalizeUsage(u: unknown): UsageReport {
  const o = (u && typeof u === 'object' ? u : {}) as Record<string, unknown>;
  return {
    prompt_tokens: num(o.prompt_tokens), completion_tokens: num(o.completion_tokens),
    ...(typeof o.cost_usd === 'number' && Number.isFinite(o.cost_usd) && o.cost_usd >= 0 ? { cost_usd: o.cost_usd } : {}),
    ...(o.estimated === true ? { estimated: true } : {}),
  };
}

export function createUsageStore(now: () => number = Date.now) {
  const per = new Map<string, AgentUsage>();
  const times = new Map<string, number[]>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  function record(agent: string, u: unknown, meta: { label: string; ms: number; ok: boolean }) {
    const r = normalizeUsage(u);
    const a = per.get(agent) ?? empty();
    a.prompt_tokens += r.prompt_tokens;
    a.completion_tokens += r.completion_tokens;
    if (r.cost_usd !== undefined) { a.cost_usd += r.cost_usd; a.costKnown = true; }
    if (r.estimated) a.estimated = true;
    a.calls++;
    const ms = num(meta.ms);
    a.last_ms = ms;
    const ts = times.get(agent) ?? [];
    ts.push(ms);
    if (ts.length > LOG_CAP) ts.shift();
    times.set(agent, ts);
    a.p50_ms = [...ts].sort((x, y) => x - y)[Math.floor((ts.length - 1) / 2)];
    a.log.push({ at: now(), label: String(meta.label).slice(0, 80), prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens, ms, ok: meta.ok, estimated: !!r.estimated });
    if (a.log.length > LOG_CAP) a.log.splice(0, a.log.length - LOG_CAP);
    per.set(agent, a);
    emit();
  }
  return {
    record,
    get: (agent: string): AgentUsage => per.get(agent) ?? empty(),
    agents: () => [...per.keys()],
    totals(): AgentUsage {
      const t = empty();
      for (const a of per.values()) {
        t.prompt_tokens += a.prompt_tokens; t.completion_tokens += a.completion_tokens; t.cost_usd += a.cost_usd;
        t.costKnown ||= a.costKnown; t.estimated ||= a.estimated; t.calls += a.calls;
      }
      return t;
    },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    reset() { per.clear(); times.clear(); emit(); },
  };
}
export type UsageStore = ReturnType<typeof createUsageStore>;
/** The app-wide store the panel reads and the default LLM driver writes. */
export const usageStore: UsageStore = createUsageStore();

/** `12.4k tok · $0.08`; `~` marks estimated values; tokens only when cost is unknown. */
export function formatChip(u: Pick<AgentUsage, 'prompt_tokens' | 'completion_tokens' | 'cost_usd' | 'costKnown' | 'estimated'>): string {
  const n = u.prompt_tokens + u.completion_tokens;
  const tok = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const t = `${u.estimated ? '~' : ''}${tok} tok`;
  return u.costKnown ? `${t} · ${u.estimated ? '~' : ''}$${u.cost_usd.toFixed(2)}` : t;
}
