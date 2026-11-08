// Text measurement (TEXT-12). World units at zoom 1: never reads the camera, never scales font-size.
// Single lines use canvas measureText; wrapping uses a hidden DOM probe styled like render/style.ts textStyle.
// DOM access is lazy (first call) and injectable (setMeasureEnv) so tests run in Node with a fake.
import type { Shape } from '../core/types';

export type TextMode = 'auto-w' | 'auto-h' | 'fixed';
export type TextStyle = Pick<Shape, 'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'textAlign'>;
export type Measured = { w: number; h: number; lines: string[] };

/** Fully resolved style (same defaults as style.ts textStyle). */
export type ResolvedStyle = { family: string; size: number; weight: number; lh: number; ls: number; align: string };

export interface MeasureEnv {
  /** Width of one line in px, letter spacing included. */
  lineWidth(line: string, s: ResolvedStyle): number;
  /** Wrap `text` at `width` px; returns the visual lines. */
  wrap(text: string, s: ResolvedStyle, width: number): string[];
}

export function resolveStyle(s: TextStyle): ResolvedStyle {
  const size = s.fontSize ?? 16;
  return {
    family: s.fontFamily ?? 'sans-serif', size, weight: s.fontWeight ?? 400,
    lh: s.lineHeight === undefined || s.lineHeight === 'auto' ? size * 1.2 : s.lineHeight,
    ls: s.letterSpacing ?? 0, align: s.textAlign ?? 'left',
  };
}

/** Browser implementation, created on first use. */
export function browserEnv(doc: Document = document): MeasureEnv {
  let ctx: CanvasRenderingContext2D | null = null;
  let probe: HTMLElement | null = null;
  const getCtx = () => (ctx ??= doc.createElement('canvas').getContext('2d')!);
  const getProbe = () => {
    if (probe) return probe;
    probe = doc.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:0;border:0;contain:layout style;';
    doc.body.appendChild(probe);
    return probe;
  };
  return {
    lineWidth(line, s) {
      const c = getCtx();
      c.font = `${s.weight} ${s.size}px ${s.family}`;
      return c.measureText(line).width + s.ls * Array.from(line).length;
    },
    wrap(text, s, width) {
      const p = getProbe();
      p.style.fontFamily = s.family; p.style.fontSize = `${s.size}px`; p.style.fontWeight = String(s.weight);
      p.style.lineHeight = `${s.lh}px`; p.style.letterSpacing = s.ls ? `${s.ls}px` : 'normal';
      p.style.textAlign = s.align; p.style.width = `${width}px`;
      p.textContent = text;
      const node = p.firstChild;
      if (!node) return [''];
      // Walk code points with a Range; a change in the rect's top starts a new visual line.
      const chars = Array.from(text);
      const range = doc.createRange();
      const lines: string[] = [];
      let cur = '', top = NaN, idx = 0;
      for (const ch of chars) {
        range.setStart(node, idx); range.setEnd(node, idx + ch.length); idx += ch.length;
        const r = range.getClientRects()[0];
        if (ch === '\n') { lines.push(cur); cur = ''; top = NaN; continue; }
        if (r && !Number.isNaN(top) && r.top - top > s.lh / 2) { lines.push(cur); cur = ''; }
        if (r && (Number.isNaN(top) || r.top - top > s.lh / 2)) top = r.top;
        cur += ch;
      }
      lines.push(cur);
      return lines;
    },
  };
}

let env: MeasureEnv | null = null;
const cache = new Map<string, Measured>();
const MAX_CACHE = 5000;

/** Inject a fake (tests) or null to go back to the lazy browser env. Clears the cache. */
export function setMeasureEnv(e: MeasureEnv | null) { env = e; cache.clear(); }
/** Drop cached results, e.g. after document.fonts finishes loading (fonts loading late). */
export function clearMeasureCache() { cache.clear(); }

// Font fallback (TEXT-25): text measured before its font loads uses the fallback face. When document.fonts settles
// the cache is dropped and subscribers (renderers, autosize) re-measure. Hooked lazily; a no-op in Node tests.
const fontListeners = new Set<() => void>();
let fontsHooked = false;
/** Called after web fonts finish loading and the measure cache was cleared. Returns an unsubscribe. */
export function onFontsLoaded(cb: () => void): () => void { fontListeners.add(cb); hookFonts(); return () => { fontListeners.delete(cb); }; }
function fontsChanged() { cache.clear(); fontListeners.forEach((cb) => cb()); }
function hookFonts() {
  if (fontsHooked || typeof document === 'undefined' || !document.fonts) return;
  fontsHooked = true;
  void document.fonts.ready.then(fontsChanged);
  document.fonts.addEventListener?.('loadingdone', fontsChanged);
}
function getEnv(): MeasureEnv { hookFonts(); return (env ??= browserEnv()); }

/**
 * Measure text in world units. `width` is the box width (needed for auto-h and fixed; ignored by auto-w).
 * auto-w: no wrapping, only explicit newlines; w = widest line. auto-h/fixed: wrap at `width`, w = width.
 * h is always the content height (lines * line height); a fixed box keeps its own h.
 */
export function measureText(text: string, style: TextStyle, mode: TextMode = 'auto-w', width?: number): Measured {
  const s = resolveStyle(style);
  const wrapW = mode === 'auto-w' ? undefined : Math.max(1, width ?? 1);
  const key = `${mode}|${wrapW ?? ''}|${s.family}|${s.size}|${s.weight}|${s.lh}|${s.ls}|${s.align}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const e = getEnv();
  let out: Measured;
  if (wrapW === undefined) {
    const lines = text.split('\n');
    out = { w: Math.max(...lines.map((l) => e.lineWidth(l, s))), h: lines.length * s.lh, lines };
  } else {
    const lines = e.wrap(text, s, wrapW);
    out = { w: wrapW, h: lines.length * s.lh, lines };
  }
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, out);
  return out;
}

/** The size to write back for a text shape, or null if the mode keeps the stored size. Ceil avoids sub-pixel clipping. */
export function fitSize(shape: Pick<Shape, 'text' | 'textMode' | 'w' | 'h'> & TextStyle): { w: number; h: number } | null {
  const mode = shape.textMode ?? 'auto-h';
  if (mode === 'fixed') return null;
  const m = measureText(shape.text ?? '', shape, mode, shape.w);
  return { w: mode === 'auto-w' ? Math.ceil(m.w) : shape.w, h: Math.ceil(m.h) };
}

/**
 * Fixed-box overflow (TEXT-21): true when the content is taller than the box. Auto modes never overflow.
 * The renderer clips the box (overflow:hidden) and shows a bracket at the bottom right while selected.
 */
export function isOverflowing(shape: Pick<Shape, 'text' | 'textMode' | 'w' | 'h'> & TextStyle): boolean {
  if ((shape.textMode ?? 'auto-h') !== 'fixed') return false;
  return measureText(shape.text ?? '', shape, 'fixed', shape.w).h > shape.h + 0.5;
}

/** Index in `text` closest to a point inside the text box (box-local px at zoom 1), for placing the caret on click. */
export function caretIndexAt(text: string, style: TextStyle, mode: TextMode, width: number, x: number, y: number): number {
  const s = resolveStyle(style);
  const m = measureText(text, style, mode, width);
  const line = Math.max(0, Math.min(m.lines.length - 1, Math.floor(y / s.lh)));
  let base = 0;
  for (let i = 0; i < line; i++) base += m.lines[i].length + (text[base + m.lines[i].length] === '\n' ? 1 : 0);
  const chars = Array.from(m.lines[line]);
  const e = getEnv();
  const total = e.lineWidth(m.lines[line], s);
  const off = s.align === 'center' ? (width - total) / 2 : s.align === 'right' ? width - total : 0;
  let idx = 0, prev = 0;
  for (let k = 1; k <= chars.length; k++) {
    const w = e.lineWidth(chars.slice(0, k).join(''), s);
    if (x - off < (prev + w) / 2) break;
    prev = w; idx += chars[k - 1].length;
  }
  return base + idx;
}
