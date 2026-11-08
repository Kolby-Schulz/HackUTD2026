// Id rules shared by the page and the variant agent: folder-safe ids, slugs and unique names.
import type { NodeId } from './types.ts';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const isSafeId = (s: unknown): s is string => typeof s === 'string' && ID_RE.test(s);

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'variant';
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const root = slugify(base);
  if (!set.has(root)) return root;
  for (let i = 2; ; i++) if (!set.has(`${root}-${i}`)) return `${root}-${i}`;
}

export function newComboId(taken: Iterable<string>, now = Date.now()): NodeId {
  return uniqueId(`mix-${now.toString(36)}`, taken);
}
