// Pure helpers behind the client's token savers (spec section 10). No network, no
// SpacetimeDB: they take plain rows, so they are unit-tested directly.
import { createHash } from 'node:crypto';
import { duplicateReason, nameTokens, normalizeName } from '@contract/server/rules';
import type { ExistingMatch, SymbolContext } from './index.ts';

export interface SymbolRow {
  id: string;
  name: string;
  file: string;
  signature: string;
  behaviorNote: string;
}
export interface EdgeRow {
  callerId: string;
  calleeId: string;
}

/**
 * The context slice for `ids`: each symbol plus its neighbors (callers and callees) up to
 * `depth` hops, with signatures and caller/callee ids, never whole files. Unknown ids are
 * skipped. Requested symbols come first, then neighbors in the order they were reached.
 */
export function buildContext(
  ids: string[],
  depth: number,
  symbols: Map<string, SymbolRow>,
  edges: EdgeRow[],
  summaryFor: (file: string) => string | undefined = () => undefined,
): SymbolContext[] {
  const callers = new Map<string, string[]>();
  const callees = new Map<string, string[]>();
  for (const e of edges) {
    (callers.get(e.calleeId) ?? callers.set(e.calleeId, []).get(e.calleeId)!).push(e.callerId);
    (callees.get(e.callerId) ?? callees.set(e.callerId, []).get(e.callerId)!).push(e.calleeId);
  }

  const seen = new Set<string>();
  let frontier = ids.filter((id) => symbols.has(id));
  const order: string[] = [];
  for (let hop = 0; frontier.length && hop <= Math.max(0, depth); hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      for (const n of [...(callers.get(id) ?? []), ...(callees.get(id) ?? [])]) {
        if (!seen.has(n) && symbols.has(n)) next.push(n);
      }
    }
    frontier = next;
  }

  return order.map((id) => {
    const s = symbols.get(id)!;
    const summary = summaryFor(s.file);
    return {
      id,
      signature: s.signature,
      behaviorNote: s.behaviorNote,
      ...(summary !== undefined ? { summary } : {}),
      callers: [...new Set(callers.get(id) ?? [])].sort(),
      callees: [...new Set(callees.get(id) ?? [])].sort(),
    };
  });
}

/** Builds a comparable signature string from findExisting's optional params/returns. */
export function querySignature(q: { name: string; params?: string[]; returns?: string }): string | undefined {
  if (q.returns === undefined) return undefined;
  const params = (q.params ?? []).map((p, i) => `p${i}: ${p}`).join(', ');
  return `${q.name}(${params}): ${q.returns}`;
}

/** Scores: 1.0 same normalized name, 0.8 same types + shared token, 0.4 shared name token only. */
export const SCORE_SAME_NAME = 1;
export const SCORE_SAME_TYPES = 0.8;
export const SCORE_SHARED_TOKEN = 0.4;

/**
 * Existing symbols that may already do what `q` describes, best first (spec section 10:
 * "reuse lookup before creating a helper"). Uses the same matching as the server's Rule 2.
 */
export function rankExisting(
  q: { name: string; params?: string[]; returns?: string },
  symbols: Iterable<SymbolRow>,
  limit = 5,
): ExistingMatch[] {
  const mine = { name: q.name, signature: querySignature(q) };
  const myTokens = new Set(nameTokens(q.name));
  const myNorm = normalizeName(q.name);
  const out: ExistingMatch[] = [];
  for (const s of symbols) {
    let score = 0;
    const reason = duplicateReason(mine, { name: s.name, signature: s.signature });
    if (reason) score = myNorm && myNorm === normalizeName(s.name) ? SCORE_SAME_NAME : SCORE_SAME_TYPES;
    else if (nameTokens(s.name).some((w) => myTokens.has(w) && normalizeName(w) !== '')) score = SCORE_SHARED_TOKEN;
    if (score > 0) out.push({ symbolId: s.id, signature: s.signature, score });
  }
  return out.sort((a, b) => b.score - a.score || a.symbolId.localeCompare(b.symbolId)).slice(0, limit);
}

/** summary_cache key: file path + ":" + content hash (spec section 6). */
export function summaryKey(file: string, content: string): string {
  return `${file}:${createHash('sha256').update(content).digest('hex').slice(0, 16)}`;
}

/** Rough token count for text (≈ 4 characters per token), for savings estimates. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
