// Colour picker (PROPS-12): saturation/value square, hue slider, opacity slider, hex input, recent + agent swatches.
//
//   <ColorPicker value={{ color: '#ff0000', opacity: 1 }}
//                onPreview={(v) => ...}   // fires on every drag/keystroke step: show it live, do not make an undo entry
//                onCommit={(v) => ...}    // fires once when an interaction ends (pointer up, Enter, key step, swatch)
//                onCancel={() => ...}     // Esc: the caller drops the preview; the picker also resets its own display
//                agentColors={[...]} />   // optional swatch row of the board's agent colours
//
// To wire it to the board, `useColorGesture(board, apply)` returns the three callbacks: previews run in one
// board.gesture, commit closes it as ONE undo entry (coalesced per key), cancel aborts it.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import type { BoardKit } from '../../core/commands';
import { cssRgba, hsvToHex, normalizeHex, parseColor, rgbToHsv } from '../../core/color';
import type { HSV } from '../../core/color';
import { prefs } from '../../core/prefs';
import type { Command, Gesture } from '../../core/types';
import '../../styles/picker.css';

export interface ColorValue { color: string; opacity: number }   // color '#rrggbb', opacity 0..1
export interface ColorPickerProps {
  value: ColorValue;
  onPreview(v: ColorValue): void;
  onCommit(v: ColorValue): void;
  onCancel(): void;
  agentColors?: readonly string[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const MAX_RECENTS = 10;

/** Remember a committed colour at the front of the per-viewer recent list. */
export function pushRecent(hex: string) {
  const list = prefs.get().recents.filter((c) => c !== hex);
  prefs.set({ recents: [hex, ...list].slice(0, MAX_RECENTS) });
}

export function ColorPicker({ value, onPreview, onCommit, onCancel, agentColors }: ColorPickerProps) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(parseColor(value.color) ?? { r: 0, g: 0, b: 0 }));
  const [opacity, setOpacity] = useState(value.opacity);
  const [hexText, setHexText] = useState<string | null>(null);   // non-null while the hex field is being edited
  const dragging = useRef(false);
  const base = useRef(value);                                     // what Esc goes back to
  const recents = useSyncExternalStore(prefs.subscribe, () => prefs.get().recents);
  const cur = hsvToHex(hsv);

  // An outside change (agent edit, undo) updates the display, but never while the user is dragging.
  // Grey keeps its hue because we only replace hsv when the hex actually differs.
  useEffect(() => {
    if (dragging.current) return;
    base.current = value;
    if (normalizeHex(value.color) !== cur) setHsv(rgbToHsv(parseColor(value.color) ?? { r: 0, g: 0, b: 0 }));
    setOpacity(value.opacity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.color, value.opacity]);

  const preview = (h: HSV, o: number) => { setHsv(h); setOpacity(o); onPreview({ color: hsvToHex(h), opacity: o }); };
  const commit = (h: HSV, o: number) => {
    const v = { color: hsvToHex(h), opacity: o };
    base.current = v;
    onCommit(v);
    pushRecent(v.color);
  };
  const cancel = () => {
    dragging.current = false;
    setHexText(null);
    setHsv(rgbToHsv(parseColor(base.current.color) ?? { r: 0, g: 0, b: 0 }));
    setOpacity(base.current.opacity);
    onCancel();
  };
  const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancel(); } };

  // One pointer drag over an element: `at` maps a 0..1 position to a new state.
  function dragProps(at: (x: number, y: number) => [HSV, number]) {
    const run = (e: RPointerEvent<HTMLElement>, final: boolean) => {
      const r = e.currentTarget.getBoundingClientRect();
      const [h, o] = at(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
      if (final) commit(h, o); else preview(h, o);
    };
    return {
      onPointerDown(e: RPointerEvent<HTMLElement>) {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragging.current = true;
        e.currentTarget.focus();
        run(e, false);
      },
      onPointerMove(e: RPointerEvent<HTMLElement>) { if (dragging.current) run(e, false); },
      onPointerUp(e: RPointerEvent<HTMLElement>) { if (dragging.current) { dragging.current = false; run(e, true); } },
      onPointerCancel() { if (dragging.current) cancel(); },
    };
  }

  // Keyboard: arrows step by 1% (Shift 10%), then commit straight away.
  function step(e: KeyboardEvent, fn: (dx: number, dy: number) => [HSV, number]) {
    const d = e.shiftKey ? 0.1 : 0.01;
    const dx = e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0;
    const dy = e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0;
    if (!dx && !dy) return onEsc(e);
    e.preventDefault();
    const [h, o] = fn(dx, dy);
    preview(h, o);
    commit(h, o);
  }

  const applyHex = () => {
    const c = hexText === null ? null : parseColor(hexText);
    setHexText(null);
    if (!c) return;                                 // invalid: field snaps back to the current colour
    const h = rgbToHsv(c);
    const next = { ...h, h: h.s === 0 ? hsv.h : h.h };   // grey keeps the hue
    const o = hexText!.replace('#', '').length === 8 || hexText!.replace('#', '').length === 4 ? c.a : opacity;
    preview(next, o);
    commit(next, o);
  };

  const sq = dragProps((x, y) => [{ ...hsv, s: x, v: 1 - y }, opacity]);
  const hueDrag = dragProps((x) => [{ ...hsv, h: x * 360 }, opacity]);
  const alphaDrag = dragProps((x) => [hsv, Math.round(x * 100) / 100]);
  const pick = (hex: string) => {
    const c = parseColor(hex);
    if (!c) return;
    const h = rgbToHsv(c);
    const next = { ...h, h: h.s === 0 ? hsv.h : h.h };
    preview(next, opacity);
    commit(next, opacity);
  };

  return (
    <div className="pg-cp" role="group" aria-label="Colour picker" onKeyDown={onEsc}>
      <div
        className="pg-cp-sq" role="slider" tabIndex={0} aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        aria-valuenow={Math.round(hsv.s * 100)} aria-valuemin={0} aria-valuemax={100}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})` }}
        onKeyDown={(e) => step(e, (dx, dy) => [{ ...hsv, s: clamp01(hsv.s + dx), v: clamp01(hsv.v - dy) }, opacity])}
        {...sq}
      >
        <i className="pg-cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: cur }} />
      </div>

      <div className="pg-cp-sliders">
        <div className="pg-cp-sw" style={{ background: cssRgba(cur, opacity) }} />
        <div className="pg-cp-bars">
          <div
            className="pg-cp-bar" role="slider" tabIndex={0} aria-label="Hue" aria-valuemin={0} aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            onKeyDown={(e) => step(e, (dx) => [{ ...hsv, h: Math.min(360, Math.max(0, hsv.h + dx * 360)) }, opacity])}
            {...hueDrag}
          >
            <i className="pg-cp-knob" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
          <div
            className="pg-cp-bar pg-cp-checker" role="slider" tabIndex={0} aria-label="Opacity" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(opacity * 100)}
            onKeyDown={(e) => step(e, (dx) => [hsv, Math.round(clamp01(opacity + dx) * 100) / 100])}
            {...alphaDrag}
          >
            <span className="pg-cp-fade" style={{ background: `linear-gradient(to right, transparent, ${cur})` }} />
            <i className="pg-cp-knob" style={{ left: `${opacity * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="pg-cp-fields">
        <label>
          <span>Hex</span>
          <input
            aria-label="Hex colour" spellCheck={false} value={hexText ?? cur.slice(1).toUpperCase()}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={applyHex}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyHex(); }
              else if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setHexText(null); cancel(); }
            }}
          />
        </label>
        <label>
          <span>%</span>
          <input
            aria-label="Opacity percent" inputMode="numeric" value={Math.round(opacity * 100)}
            onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) preview(hsv, clamp01(n / 100)); }}
            onBlur={() => commit(hsv, opacity)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(hsv, opacity); } else if (e.key === 'Escape') { e.stopPropagation(); cancel(); } }}
          />
        </label>
      </div>

      {recents.length > 0 && <SwatchRow title="Recent" colors={recents} onPick={pick} />}
      {agentColors && agentColors.length > 0 && <SwatchRow title="Agents" colors={agentColors} onPick={pick} />}
    </div>
  );
}

function SwatchRow({ title, colors, onPick }: { title: string; colors: readonly string[]; onPick(c: string): void }) {
  return (
    <div className="pg-cp-row" aria-label={title}>
      <span>{title}</span>
      <div>
        {colors.map((c) => (
          <button key={c} type="button" className="pg-cp-chip" title={c} aria-label={`${title} ${c}`} style={{ background: c }} onClick={() => onPick(c)} />
        ))}
      </div>
    </div>
  );
}

/**
 * Wires the picker to the board. `commands(v)` turns a picked colour into the commands to run
 * (for example `[{ t: 'shape.update', ids, patch: { fills: [{ type: 'solid', color, opacity }] } }]`).
 * The first preview opens a board.gesture, later ones update it, commit closes it (ONE undo entry,
 * coalesced under `key`), cancel aborts it so the shapes snap back.
 */
export function useColorGesture(board: BoardKit, commands: (v: ColorValue) => Command[], label = 'Change colour', key = 'colour') {
  const g = useRef<Gesture | null>(null);
  const cmds = useRef(commands);
  cmds.current = commands;
  useEffect(() => () => { g.current?.abort(); g.current = null; }, []);
  const onPreview = useCallback((v: ColorValue) => {
    if (!g.current) g.current = board.gesture(board.me, label, { coalesceKey: key });
    g.current.update(cmds.current(v));
  }, [board, label, key]);
  const onCommit = useCallback((v: ColorValue) => {
    if (!g.current) g.current = board.gesture(board.me, label, { coalesceKey: key });
    g.current.update(cmds.current(v));
    g.current.commit();
    g.current = null;
  }, [board, label, key]);
  const onCancel = useCallback(() => { g.current?.abort(); g.current = null; }, []);
  return { onPreview, onCommit, onCancel };
}

