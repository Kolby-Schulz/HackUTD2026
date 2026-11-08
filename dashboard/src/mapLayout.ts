// Where each code map box goes. Pure (no React) so it can be unit tested.
//
// Full view: every function on its grid cell (column = call depth, wrapped; row = order).
// Focused view (agents are working): only the functions they work on and their faded callers,
// packed into a small graph of their own. Collapsed functions are not drawn; where two shown
// functions are connected only through collapsed ones, a dashed "⋯" link stands in for them.
import type { MapEdge, MapNode } from './model.ts';

export const W = 172, H = 48, GX = 76, GY = 30;

export interface MapItem {
  id: string;
  n: MapNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A caller shown for context, not worked on itself. */
  faded: boolean;
  /** Full view while agents work: not in play, so it steps back and the agents' section stands out. */
  dim: boolean;
}

/** `via`: the two functions connect only through collapsed functions (drawn as "⋯"). */
export type LayoutEdge = MapEdge & { via?: boolean };

export interface MapLayout { items: MapItem[]; edges: LayoutEdge[]; focused: boolean; shown: number }

export const inPlay = (n: MapNode) => n.active || n.context;

/** How far a "⋯" link may reach through collapsed functions. */
const VIA_HOPS = 4;

export function layoutMap(nodes: MapNode[], edges: MapEdge[], expanded: boolean): MapLayout {
  const anyActive = nodes.some((n) => n.active);
  if (expanded || !anyActive) {
    return {
      items: nodes.map((n) => item(n, n.col * (W + GX), n.row * (H + GY), anyActive && !inPlay(n))),
      edges, focused: false, shown: nodes.length,
    };
  }

  const shown = nodes.filter(inPlay);
  const shownIds = new Set(shown.map((n) => n.id));
  const out: LayoutEdge[] = edges.filter((e) => shownIds.has(e.source) && shownIds.has(e.target));
  const direct = new Set(out.map((e) => `${e.source}>${e.target}`));
  out.push(...viaLinks(shownIds, edges).filter((e) => !direct.has(`${e.source}>${e.target}`)));

  // columns: longest chain of shown callers (direct or through collapsed functions)
  const callers = new Map<string, string[]>();
  for (const e of out) callers.set(e.target, [...(callers.get(e.target) ?? []), e.source]);
  const col = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (col.has(id)) return col.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...(callers.get(id) ?? []).map(depth)) + 1;
    visiting.delete(id);
    col.set(id, d);
    return d;
  };
  shown.forEach((n) => depth(n.id));
  // rows: files stay together within a column
  const rows = new Map<number, number>();
  const sorted = shown.slice().sort((a, b) => col.get(a.id)! - col.get(b.id)! || a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  const items = sorted.map((n) => {
    const c = col.get(n.id)!;
    const r = rows.get(c) ?? 0;
    rows.set(c, r + 1);
    return item(n, c * (W + GX), r * (H + GY), false);
  });
  return { items, edges: out, focused: true, shown: shown.length };
}

function item(n: MapNode, x: number, y: number, dim: boolean): MapItem {
  return { id: n.id, n, x, y, w: W, h: H, faded: n.context && !n.active, dim };
}

/** Shown function -> shown function links that pass through 1..VIA_HOPS collapsed functions. */
function viaLinks(shown: Set<string>, edges: MapEdge[]): LayoutEdge[] {
  const callees = new Map<string, string[]>();
  for (const e of edges) callees.set(e.source, [...(callees.get(e.source) ?? []), e.target]);
  const links: LayoutEdge[] = [];
  for (const from of shown) {
    const seen = new Set<string>([from]);
    let frontier = (callees.get(from) ?? []).filter((x) => !shown.has(x));
    for (let hop = 1; hop <= VIA_HOPS && frontier.length; hop++) {
      const next: string[] = [];
      for (const hidden of frontier) {
        if (seen.has(hidden)) continue;
        seen.add(hidden);
        for (const to of callees.get(hidden) ?? []) {
          if (shown.has(to)) {
            if (to !== from && !links.some((l) => l.source === from && l.target === to)) {
              links.push({ id: `via:${from}>${to}`, source: from, target: to, hot: false, via: true });
            }
          } else if (!seen.has(to)) next.push(to);
        }
      }
      frontier = next;
    }
  }
  return links;
}

export interface Lang { label: string; name: string; bg: string; fg: string }

const LANGS: Record<string, Lang> = {
  ts: { label: 'TS', name: 'TypeScript', bg: '#3178c6', fg: '#fff' },
  js: { label: 'JS', name: 'JavaScript', bg: '#f7df1e', fg: '#1f2328' },
  py: { label: 'PY', name: 'Python', bg: '#3776ab', fg: '#ffd43b' },
  go: { label: 'GO', name: 'Go', bg: '#00add8', fg: '#fff' },
  rs: { label: 'RS', name: 'Rust', bg: '#ce422b', fg: '#fff' },
  java: { label: 'JV', name: 'Java', bg: '#b07219', fg: '#fff' },
  kt: { label: 'KT', name: 'Kotlin', bg: '#7f52ff', fg: '#fff' },
  rb: { label: 'RB', name: 'Ruby', bg: '#cc342d', fg: '#fff' },
  php: { label: 'PHP', name: 'PHP', bg: '#777bb4', fg: '#fff' },
  cs: { label: 'C#', name: 'C#', bg: '#68217a', fg: '#fff' },
  cpp: { label: 'C++', name: 'C++', bg: '#00599c', fg: '#fff' },
  c: { label: 'C', name: 'C', bg: '#555555', fg: '#fff' },
  swift: { label: 'SW', name: 'Swift', bg: '#f05138', fg: '#fff' },
  scala: { label: 'SC', name: 'Scala', bg: '#dc322f', fg: '#fff' },
  vue: { label: 'VUE', name: 'Vue', bg: '#41b883', fg: '#fff' },
  svelte: { label: 'SV', name: 'Svelte', bg: '#ff3e00', fg: '#fff' },
  lua: { label: 'LUA', name: 'Lua', bg: '#000080', fg: '#fff' },
  sh: { label: 'SH', name: 'Shell', bg: '#4eaa25', fg: '#fff' },
};
const EXT: Record<string, string> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', py: 'py', pyi: 'py',
  go: 'go', rs: 'rs', java: 'java', kt: 'kt', kts: 'kt', rb: 'rb', php: 'php', cs: 'cs',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', c: 'c', h: 'c', swift: 'swift', scala: 'scala',
  vue: 'vue', svelte: 'svelte', lua: 'lua', sh: 'sh', bash: 'sh',
};

/** The language a file is written in, from its extension; undefined when unknown. */
export function langOf(file: string): Lang | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
  return ext ? LANGS[EXT[ext]] : undefined;
}
