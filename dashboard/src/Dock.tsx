// Editor groups, like VS Code: the Code map, Changes, Control and Chat views are tabs. Drag a tab to
// reorder it, drop it on another group's tab strip to move it there, or drop it on a group's left
// or right edge to split that group. Groups resize by dragging the edge between them. A closed view
// comes back from the title bar. The arrangement is saved per browser.
//
// Keyboard: on a focused tab, Ctrl+Shift+Left/Right reorders it; Ctrl+Alt+Left/Right moves it to
// the next group (making one at the end if needed).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ICON } from './Workbench.tsx';

export type ViewId = 'map' | 'changes' | 'control' | 'chat';
export const VIEWS: ViewId[] = ['map', 'changes', 'control', 'chat'];
interface Group { id: string; views: ViewId[]; active: ViewId; size: number }
export interface DockState { groups: Group[]; v?: number }

const KEY = 'insync.workbench.dock';
const MIN_PX = 240;
/** The narrowest a group gets when the window or side bar squeezes the editor (the sash itself stops at
 *  MIN_PX). Below this the editor scrolls sideways instead of breaking text one word per line. */
const MIN_W = 180;
// Code map and its code changes side by side, Chat on the right
const VERSION = 2;
const DEFAULT: DockState = { v: VERSION, groups: [
  { id: 'g1', views: ['map', 'control'], active: 'map', size: 1.25 },
  { id: 'g2', views: ['changes'], active: 'changes', size: 1.3 },
  { id: 'g3', views: ['chat'], active: 'chat', size: 0.9 },
] };

let seq = 0;
const newId = () => `g${Date.now().toString(36)}${seq++}`;

function load(): DockState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as DockState | null;
    if (raw?.groups?.length) {
      // keep only known views, each once; drop empty groups
      const seen = new Set<ViewId>();
      const groups = raw.groups
        .map((g) => ({ ...g, views: g.views.filter((v) => VIEWS.includes(v) && !seen.has(v) && seen.add(v)) }))
        .filter((g) => g.views.length)
        .map((g) => ({ ...g, active: g.views.includes(g.active) ? g.active : g.views[0], size: g.size > 0 ? g.size : 1 }));
      // saved before the Changes tab existed: give it its own group right of the map's
      if ((raw.v ?? 1) < 2 && !seen.has('changes')) {
        const at = groups.findIndex((g) => g.views.includes('map')) + 1;
        groups.splice(at > 0 ? at : groups.length, 0, { id: newId(), views: ['changes'], active: 'changes', size: 1 });
      }
      if (groups.length) return { v: VERSION, groups };
    }
  } catch { /* no storage: defaults */ }
  return DEFAULT;
}

/** Remove a view from wherever it is; drop groups left empty. */
function without(s: DockState, v: ViewId): DockState {
  return {
    groups: s.groups
      .map((g) => (g.views.includes(v) ? { ...g, views: g.views.filter((x) => x !== v), active: g.active === v ? (g.views.filter((x) => x !== v)[Math.max(0, g.views.indexOf(v) - 1)] ?? g.views[0]) : g.active } : g))
      .filter((g) => g.views.length),
  };
}

export function useDock() {
  const [dock, setDock] = useState<DockState>(load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ ...dock, v: VERSION })); } catch { /* private window */ }
  }, [dock]);
  const isOpen = (v: ViewId) => dock.groups.some((g) => g.views.includes(v));

  const activate = useCallback((gid: string, v: ViewId) => setDock((s) => ({ groups: s.groups.map((g) => (g.id === gid ? { ...g, active: v } : g)) })), []);
  /** Put `v` into group `gid` at `index` (end when undefined). */
  const move = useCallback((v: ViewId, gid: string, index?: number) => setDock((s) => {
    const from = s.groups.find((g) => g.views.includes(v));
    const target = s.groups.find((g) => g.id === gid);
    if (!target) return s;
    let at = index ?? target.views.length;
    if (from?.id === gid && from.views.indexOf(v) < at) at -= 1; // the tab leaves its old slot first
    const out = without(s, v);
    const exists = out.groups.some((g) => g.id === gid);
    const groups = exists ? out.groups : [...out.groups, { ...target, views: [] }];
    return { groups: groups.map((g) => (g.id === gid ? { ...g, views: [...g.views.slice(0, at), v, ...g.views.slice(at)], active: v } : g)) };
  }), []);
  /** Split: `v` gets its own new group beside group `gid`. */
  const split = useCallback((v: ViewId, gid: string, side: 'left' | 'right') => setDock((s) => {
    const host = s.groups.find((g) => g.id === gid);
    if (!host || (host.views.length === 1 && host.views[0] === v)) return s; // already alone there
    const out = without(s, v);
    const i = out.groups.findIndex((g) => g.id === gid);
    const at = i < 0 ? out.groups.length : side === 'right' ? i + 1 : i;
    const half = Math.max(0.5, (host.size || 1) / 2);
    const groups = out.groups.map((g) => (g.id === gid ? { ...g, size: half } : g));
    groups.splice(at, 0, { id: newId(), views: [v], active: v, size: half });
    return { groups };
  }), []);
  const close = useCallback((v: ViewId) => setDock((s) => without(s, v)), []);
  const open = useCallback((v: ViewId) => setDock((s) => {
    if (s.groups.some((g) => g.views.includes(v))) return { groups: s.groups.map((g) => (g.views.includes(v) ? { ...g, active: v } : g)) };
    if (!s.groups.length) return { groups: [{ id: newId(), views: [v], active: v, size: 1 }] };
    // chat reopens as its own group on the right, like a side bar; changes opens beside the map;
    // the others join the first group
    if (v === 'changes') {
      const at = s.groups.findIndex((g) => g.views.includes('map')) + 1;
      const groups = s.groups.slice();
      groups.splice(at > 0 ? at : groups.length, 0, { id: newId(), views: [v], active: v, size: 1 });
      return { groups };
    }
    if (v === 'chat') return { groups: [...s.groups, { id: newId(), views: [v], active: v, size: Math.max(0.6, s.groups.reduce((a, g) => a + g.size, 0) / 3) }] };
    return { groups: s.groups.map((g, i) => (i === 0 ? { ...g, views: [...g.views, v], active: v } : g)) };
  }), []);
  /** Drag the edge between group i and i+1 by dx pixels, out of `width` total. */
  const resize = useCallback((i: number, dx: number, width: number, start: number[]) => setDock((s) => {
    const total = start.reduce((a, b) => a + b, 0);
    const unit = total / Math.max(1, width);
    const min = MIN_PX * unit;
    let a = start[i] + dx * unit, b = start[i + 1] - dx * unit;
    if (a < min) { b -= min - a; a = min; }
    if (b < min) { a -= min - b; b = min; }
    if (a < min || b < min) return s;
    return { groups: s.groups.map((g, k) => (k === i ? { ...g, size: a } : k === i + 1 ? { ...g, size: b } : g)) };
  }), []);
  const reset = useCallback(() => setDock(DEFAULT), []);
  return { dock, isOpen, activate, move, split, close, open, resize, reset };
}

type Dock = ReturnType<typeof useDock>;

/** Which drops of view `v` onto group `g` would change anything. Moving into the group it is already
 *  in, splitting a group that holds only `v`, or dropping a tab back on its own slot do nothing, so
 *  the UI offers none of them. */
export function dropTargets(g: Pick<Group, 'views'>, v: ViewId): { move: boolean; split: boolean } {
  const inside = g.views.includes(v);
  return { move: !inside, split: !(inside && g.views.length === 1) };
}
export function tabDropUseful(g: Pick<Group, 'views'>, v: ViewId, index: number): boolean {
  const at = g.views.indexOf(v);
  return at < 0 || (index !== at && index !== at + 1);
}
const MIME = 'application/x-insync-view';
type Drop = { gid: string; kind: 'tab'; index: number } | { gid: string; kind: 'left' | 'right' | 'center' };

/** `below`: content drawn under the group that holds `view` (only as wide as that group), e.g. the
 *  Savings panel under the code map. */
export function DockArea({ dock, views, below }: {
  dock: Dock; views: Record<ViewId, { title: string; icon: ReactNode; hint?: string; render: () => ReactNode }>; below?: { view: ViewId; node: ReactNode };
}) {
  const area = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<ViewId>();
  const [drop, setDrop] = useState<Drop>();
  const groups = dock.dock.groups;

  const finish = (v: ViewId, d: Drop | undefined) => {
    if (d) {
      if (d.kind === 'tab') dock.move(v, d.gid, d.index);
      else if (d.kind === 'center') dock.move(v, d.gid);
      else dock.split(v, d.gid, d.kind);
    }
    setDragging(undefined);
    setDrop(undefined);
  };
  const viewFrom = (e: React.DragEvent): ViewId | undefined => {
    const v = e.dataTransfer.getData(MIME) as ViewId;
    return VIEWS.includes(v) ? v : dragging;
  };

  if (!groups.length) {
    return <div className="dock empty">All editors are closed. Open the Code map, Control or Chat from the title bar.</div>;
  }

  return (
    <div className="dock" ref={area}>
      {groups.map((g, gi) => (
        <div key={g.id} className="dock-wrap" style={{ flex: `${g.size} 1 0`, minWidth: MIN_W }}>
          <section className="group" aria-label={`Editor group ${gi + 1}`}>
            <div className={'tabs' + (drop?.gid === g.id && drop.kind === 'tab' ? ' drop' : '')} role="tablist" aria-label={`Editor group ${gi + 1} tabs`}
              onDragOver={(e) => {
                if (!dragging) return;
                const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('.etab')];
                const found = tabs.findIndex((t) => { const r = t.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
                const index = found < 0 ? tabs.length : found;
                // a drop that would leave the tab where it is: no marker, and the cursor says no
                if (!tabDropUseful(g, dragging, index)) { setDrop((d) => (d?.gid === g.id ? undefined : d)); return; }
                e.preventDefault();
                setDrop({ gid: g.id, kind: 'tab', index });
              }}
              onDrop={(e) => { e.preventDefault(); const v = viewFrom(e); if (v) finish(v, drop); }}>
              {g.views.map((v, i) => (
                <div key={v} className={'etab' + (drop?.gid === g.id && drop.kind === 'tab' && drop.index === i ? ' before' : '') + (drop?.gid === g.id && drop.kind === 'tab' && drop.index === g.views.length && i === g.views.length - 1 ? ' after' : '')}
                  aria-selected={g.active === v} role="presentation">
                  <button type="button" role="tab" aria-selected={g.active === v} className="etab-btn" draggable title={views[v].hint ?? `${views[v].title} · drag to move or split`}
                    onClick={() => dock.activate(g.id, v)}
                    onDragStart={(e) => { e.dataTransfer.setData(MIME, v); e.dataTransfer.effectAllowed = 'move'; setDragging(v); }}
                    onDragEnd={() => { setDragging(undefined); setDrop(undefined); }}
                    onKeyDown={(e) => {
                      if (!e.ctrlKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                      e.preventDefault();
                      const step = e.key === 'ArrowLeft' ? -1 : 1;
                      if (e.shiftKey) dock.move(v, g.id, Math.max(0, Math.min(g.views.length, i + (step > 0 ? 2 : -1))));
                      else if (e.altKey) {
                        const next = groups[gi + step];
                        if (next) dock.move(v, next.id);
                        else dock.split(v, g.id, step > 0 ? 'right' : 'left');
                      }
                    }}>
                    {views[v].icon}<span className="etab-title">{views[v].title}</span>
                  </button>
                  <button type="button" className="etab-x" aria-label={`Close ${views[v].title}`} title="Close" onClick={() => dock.close(v)}>{ICON.close}</button>
                </div>
              ))}
              <span className="grow" />
              {g.views.length > 1 && (
                <button type="button" className="iconbtn" style={{ alignSelf: 'center' }} aria-label={`Split ${views[g.active].title} to the right`} title="Split right"
                  onClick={() => dock.split(g.active, g.id, 'right')}>
                  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 2.5v11" stroke="currentColor" strokeWidth="1.4" /></svg>
                </button>
              )}
            </div>
            <div className="group-body">
              {views[g.active].render()}
              {dragging && (
                <div className="drop-layer"
                  onDragOver={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const x = (e.clientX - r.left) / r.width;
                    const kind = x < 0.3 ? 'left' : x > 0.7 ? 'right' : 'center';
                    const ok = dropTargets(g, dragging);
                    if (kind === 'center' ? !ok.move : !ok.split) { setDrop((d) => (d?.gid === g.id ? undefined : d)); return; }
                    e.preventDefault();
                    setDrop({ gid: g.id, kind });
                  }}
                  onDragLeave={() => setDrop((d) => (d?.gid === g.id && d.kind !== 'tab' ? undefined : d))}
                  onDrop={(e) => { e.preventDefault(); const v = viewFrom(e); if (v) finish(v, drop); }}>
                  {drop?.gid === g.id && drop.kind !== 'tab' && <div className={`drop-hint ${drop.kind}`}>{drop.kind === 'center' ? 'Move here' : `Split ${drop.kind}`}</div>}
                </div>
              )}
            </div>
            {below && g.views.includes(below.view) && below.node}
          </section>
          {gi < groups.length - 1 && (
            <GroupSash label={`Resize editor groups ${gi + 1} and ${gi + 2}`} onDrag={(dx, start) => dock.resize(gi, dx, area.current?.clientWidth ?? 1000, start)} sizes={groups.map((x) => x.size)} />
          )}
        </div>
      ))}
    </div>
  );
}

function GroupSash({ label, sizes, onDrag }: { label: string; sizes: number[]; onDrag: (dx: number, start: number[]) => void }) {
  const start = useRef<{ x: number; sizes: number[] } | null>(null);
  const [on, setOn] = useState(false);
  return (
    <div className={'sash v group-sash' + (on ? ' dragging' : '')} role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0} title="Drag to resize"
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, sizes }; setOn(true); }}
      onPointerMove={(e) => { if (start.current) onDrag(e.clientX - start.current.x, start.current.sizes); }}
      onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); start.current = null; setOn(false); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onDrag(e.key === 'ArrowLeft' ? -24 : 24, sizes); }
      }} />
  );
}
