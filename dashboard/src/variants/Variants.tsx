// #/variants: compare design variants side by side from one branch, pick a whole variant or take
// slots from several, and save the result as a mix (final decision or the base for children).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { newComboId, uniqueId } from './files.ts';
import { buildGraph, childrenOf, comboTitle, makeCombo, parentsOf, problems, resolveAll, resolveSlot, singleSource, treeRows, withNode } from './model.ts';
import type { GNode } from './model.ts';
import { codeInfos, registry } from './registry.ts';
import type { Screen, Variant } from './registry.ts';
import { NodeView, Frame } from './NodeView.tsx';
import type { Zoom } from './NodeView.tsx';
import { Icon } from './icons.tsx';
import { Menu, MenuItem, MenuLabel, MenuSep } from './ui.tsx';
import { COLORS, DRAFT, HINT_KEY, LETTERS, MAX_PANES, VIEWPORTS, ZOOMS, readHash, widthName, writeHash, zoomName } from './constants.ts';
import type { PaneWidth, Viewport } from './constants.ts';
import { NameDialog, OverlayPane, Seg, WidthDialog } from './parts.tsx';
import { useScrollSync } from './hooks.ts';
import { boardNode, listFrames, PLAYGROUND_AVAILABLE, PLAYGROUND_BOARD, playgroundHref, snapshot } from './boards.ts';
import type { FrameInfo } from './boards.ts';
import { boardComponents, usePlaygroundBoard } from './BoardView.tsx';
import { ImportDialog } from './parts.tsx';
import { useLineage } from './store.ts';
import type { NodeId, SlotId } from './types.ts';
import './variants.css';

export function Variants() {
  const init = useMemo(readHash, []);
  const { screens } = registry;
  const [screenId, setScreenId] = useState(() => (screens.some((s) => s.id === init.screen) ? init.screen! : screens[0]?.id));
  const [viewport, setViewport] = useState<Viewport>(init.viewport ?? 'desktop');
  const [zoom, setZoom] = useState<Zoom>(init.zoom ?? 'fit');
  const lineage = useLineage();
  const screen = screens.find((s) => s.id === screenId);
  if (!screen) {
    return (
      <div className="vx vx-nothing">
        <h2>No design screens yet</h2>
        <p>Add <code>src/designs/&lt;screen&gt;/screen.tsx</code> and one folder per variant. See <code>src/designs/README.md</code>.</p>
      </div>
    );
  }
  return (
    <Workspace
      key={screen.id}
      screen={screen}
      variants={registry.variants.get(screen.id) ?? []}
      initPanes={screen.id === init.screen ? init.panes : undefined}
      onScreen={setScreenId}
      viewport={viewport}
      onViewport={setViewport}
      zoom={zoom}
      onZoom={setZoom}
      store={lineage}
    />
  );
}

type DialogState =
  | { kind: 'mix'; final: boolean; evolve: boolean }
  | { kind: 'child'; parent: NodeId }
  | { kind: 'width'; pane: number }
  | { kind: 'import' };

interface WorkspaceProps {
  screen: Screen;
  variants: Variant[];
  initPanes?: NodeId[];
  onScreen: (id: string) => void;
  viewport: Viewport;
  onViewport: (v: Viewport) => void;
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
  store: ReturnType<typeof useLineage>;
}

function Workspace({ screen, variants, initPanes, onScreen, viewport, onViewport, zoom, onZoom, store }: WorkspaceProps) {
  const { lineage, mode, error, setError, save, scaffold } = store;
  // Frames linked or copied from the playground board join the lineage like code variants.
  const { board: liveBoard, checkedAt } = usePlaygroundBoard(PLAYGROUND_BOARD);
  const boardNodes = useMemo(
    () => lineage.boards.filter((b) => b.screen === screen.id).map((r) => boardNode(r, liveBoard, screen.slots)),
    [lineage.boards, liveBoard, screen],
  );
  const boardById = useMemo(
    () => new Map(boardNodes.map((n) => [n.ref.id, { ...n, comps: boardComponents(n.data, n.ref.frameId, n.matches) }])),
    [boardNodes],
  );
  const graph = useMemo(
    () => buildGraph(screen.id, screen.slotIds, [...codeInfos(screen, variants), ...boardNodes.map((n) => n.info)], lineage.combos),
    [screen, variants, boardNodes, lineage.combos],
  );
  const rows = useMemo(() => treeRows(graph), [graph]);
  const byId = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);
  const issues = useMemo(() => [...registry.problems.filter((p) => p.includes(`/designs/${screen.id}/`)), ...problems(graph)], [graph, screen.id]);
  const final = lineage.final[screen.id];
  const slots = screen.slotIds;

  const [panes, setPanes] = useState<NodeId[]>(() => {
    if (initPanes?.length) return initPanes;
    const roots = rows.filter((r) => r.depth === 0).map((r) => r.id);
    return (roots.length >= 2 ? roots : rows.map((r) => r.id)).slice(0, 2);
  });
  const [focus, setFocus] = useState(0);
  const [isolate, setIsolate] = useState<SlotId | null>(null);
  const [draft, setDraft] = useState<Record<SlotId, number>>({});
  const [showResult, setShowResult] = useState(true);
  /** The result column stays a slim strip until the first pick, then opens once and stays open. */
  const [resultOpened, setResultOpened] = useState(false);
  /** One-time hint that parts of a design can be clicked; remembered per browser. */
  const [hintDone, setHintDone] = useState(() => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } });
  const dismissHint = () => { setHintDone(true); try { localStorage.setItem(HINT_KEY, '1'); } catch { /* storage blocked */ } };
  const [syncScroll, setSyncScroll] = useState(true);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [paneWidths, setPaneWidths] = useState<PaneWidth[]>([]);
  /** side = panes in columns; overlay = A and B stacked in one frame (swipe or onion skin). */
  const [viewMode, setViewMode] = useState<'side' | 'overlay'>('side');
  const [overlay, setOverlay] = useState<{ kind: 'swipe' | 'onion'; pos: number; top: number }>({ kind: 'swipe', pos: 50, top: 1 });
  const [toast, setToastState] = useState<{ text: string; undo?: () => void } | null>(null);
  const setToast = (text: string | null, undo?: () => void) => setToastState(text ? { text, undo } : null);
  /** Actual render scale per pane (key `p0`..`p3` or `result`), shown in pane headers. */
  const [scales, setScales] = useState<Record<string, number>>({});
  const onScale = (key: string) => (sc: number) => setScales((m) => (m[key] === sc ? m : { ...m, [key]: sc }));
  /** Slot under the pointer in each pane, described in that pane's info row (never drawn over the design). */
  const [hover, setHover] = useState<Record<number, SlotId | null>>({});
  const [pendingFocus, setPendingFocus] = useState<NodeId | null>(null);

  const width = VIEWPORTS[viewport] ?? screen.width;
  const widthOf = (i: number) => {
    const w = paneWidths[i] ?? null;
    const frame = boardById.get(panes[i])?.frame;
    if (w === null && frame && graph.nodes.get(panes[i])?.whole) return Math.round(frame.w);
    return w === null ? width : typeof w === 'number' ? w : VIEWPORTS[w] ?? screen.width;
  };
  const labels = screen.slots;
  useEffect(() => {
    const prev = document.title;
    document.title = `${screen.title} · Variants · InSync`;
    return () => { document.title = prev; };
  }, [screen.title]);
  const titleOf = useCallback((id: NodeId) => (id === DRAFT ? 'Result' : graph.nodes.get(id)?.title ?? id), [graph]);
  const comp = useCallback((id: NodeId, slot: SlotId) => byId.get(id)?.slots[slot] ?? boardById.get(id)?.comps.slots[slot], [byId, boardById]);
  /** A board frame with no parts named after the screen's slots renders as one whole page. */
  const wholeOf = (id: NodeId) => (graph.nodes.get(id)?.whole ? boardById.get(id)?.comps.Whole : undefined);

  useEffect(() => writeHash({ screen: screen.id, panes, viewport, zoom }), [screen.id, panes, viewport, zoom]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToastState(null), toast.undo ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => { if (focus >= panes.length) setFocus(panes.length - 1); }, [focus, panes.length]);
  // A child created from the page shows up once Vite hot-reloads the designs glob; open it then.
  useEffect(() => {
    if (pendingFocus && graph.nodes.has(pendingFocus)) {
      setPanes((p) => p.map((id, i) => (i === focus ? pendingFocus : id)));
      setPendingFocus(null);
    }
  }, [graph, pendingFocus, focus]);

  // ---- draft (which pane each slot comes from; unpicked slots come from pane A) ----
  const picks = useMemo(() => Object.fromEntries(slots.map((s) => [s, panes[draft[s] ?? 0] ?? panes[0]])) as Record<SlotId, NodeId>, [slots, panes, draft]);
  const hasDraft = Object.keys(draft).length > 0;
  const single = singleSource(slots, picks);
  const resultGraph = useMemo(
    () => withNode(graph, { id: DRAFT, kind: 'combo', title: 'Result', parents: parentsOf(slots, picks), own: [], picks } satisfies GNode),
    [graph, slots, picks],
  );

  const take = (slot: SlotId, pane: number) => {
    setResultOpened(true);
    setShowResult(true);
    if (!hintDone) dismissHint();
    setDraftSlot(slot, pane);
  };
  const setDraftSlot = (slot: SlotId, pane: number) =>
    setDraft((d) => {
      if (d[slot] === pane) { const { [slot]: _, ...rest } = d; return rest; }
      return { ...d, [slot]: pane };
    });
  // Only the parts this pane can supply (a playground frame may draw just some of them).
  const takeAll = (pane: number) => {
    setResultOpened(true);
    setShowResult(true);
    setDraft(Object.fromEntries(slots.filter((s) => resolveSlot(graph, panes[pane], s)).map((s) => [s, pane])));
  };

  const setPane = (i: number, id: NodeId) => setPanes((p) => p.map((x, j) => (j === i ? id : x)));
  const addPane = (id?: NodeId) => {
    if (panes.length >= MAX_PANES) return;
    const next = id ?? rows.find((r) => !panes.includes(r.id))?.id ?? rows[0]?.id;
    if (!next) return;
    setPanes((p) => [...p, next]);
    setFocus(panes.length);
  };
  const removePane = (i: number) => {
    if (panes.length <= 1) return;
    setPanes((p) => p.filter((_, j) => j !== i));
    setPaneWidths((w) => w.filter((_, j) => j !== i));
    if (panes.length <= 2) setViewMode('side');
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== i).map(([k, v]) => [k, v > i ? v - 1 : v])));
  };

  // ---- decisions ----
  const allIds = () => [...graph.nodes.keys(), ...variants.map((v) => v.id)];
  const chooseFinal = (id: NodeId) => {
    const before = lineage;
    const nextFinal = { ...lineage.final };
    if (nextFinal[screen.id] === id) delete nextFinal[screen.id];
    else nextFinal[screen.id] = id;
    void save({ ...lineage, final: nextFinal });
    const prev = before.final[screen.id];
    setToast(
      nextFinal[screen.id]
        ? `Chose “${titleOf(id)}” as the final design${prev ? ` (was “${titleOf(prev)}”)` : ''}`
        : `Cleared the final design (was “${titleOf(id)}”)`,
      () => { void save(before); setToast('Undone'); },
    );
  };

  const saveMix = (title: string, note: string, asFinal: boolean, evolve: boolean) => {
    const combo = makeCombo(graph, picks, { id: newComboId(allIds()), title, note, labels });
    const next = { ...lineage, combos: [...lineage.combos, combo], final: asFinal ? { ...lineage.final, [screen.id]: combo.id } : lineage.final };
    void save(next);
    setPanes((p) => p.map((id, i) => (i === 0 ? combo.id : id)));
    setFocus(0);
    setDraft({});
    setToast(`Saved mix “${combo.title}”${asFinal ? ' as the final design' : ''}`);
    setDialog(evolve ? { kind: 'child', parent: combo.id } : null);
  };

  const createChild = async (parent: NodeId, title: string, note: string) => {
    const id = uniqueId(title, allIds());
    const { sources } = resolveAll(graph, parent);
    try {
      const path = await scaffold({
        screen: screen.id, id, parent, title: title.trim() || id, note,
        slots: slots.map((s) => ({ slot: s, label: screen.slots[s] ?? s, from: sources[s], path: sources[s] ? byId.get(sources[s]!)?.path : undefined })),
      });
      setDialog(null);
      setPendingFocus(id);
      setToast(`Created ${path}. Edit its slots; it reloads here.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- playground frames ----
  const linkFrame = (f: FrameInfo, mode: 'live' | 'copy') => {
    if (!liveBoard) return;
    const ref = {
      id: uniqueId(`pg-${f.name}`, allIds()), screen: screen.id, title: f.name, boardId: PLAYGROUND_BOARD, frameId: f.id, mode,
      ...(mode === 'copy' ? { shapes: snapshot(liveBoard, f.id) } : {}), importedAt: new Date().toISOString(),
    };
    void save({ ...lineage, boards: [...lineage.boards, ref] });
    if (panes.length < MAX_PANES) { setPanes((p) => [...p, ref.id]); setFocus(panes.length); } else setPane(focus, ref.id);
    setToast(mode === 'live' ? `Linked “${f.name}”. It updates whenever the playground changes.` : `Copied “${f.name}” into the designs.`);
  };
  const freezeBoard = (id: NodeId) => {
    const n = boardById.get(id);
    if (!n || !liveBoard || !n.frame) return;
    const before = lineage;
    void save({ ...lineage, boards: lineage.boards.map((b) => (b.id === id ? { ...b, mode: 'copy' as const, shapes: snapshot(liveBoard, b.frameId) } : b)) });
    setToast(`Froze “${n.ref.title}”. Later board edits won’t change it.`, () => { void save(before); setToast('Undone'); });
  };
  const removeBoard = (id: NodeId) => {
    const kids = childrenOf(graph, id);
    if (kids.length) { setError(`“${titleOf(id)}” has children (${kids.map(titleOf).join(', ')}). Remove those first.`); return; }
    const before = lineage;
    const nextFinal = { ...lineage.final };
    if (nextFinal[screen.id] === id) delete nextFinal[screen.id];
    void save({ ...lineage, boards: lineage.boards.filter((b) => b.id !== id), final: nextFinal });
    setPanes((p) => { const left = p.filter((x) => x !== id); return left.length ? left : [rows.find((r) => r.id !== id)?.id ?? p[0]]; });
    setDraft({});
    setToast(`Removed “${titleOf(id)}” from the designs. The playground is untouched.`, () => { void save(before); setToast('Restored'); });
  };
  const playgroundLink = (id: NodeId) => {
    const f = boardById.get(id)?.frame;
    return f ? playgroundHref(f) : '#/playground';
  };

  const deleteMix = (id: NodeId) => {
    const kids = childrenOf(graph, id);
    if (kids.length) { setError(`“${titleOf(id)}” has children (${kids.map(titleOf).join(', ')}). Delete those first.`); return; }
    // No blocking confirm: delete at once and offer Undo (the mix is one JSON record).
    const before = lineage;
    const nextFinal = { ...lineage.final };
    if (nextFinal[screen.id] === id) delete nextFinal[screen.id];
    void save({ ...lineage, combos: lineage.combos.filter((c) => c.id !== id), final: nextFinal });
    setPanes((p) => {
      const left = p.filter((x) => x !== id);
      return left.length ? left : [rows.find((r) => r.id !== id)?.id ?? p[0]];
    });
    setDraft({});
    setToast(`Deleted the mix “${titleOf(id)}”. Its code variants are untouched.`, () => { void save(before); setToast('Mix restored'); });
  };

  // ---- keyboard ----
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    if (dialog || e.metaKey || e.ctrlKey || e.altKey || t?.closest('input, textarea, select, [contenteditable]')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= panes.length) { setFocus(n - 1); e.preventDefault(); return; }
    const pane = LETTERS.indexOf(e.key.toUpperCase());
    if (pane >= 0 && pane < panes.length && e.shiftKey) { takeAll(pane); e.preventDefault(); return; }
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'ArrowUp' || e.key === 'k') {
      const at = rows.findIndex((r) => r.id === panes[focus]);
      const step = e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1;
      const next = rows[(at + step + rows.length) % rows.length];
      if (next) setPane(focus, next.id);
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') { if (isolate) setIsolate(null); else setDraft({}); return; }
    if (e.key === 'r') { if (showResultPane) setShowResult(false); else openResult(); }
    if (e.key === '=' || e.key === '+' || e.key === '-') {
      const at = ZOOMS.indexOf(zoom);
      onZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at + (e.key === '-' ? -1 : 1)))]);
      e.preventDefault();
    }
    if (e.key === '0') onZoom('fit');
    if (e.key === 'o' && panes.length > 1) setViewMode((m) => (m === 'side' ? 'overlay' : 'side'));
    if (e.key === 'i') setIsolate((cur) => slots[(cur ? slots.indexOf(cur) + 1 : 0)] ?? null);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const { scrollRef, onScroll } = useScrollSync(syncScroll);

  // Only explicit picks are outlined; slots that fall back to A are not, so "chosen" never means "default".
  const pickedBy = (pane: number) => new Set(slots.filter((s) => draft[s] === pane));
  // The result column is part of the layout whenever there is something to mix, so picking never reflows the panes.
  const showResultPane = panes.length > 1 && showResult && (resultOpened || hasDraft);
  const showResultStrip = panes.length > 1 && !showResultPane;
  const openResult = () => { setResultOpened(true); setShowResult(true); };
  const pct = (key: string) => (scales[key] ? `${Math.round(scales[key] * 100)}%` : '');

  const comboCount = [...graph.nodes.values()].filter((n) => n.kind === 'combo').length;
  const overlayOn = viewMode === 'overlay' && panes.length > 1;
  const paneCols = overlayOn ? 1 : panes.length;
  const tracks = [...Array(paneCols).fill('minmax(0, 1fr)'), ...(showResultPane ? ['minmax(0, 1fr)'] : showResultStrip ? ['40px'] : [])].join(' ');
  const showHint = panes.length > 1 && !hintDone && !hasDraft && !overlayOn;
  const focusedId = panes[focus] ?? panes[0];
  const lastMsg = error ?? toast?.text ?? '';

  /** The ⋯ menu shared by the lineage tree rows and pane headers. */
  const nodeMenuItems = (id: NodeId, close: () => void, paneIndex?: number) => {
    const n = graph.nodes.get(id);
    const inPane = panes.indexOf(id);
    const bn = boardById.get(id);
    const inAPane = paneIndex !== undefined;
    return (
      <>
        {!inAPane && inPane < 0 && panes.length < MAX_PANES && <MenuItem close={close} onSelect={() => addPane(id)}>Open in a new pane</MenuItem>}
        {!inAPane && <MenuItem close={close} onSelect={() => setPane(focus, id)}>Show in pane {LETTERS[focus]}</MenuItem>}
        {inAPane && <MenuItem close={close} onSelect={() => chooseFinal(id)}>{final === id ? 'Clear the final design' : `Choose ${n?.title ?? id} as final`}</MenuItem>}
        {inAPane && panes.length > 1 && !n?.whole && (
          <MenuItem close={close} onSelect={() => takeAll(paneIndex)} hint={`⇧${LETTERS[paneIndex]}`}>Take every part from {LETTERS[paneIndex]}</MenuItem>
        )}
        {!n?.whole && <MenuItem close={close} onSelect={() => setDialog({ kind: 'child', parent: id })}>Start a child variant…</MenuItem>}
        {inAPane && (
          <>
            <MenuSep />
            <MenuLabel>Width of this pane</MenuLabel>
            {([null, 'desktop', 'tablet', 'mobile'] as PaneWidth[]).map((w) => (
              <MenuItem key={String(w)} close={close} kind="radio" checked={(paneWidths[paneIndex] ?? null) === w}
                onSelect={() => setPaneWidths((ws) => { const c = [...ws]; c[paneIndex] = w; return c; })}>
                {widthName(w)}{w !== null && typeof w === 'string' ? ` · ${VIEWPORTS[w] ?? screen.width}px` : ''}
              </MenuItem>
            ))}
            <MenuItem close={close} kind="radio" checked={typeof paneWidths[paneIndex] === 'number'} onSelect={() => setDialog({ kind: 'width', pane: paneIndex })}>
              Custom width…{typeof paneWidths[paneIndex] === 'number' ? ` (${paneWidths[paneIndex]}px)` : ''}
            </MenuItem>
          </>
        )}
        {bn && (
          <>
            <MenuSep />
            <MenuItem close={close} onSelect={() => { location.hash = playgroundLink(id); }}>Open in the playground</MenuItem>
            {bn.ref.mode === 'live' && <MenuItem close={close} disabled={!bn.frame} onSelect={() => freezeBoard(id)}>Freeze as a copy</MenuItem>}
          </>
        )}
        {(bn || n?.kind === 'combo') && (
          <>
            <MenuSep />
            {bn && <MenuItem close={close} danger onSelect={() => removeBoard(id)}>Remove from designs</MenuItem>}
            {n?.kind === 'combo' && <MenuItem close={close} danger onSelect={() => deleteMix(id)}>Delete this mix</MenuItem>}
          </>
        )}
      </>
    );
  };

  const paneHead = (i: number, id: NodeId) => {
    const n = graph.nodes.get(id);
    return (
      <div className="vx-pane-head">
        <span className="vx-badge" style={{ background: COLORS[i] }}>{LETTERS[i]}</span>
        <select className="vx-pane-select" value={id} onChange={(e) => setPane(i, e.target.value)} aria-label={`Design in pane ${LETTERS[i]}`}>
          {!n && <option value={id}>{id} (missing)</option>}
          {rows.map((r) => <option key={r.id} value={r.id}>{'   '.repeat(r.depth)}{graph.nodes.get(r.id)!.title}</option>)}
        </select>
        <div className="vx-grow" />
        {paneWidths[i] != null && <span className="vx-tag" title="This pane has its own width">{widthName(paneWidths[i]!)}</span>}
        <span className="vx-zoom" title={`Rendered at ${pct(`p${i}`)} of real size`}>{pct(`p${i}`)}</span>
        {n && final === id && <span className="vx-pill ok" title="This is the final design"><Icon name="star" size={12} />Final</span>}
        {n && <Menu label={`More for pane ${LETTERS[i]}`} trigger={<Icon name="more" />}>{(close) => nodeMenuItems(id, close, i)}</Menu>}
        {panes.length > 1 && <button className="vx-iconbtn" onClick={() => removePane(i)} title="Close pane" aria-label={`Close pane ${LETTERS[i]}`}><Icon name="close" /></button>}
      </div>
    );
  };

  const infoRow = (i: number, id: NodeId) => {
    const n = graph.nodes.get(id);
    if (!n) return null;
    const h = hover[i];
    return (
      <div className="vx-crumbs">
        {h && panes.length > 1 ? (
          <span className="vx-hoverhint" style={{ '--c': COLORS[i] } as CSSProperties}>
            <b>{labels[h]}</b>{draft[h] === i ? ` is taken from ${LETTERS[i]}. Click to put it back.` : ` · click to use this one`}
          </span>
        ) : (
          <>
            {n.parents.length > 0 && <span>from {n.parents.map(titleOf).join(' + ')}</span>}
            {n.note && <span className="ellipsis">{n.note}</span>}
            {!n.parents.length && !n.note && <span className="mono">{id}</span>}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="vx">
      <header className="vx-top">
        <div className="vx-brand">
          <a className="vx-iconbtn" href="#/" title="Back to the dashboard" aria-label="Back to the dashboard"><Icon name="back" /></a>
          <span className="vx-wordmark">InSync</span>
          <span className="vx-crumb">/ Variants</span>
        </div>
        <div className="vx-cmd">
          <label>
            <Icon name="layers" />
            <select value={screen.id} onChange={(e) => onScreen(e.target.value)} aria-label="Screen">
              {registry.screens.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
        </div>
        <div className="vx-top-right">
          {panes.length > 1 && (
            <Seg label="Compare view" value={viewMode} onChange={setViewMode}
              options={[['side', <><Icon name="columns" size={14} />Side by side</>], ['overlay', <><Icon name="overlay" size={14} />Overlay</>]]} />
          )}
          <Seg label="Device width" value={viewport} onChange={onViewport} options={[['desktop', 'Desktop'], ['tablet', 'Tablet'], ['mobile', 'Mobile']]} />
          <Menu label="Zoom and view options" className="vx-btn" trigger={<>{zoomName(zoom)}<Icon name="chevron" size={14} /></>}>
            {(close) => (
              <>
                <MenuLabel>Zoom</MenuLabel>
                {ZOOMS.map((z) => (
                  <MenuItem key={String(z)} close={close} kind="radio" checked={zoom === z} onSelect={() => onZoom(z)} hint={z === 'fit' ? '0' : undefined}>{zoomName(z)}</MenuItem>
                ))}
                <MenuSep />
                <MenuItem close={close} kind="check" checked={syncScroll} onSelect={() => setSyncScroll((v) => !v)}>Sync scrolling across panes</MenuItem>
                <MenuItem close={close} kind="check" checked={showResult} onSelect={() => setShowResult((v) => !v)} hint="R">Show the result pane</MenuItem>
              </>
            )}
          </Menu>
          <Menu label="Keyboard shortcuts" role="dialog" trigger={<Icon name="help" />}>
            <div className="vx-help">
              <b>Keyboard shortcuts</b>
              <dl>
                <dt>1 – 4</dt><dd>Focus a pane</dd>
                <dt>↑ ↓</dt><dd>Next design in the focused pane</dd>
                <dt>⇧A … ⇧D</dt><dd>Take every slot from that pane</dd>
                <dt>I</dt><dd>Compare one slot at a time</dd>
                <dt>O</dt><dd>Side by side / overlay</dd>
                <dt>− =</dt><dd>Zoom out / in</dd>
                <dt>0</dt><dd>Fit width</dd>
                <dt>R</dt><dd>Show or hide the result</dd>
                <dt>Esc</dt><dd>Clear picks</dd>
              </dl>
            </div>
          </Menu>
        </div>
      </header>

      <div className="vx-main">
        <aside className="vx-side">
          <div className="vx-pane-head">
            <span className="vx-hd">Designs</span><span className="vx-count">{rows.length}</span>
            <div className="vx-grow" />
            {PLAYGROUND_AVAILABLE && (
              <button className="vx-btn ghost sm" onClick={() => setDialog({ kind: 'import' })} title="Bring frames in from the playground board">
                <Icon name="import" size={14} />From playground
              </button>
            )}
          </div>
          <div className="vx-tree" role="tree" aria-label={`${screen.title} designs`}>
            {rows.map((r) => {
              const n = graph.nodes.get(r.id)!;
              const inPanes = panes.map((p, i) => (p === r.id ? i : -1)).filter((i) => i >= 0);
              const on = panes[focus] === r.id;
              return (
                <div
                  key={r.id}
                  role="treeitem"
                  aria-selected={on}
                  aria-level={r.depth + 1}
                  tabIndex={0}
                  className={`vx-row${on ? ' on' : ''}`}
                  style={{ paddingLeft: 10 + r.depth * 14 }}
                  onClick={() => setPane(focus, r.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setPane(focus, r.id); }}
                  title={n.note ?? (n.kind === 'combo' ? comboTitle(graph, n.picks ?? {}, labels) : n.title)}
                >
                  {r.depth > 0 && <span className="vx-guide" aria-hidden="true" />}
                  <span className="vx-row-title ellipsis">{n.title}</span>
                  {n.kind === 'combo' && <span className="vx-tag" title={`A mix of ${n.parents.map(titleOf).join(', ')}`}>mix</span>}
                  {n.source === 'live' && <span className={`vx-tag live${boardById.get(r.id)?.frame ? '' : ' lost'}`} title={n.note}>live</span>}
                  {n.source === 'copy' && <span className="vx-tag" title={n.note}>copy</span>}
                  {final === r.id && <span className="vx-pill ok">Final</span>}
                  {inPanes.map((i) => <span key={i} className="vx-badge" style={{ background: COLORS[i] }} title={`Shown in pane ${LETTERS[i]}`}>{LETTERS[i]}</span>)}
                  <span className="vx-row-actions" onClick={(e) => e.stopPropagation()}>
                    <Menu label={`More for ${n.title}`} className="vx-iconbtn sm" trigger={<Icon name="more" size={14} />}>{(close) => nodeMenuItems(r.id, close)}</Menu>
                  </span>
                </div>
              );
            })}
          </div>
          {issues.length > 0 && (
            <details className="vx-issues">
              <summary><Icon name="warn" size={14} /> {issues.length} problem{issues.length > 1 ? 's' : ''} in the designs</summary>
              <ul>{issues.map((p) => <li key={p} className="mono">{p}</li>)}</ul>
            </details>
          )}
        </aside>

        <div className="vx-center">
          <div className={`vx-editor${showHint ? ' coach' : ''}`} style={{ gridTemplateColumns: tracks }}>
            {overlayOn ? (
              <OverlayPane
                a={panes[0]} b={panes[1]} graph={graph} screen={screen} comp={comp} width={width} zoom={zoom} isolate={isolate}
                state={overlay} onState={setOverlay} titleOf={titleOf} onScale={onScale('p0')} pct={pct('p0')}
              />
            ) : (
              panes.map((id, i) => (
                <section key={i} className={`vx-pane${focus === i ? ' focus' : ''}`} style={{ '--c': COLORS[i] } as CSSProperties} onMouseDown={() => setFocus(i)} aria-label={`Pane ${LETTERS[i]}`}>
                  {paneHead(i, id)}
                  {infoRow(i, id)}
                  {showHint && i === 1 && (
                    <div className="vx-coach" role="note">
                      <b>Mix the best parts</b>
                      <p>Click any part of a design, like a button or a grid, to use it in the result. Parts you don’t pick come from A.</p>
                      <button className="vx-btn" onClick={dismissHint}>Got it</button>
                    </div>
                  )}
                  <div className="vx-canvas-area" ref={scrollRef(`p${i}`)} onScroll={() => onScroll(`p${i}`)}>
                    {graph.nodes.has(id) ? (
                      <Frame width={widthOf(i)} zoom={zoom} onScale={onScale(`p${i}`)}>
                        <NodeView screen={screen} graph={graph} nodeId={id} comp={comp} whole={wholeOf(id)} isolate={isolate} color={COLORS[i]} picked={pickedBy(i)}
                          onTake={panes.length > 1 ? (s) => take(s, i) : undefined} onHover={(s) => setHover((h) => ({ ...h, [i]: s }))} />
                      </Frame>
                    ) : (
                      <div className="vx-empty">{mode === 'loading' ? 'Loading…' : `“${id}” is not in this screen's designs.`}</div>
                    )}
                  </div>
                </section>
              ))
            )}
            {showResultPane && (
              <section className="vx-pane result" aria-label="Result">
                <div className="vx-pane-head">
                  <span className="vx-badge result">=</span>
                  <span className="vx-pane-title">Result</span>
                  <div className="vx-grow" />
                  {hasDraft && <span className="vx-zoom">{pct('result')}</span>}
                  <button className="vx-iconbtn" onClick={() => setShowResult(false)} title="Hide the result (R)" aria-label="Hide the result"><Icon name="close" /></button>
                </div>
                <div className="vx-crumbs"><span className="ellipsis">{!hasDraft ? 'Nothing taken yet' : single ? `All from ${titleOf(single)}` : comboTitle(graph, picks, labels)}</span></div>
                <div className="vx-canvas-area" ref={scrollRef('result')} onScroll={() => onScroll('result')}>
                  {hasDraft ? (
                    <Frame width={width} zoom={zoom} onScale={onScale('result')}>
                      <NodeView screen={screen} graph={resultGraph} nodeId={DRAFT} comp={comp} isolate={isolate} color="#57534e" picked={new Set()} />
                    </Frame>
                  ) : (
                    <div className="vx-result-empty">
                      <p>Click any part of a design to use it here.</p>
                      <p className="vx-note">Parts you don’t pick come from A. To decide on a whole design, click its pane and use <b>Choose … as final</b> below.</p>
                    </div>
                  )}
                </div>
              </section>
            )}
            {showResultStrip && (
              <button className="vx-strip" onClick={openResult} title="Show the result (R)" aria-label="Show the result">
                <Icon name="chevron" size={14} />
                <span>Result</span>
              </button>
            )}
            {!overlayOn && panes.length < MAX_PANES && (
              <button className="vx-add" onClick={() => addPane()} title="Compare another design" aria-label="Add a pane"><Icon name="plus" /></button>
            )}
          </div>

          <div className="vx-panel">
              <div className="vx-picks">
                {panes.length < 2 ? (
                  <span className="vx-hint">
                    Add another design to compare it and mix their parts.{' '}
                    <button className="vx-btn" onClick={() => addPane()}><Icon name="plus" size={14} />Compare another</button>
                  </span>
                ) : <span className="vx-hd vx-picks-hd">Use from</span>}
                {panes.length > 1 && slots.map((s) => {
                  const at = draft[s];
                  return (
                    <div key={s} className="vx-pick">
                      <button className={`vx-slotname${isolate === s ? ' on' : ''}`} onClick={() => setIsolate(isolate === s ? null : s)}
                        aria-pressed={isolate === s} title={isolate === s ? 'Show whole designs again' : `Compare only the ${labels[s].toLowerCase()} (I)`}>
                        {isolate === s && <Icon name="focus" size={12} />}{labels[s]}
                      </button>
                      <div className="vx-seg letters" role="radiogroup" aria-label={`Use ${labels[s]} from`}>
                        {panes.map((_, i) => {
                          const state = (at ?? 0) === i ? (at === undefined ? 'base' : 'on') : '';
                          const can = !!resolveSlot(graph, panes[i], s);
                          return (
                            <button key={i} role="radio" aria-checked={state !== ''} className={state} style={{ '--c': COLORS[i] } as CSSProperties} onClick={() => take(s, i)}
                              disabled={!can && state !== 'on'}
                              title={!can ? `${titleOf(panes[i])} has no ${labels[s].toLowerCase()} layer` : state === 'base' ? `${labels[s]}: from A until you pick` : `Use the ${labels[s].toLowerCase()} from ${LETTERS[i]}`}>
                              {LETTERS[i]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div className="vx-grow" />
                <div className="vx-actions">
                  {hasDraft && <button className="vx-btn ghost" onClick={() => setDraft({})} title="Clear picks (Esc)">Clear</button>}
                  {hasDraft && !showResultPane && <button className="vx-btn" onClick={openResult}>Show result</button>}
                  {/* One decision button that follows what the user has done: a whole design, or the mix. */}
                  {!hasDraft ? (
                    final === focusedId ? (
                      <>
                        <span className="vx-pill ok"><Icon name="star" size={12} />{titleOf(focusedId)} is the final design</span>
                        <button className="vx-btn ghost" onClick={() => chooseFinal(focusedId)}>Clear</button>
                      </>
                    ) : (
                      <button className="vx-btn primary" disabled={!graph.nodes.has(focusedId)} onClick={() => chooseFinal(focusedId)}
                        title="Click a pane to choose which design this decides on">
                        {panes.length > 1 && <span className="vx-badge" style={{ background: COLORS[focus] }}>{LETTERS[focus]}</span>}
                        Choose {titleOf(focusedId)} as final
                      </button>
                    )
                  ) : single ? (
                    <button className="vx-btn primary" onClick={() => { chooseFinal(single); setDraft({}); }}>Choose {titleOf(single)} as final</button>
                  ) : (
                    <>
                      <span className="vx-split">
                        <button className="vx-btn" disabled={!hasDraft} onClick={() => setDialog({ kind: 'mix', final: false, evolve: false })}>Save mix</button>
                        <Menu label="More ways to save" className="vx-btn vx-split-caret" trigger={<Icon name="chevron" size={14} />}>
                          {(close) => (
                            <MenuItem close={close} disabled={!hasDraft} onSelect={() => setDialog({ kind: 'mix', final: false, evolve: true })}>Save mix and start a child variant…</MenuItem>
                          )}
                        </Menu>
                      </span>
                      <button className="vx-btn primary" disabled={!hasDraft} onClick={() => setDialog({ kind: 'mix', final: true, evolve: false })}>Save as final</button>
                    </>
                  )}
                </div>
              </div>
            </div>
        </div>
      </div>

      <footer className="vx-status">
        <span className="seg">{screen.title}</span>
        <span>{final ? <>Final: <b>{titleOf(final)}</b></> : 'No final design yet'}</span>
        <span className="vx-grow" />
        <span>{variants.length} design{variants.length === 1 ? '' : 's'} · {comboCount} mix{comboCount === 1 ? '' : 'es'}</span>
        {boardNodes.some((n) => n.ref.mode === 'live') && (
          <span title="Live playground frames refresh when the playground saves">
            {liveBoard ? `Playground synced ${new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : 'No playground board in this browser'}
          </span>
        )}
        <span>{mode === 'repo' ? 'Saved to the repo' : mode === 'local' ? 'Saved in this browser only' : 'Loading…'}</span>
      </footer>

      {/* Always mounted so screen readers announce changes; the visible toast lives inside. */}
      <div className="vx-live" role="status" aria-live="polite">
        {lastMsg && (
          <div className={`vx-toast${error ? ' err' : ''}`}>
            {lastMsg}
            {!error && toast?.undo && <button className="vx-toast-action" onClick={toast.undo}>Undo</button>}
            {error && <button onClick={() => setError(null)} aria-label="Dismiss"><Icon name="close" size={14} /></button>}
          </div>
        )}
      </div>

      {dialog?.kind === 'mix' && (
        <NameDialog
          heading={dialog.final ? 'Save as the final design' : dialog.evolve ? 'Save mix, then start a child' : 'Save mix'}
          defaultTitle={comboTitle(graph, picks, labels)}
          confirm={dialog.final ? 'Save as final' : dialog.evolve ? 'Save and continue' : 'Save'}
          onCancel={() => setDialog(null)}
          onConfirm={(t, n) => saveMix(t, n, dialog.final, dialog.evolve)}
        >
          <ul className="vx-summary">
            {slots.map((s) => {
              const pane = panes.indexOf(picks[s]);
              return (
                <li key={s}>
                  <span>{labels[s]}</span>
                  <b>{pane >= 0 && <span className="vx-badge" style={{ background: COLORS[pane] }}>{LETTERS[pane]}</span>}{titleOf(picks[s])}</b>
                </li>
              );
            })}
          </ul>
        </NameDialog>
      )}
      {dialog?.kind === 'child' && (
        <NameDialog
          heading={`New child of “${titleOf(dialog.parent)}”`}
          defaultTitle=""
          placeholder="e.g. Rounder buttons"
          confirm="Create files"
          onCancel={() => setDialog(null)}
          onConfirm={(t, n) => void createChild(dialog.parent, t || `${titleOf(dialog.parent)} child`, n)}
        >
          <p className="vx-note">
            Creates <code className="mono">src/designs/{screen.id}/&lt;id&gt;/index.tsx</code>. It looks exactly like its parent until you, or an agent,
            change a part in that file.
          </p>
        </NameDialog>
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog
          board={liveBoard}
          frames={liveBoard ? listFrames(liveBoard) : []}
          linked={new Map(lineage.boards.filter((b) => b.screen === screen.id).map((b) => [b.frameId, b]))}
          slots={screen.slots}
          onLink={(f, m) => { linkFrame(f, m); setDialog(null); }}
          onShow={(id) => { setPane(focus, id); setDialog(null); }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'width' && (
        <WidthDialog
          pane={LETTERS[dialog.pane]}
          initial={typeof paneWidths[dialog.pane] === 'number' ? (paneWidths[dialog.pane] as number) : widthOf(dialog.pane)}
          onCancel={() => setDialog(null)}
          onConfirm={(w) => { const at = dialog.pane; setPaneWidths((ws) => { const c = [...ws]; c[at] = w; return c; }); setDialog(null); }}
        />
      )}
    </div>
  );
}
