// Panel layout (SHELL-4/5/8) and rename (SHELL-2): pure sizing rules, a tiny viewport store, and the
// panel.left / panel.right / panel.ui actions. Collapsed state and widths live in prefs (pg.prefs.v1).
import { prefs, PREF_DEFAULTS } from '../core/prefs';
import type { Prefs } from '../core/prefs';
import type { Action } from '../core/types';

export type Side = 'left' | 'right';

export const PANEL_MIN = 200;
export const PANEL_MAX = 420;
export const BOARD_MIN = 320;                      // the board always keeps at least this much width
export const BREAKPOINT: Record<Side, number> = { left: 760, right: 1100 };   // below: panel starts collapsed, opens as an overlay

export const clampWidth = (w: number): number => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));
export const isNarrow = (side: Side, vw: number): boolean => vw < BREAKPOINT[side];

export interface PanelView { open: boolean; overlay: boolean; width: number }
export interface LayoutInput { prefs: Pick<Prefs, 'leftW' | 'rightW' | 'leftCollapsed' | 'rightCollapsed'>; vw: number; narrowOpen: Record<Side, boolean> }

/** What each panel shows: open or not, docked or floating over the board, and its width. */
export function panelViews(i: LayoutInput): Record<Side, PanelView> {
  const open = (s: Side) => (isNarrow(s, i.vw) ? i.narrowOpen[s] : !i.prefs[`${s}Collapsed`]);
  const want = (s: Side) => clampWidth(i.prefs[`${s}W`]);
  const out = {} as Record<Side, PanelView>;
  for (const s of ['left', 'right'] as Side[]) {
    const o = open(s);
    const overlay = o && isNarrow(s, i.vw);
    let width = want(s);
    if (overlay) width = Math.min(width, Math.max(160, i.vw - 48));
    out[s] = { open: o, overlay, width };
  }
  // Docked panels never squeeze the board below BOARD_MIN: the wider-than-needed one gives way first.
  const docked = (s: Side) => out[s].open && !out[s].overlay;
  let over = (docked('left') ? out.left.width : 0) + (docked('right') ? out.right.width : 0) + BOARD_MIN - i.vw;
  for (const s of ['left', 'right'] as Side[]) {
    if (over <= 0 || !docked(s)) continue;
    const cut = Math.min(over, out[s].width - 160);
    out[s].width -= cut; over -= cut;
  }
  return out;
}

// ---- viewport + narrow overrides (session only) ----
interface Layout { vw: number; narrowOpen: Record<Side, boolean> }
let layout: Layout = { vw: typeof window === 'undefined' ? 1440 : window.innerWidth, narrowOpen: { left: false, right: false } };
const subs = new Set<() => void>();
const setLayout = (l: Layout) => { layout = l; subs.forEach((f) => f()); };
export const layoutStore = { get: () => layout, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; } };
export const setViewport = (vw: number) => { if (vw !== layout.vw) setLayout({ ...layout, vw }); };

const views = () => panelViews({ prefs: prefs.get(), vw: layout.vw, narrowOpen: layout.narrowOpen });

/** Open or close one panel (docked state goes to prefs, narrow windows use a session override). */
export function setPanel(side: Side, open: boolean) {
  if (isNarrow(side, layout.vw)) {
    // one overlay at a time on a narrow window
    const other: Side = side === 'left' ? 'right' : 'left';
    setLayout({ ...layout, narrowOpen: { ...layout.narrowOpen, [side]: open, ...(open && isNarrow(other, layout.vw) ? { [other]: false } : {}) } });
  } else {
    prefs.set({ [`${side}Collapsed`]: !open } as Partial<Prefs>);
  }
  if (!open) blurPanelFocus();
}

/** Collapsing a panel with focus inside it moves focus out so typing does not go to a hidden input. */
function blurPanelFocus() {
  const a = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
  if (a && a !== document.body && a.closest?.('.pg-panel')) a.blur();
}

export const togglePanel = (side: Side) => setPanel(side, !views()[side].open);

/** Both panels: hide both when either is showing, else show both. */
export function toggleAllPanels() {
  const v = views();
  const hide = v.left.open || v.right.open;
  prefs.set({ uiHidden: hide });
  setPanel('left', !hide);
  setPanel('right', !hide);
}

export function setPanelWidth(side: Side, w: number) { prefs.set({ [`${side}W`]: clampWidth(w) } as Partial<Prefs>); }
export const resetPanelWidth = (side: Side) => setPanelWidth(side, PREF_DEFAULTS[`${side}W`]);

// ---- file name (SHELL-2) ----
export const FILE_NAME_MAX = 60;
/** Trim and cap; empty reverts to "Untitled". */
export const cleanFileName = (s: string): string => s.trim().slice(0, FILE_NAME_MAX).trim() || 'Untitled';
export const RENAME_EVENT = 'pg-rename';

export const actions: Action[] = [
  { id: 'panel.left', title: 'Toggle left panel', group: 'View', keys: { all: ['Mod+Backslash'] }, contexts: ['canvas', 'panel', 'chat'], run: () => togglePanel('left') },
  { id: 'panel.right', title: 'Toggle right panel', group: 'View', keys: { all: ['Mod+Period'] }, contexts: ['canvas', 'panel', 'chat'], run: () => togglePanel('right') },
  { id: 'panel.ui', title: 'Toggle both panels', group: 'View', keys: { all: ['Mod+Shift+Backslash'] }, contexts: ['canvas', 'panel', 'chat'], run: toggleAllPanels },
  {
    id: 'shell.rename', title: 'Rename board', group: 'View', keys: { all: ['F2'] }, contexts: ['canvas', 'panel'],
    run: () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(RENAME_EVENT)); },
  },
];
