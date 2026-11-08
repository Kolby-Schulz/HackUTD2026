// Finds every screen and code variant under src/designs/ at build time (Vite glob, eager).
// Adding a folder is enough: Vite hot-reloads the glob when files appear.
import type { CodeInfo } from './model.ts';
import type { ScreenSpec, SlotId, VariantSpec } from './types.ts';

export interface Screen extends ScreenSpec {
  id: string;
  slotIds: SlotId[];
  width: number;
}

export interface Variant extends VariantSpec {
  id: string;
  screen: string;
  path: string;
}

export interface Registry {
  screens: Screen[];
  variants: Map<string, Variant[]>; // screen id -> variants
  problems: string[];
}

const screenMods = import.meta.glob<{ default: ScreenSpec }>('../designs/*/screen.tsx', { eager: true });
const variantMods = import.meta.glob<{ default: VariantSpec }>('../designs/*/*/index.tsx', { eager: true });

const parts = (key: string) => key.replace(/^\.\.\/designs\//, '').split('/');

function load(): Registry {
  const problems: string[] = [];
  const screens: Screen[] = [];
  for (const [key, mod] of Object.entries(screenMods)) {
    const [id] = parts(key);
    const spec = mod.default;
    if (!spec?.Layout || !spec.slots) { problems.push(`src/designs/${id}/screen.tsx: default export is not a screen`); continue; }
    screens.push({ ...spec, id, slotIds: Object.keys(spec.slots), width: spec.width ?? 1280 });
  }
  screens.sort((a, b) => a.title.localeCompare(b.title));
  const variants = new Map<string, Variant[]>(screens.map((s) => [s.id, []]));
  for (const [key, mod] of Object.entries(variantMods)) {
    const [screen, id] = parts(key);
    const path = `src/designs/${screen}/${id}`;
    const spec = mod.default;
    const list = variants.get(screen);
    if (!list) { problems.push(`${path}: no screen.tsx next to it`); continue; }
    if (!spec?.slots) { problems.push(`${path}/index.tsx: default export is not a variant`); continue; }
    const slotIds = screens.find((s) => s.id === screen)!.slotIds;
    for (const k of Object.keys(spec.slots)) if (!slotIds.includes(k)) problems.push(`${path}: slot "${k}" is not declared in screen.tsx`);
    list.push({ ...spec, id, screen, path });
  }
  return { screens, variants, problems };
}

export const registry = load();

export function codeInfos(screen: Screen, list: Variant[]): CodeInfo[] {
  return list.map((v) => ({
    id: v.id,
    title: v.title,
    note: v.note,
    extends: v.extends,
    own: Object.keys(v.slots).filter((k) => screen.slotIds.includes(k) && v.slots[k]),
    path: v.path,
  }));
}
