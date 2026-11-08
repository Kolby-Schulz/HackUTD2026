// PNG export (SHARE-4): draws shapes from the model with Canvas2D, not by screenshotting the DOM.
// Pure parts (bounds, draw ordering) take an injectable context; the real canvas is only made in exportPng.
// Mapping follows render/style.ts: frames clip, inside/center/outside strokes, drop shadows, text box rules.
import { multiply, union } from './geom';
import { ancestors, worldBounds, worldMatrix } from './tree';
import type { TreeView } from './tree';
import type { Rect, Shape, ShapeId } from './types';

/** The slice of CanvasRenderingContext2D the renderer uses; a recording stub can implement it. */
export interface ExportCtx {
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; globalAlpha: number;
  font: string; textAlign: string; textBaseline: string;
  shadowColor: string; shadowBlur: number; shadowOffsetX: number; shadowOffsetY: number;
  letterSpacing?: string;
  save(): void; restore(): void;
  translate(x: number, y: number): void; rotate(rad: number): void; scale(x: number, y: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void; closePath(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  fill(rule?: 'nonzero' | 'evenodd'): void; stroke(): void; clip(rule?: 'nonzero' | 'evenodd'): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export interface RenderOpts {
  scale: number;
  /** Fill colour behind everything; transparent when omitted. */
  background?: string;
  /** World rectangle to render; defaults to boundsOf(ids). */
  bounds?: Rect;
}

const live = (view: TreeView, id: ShapeId): Shape | undefined => {
  const s = view.shapes.get(id);
  return s && !s.deleted ? s : undefined;
};

/** Selected ids minus any whose ancestor is also selected (those draw with their ancestor). */
export function exportRoots(view: TreeView, ids: readonly ShapeId[]): ShapeId[] {
  const set = new Set(ids);
  return ids.filter((id) => live(view, id) && !ancestors(view, id).some((a) => set.has(a)));
}

/** Union of the selection's world bounds (rotation included); hidden/deleted shapes are ignored. Null when empty. */
export function boundsOf(view: TreeView, ids: readonly ShapeId[]): Rect | null {
  const rects: Rect[] = [];
  for (const id of exportRoots(view, ids)) {
    const s = live(view, id);
    if (!s || s.hidden) continue;
    const r = worldBounds(view, id);
    if (r) rects.push(r);
  }
  return union(rects);
}

// ---- paths ----
function radii(s: Shape): [number, number, number, number] {
  const max = Math.min(s.w, s.h) / 2;
  const r = s.radius ?? 0;
  const arr = Array.isArray(r) ? r : [r, r, r, r];
  return arr.map((v) => Math.max(0, Math.min(v, max))) as [number, number, number, number];
}

/** Adds the shape's outline (0,0,w,h in its own space) to the current path. */
function outline(ctx: ExportCtx, s: Shape): void {
  const { w, h } = s;
  if (s.kind === 'ellipse') { ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return; }
  const [tl, tr, br, bl] = radii(s);
  if (!tl && !tr && !br && !bl) { ctx.rect(0, 0, w, h); return; }
  ctx.moveTo(tl, 0);
  ctx.lineTo(w - tr, 0); ctx.arcTo(w, 0, w, tr, tr);
  ctx.lineTo(w, h - br); ctx.arcTo(w, h, w - br, h, br);
  ctx.lineTo(bl, h); ctx.arcTo(0, h, 0, h - bl, bl);
  ctx.lineTo(0, tl); ctx.arcTo(0, 0, tl, 0, tl);
  ctx.closePath();
}

const path = (ctx: ExportCtx, s: Shape) => { ctx.beginPath(); outline(ctx, s); };

// ---- paint ----
function paintShape(ctx: ExportCtx, s: Shape, scale: number, alpha: number): void {
  const fills = (s.fills ?? []).filter((f) => !f.hidden && f.type === 'solid');
  const strokes = (s.strokes ?? []).filter((k) => !k.hidden && k.width > 0);
  const drops = (s.effects ?? []).filter((e) => !e.hidden && e.type === 'drop');
  const clearShadow = () => { ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

  // Drop shadows: one filled pass per effect, only when the shape has a fill (shadow of the fill).
  if (fills.length) {
    for (const e of drops) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = e.color; ctx.shadowBlur = e.blur * scale;
      ctx.shadowOffsetX = e.x * scale; ctx.shadowOffsetY = e.y * scale;
      ctx.fillStyle = '#000';
      path(ctx, s); ctx.fill();
      ctx.restore();
    }
  }
  for (const f of fills) {            // bottom first (array order = Figma order)
    ctx.save();
    ctx.globalAlpha = alpha * (f.opacity ?? 1);
    ctx.fillStyle = f.color;
    path(ctx, s); ctx.fill();
    ctx.restore();
  }
  for (const k of strokes) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = k.color;
    const align = k.align ?? 'inside';
    if (align === 'center') {
      ctx.lineWidth = k.width;
    } else {
      ctx.lineWidth = k.width * 2;    // half is clipped away
      ctx.beginPath();
      if (align === 'outside') { const big = 1e5; ctx.rect(-big, -big, big * 2, big * 2); }
      outline(ctx, s);
      ctx.clip(align === 'outside' ? 'evenodd' : 'nonzero');
    }
    path(ctx, s); ctx.stroke();
    ctx.restore();
  }
  clearShadow();
}

// ---- text ----
const FALLBACK_FONT = 'system-ui, sans-serif';

function wrap(ctx: ExportCtx, text: string, maxW: number | null): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (maxW === null) { out.push(para); continue; }
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(next).width > maxW) { out.push(line); line = w; } else line = next;
    }
    out.push(line);
  }
  return out;
}

function paintText(ctx: ExportCtx, s: Shape, alpha: number): void {
  const size = s.fontSize ?? 16;
  const lh = s.lineHeight === undefined || s.lineHeight === 'auto' ? size * 1.2 : s.lineHeight;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${s.fontWeight ?? 400} ${size}px ${s.fontFamily ?? FALLBACK_FONT}`;
  if (s.letterSpacing) ctx.letterSpacing = `${s.letterSpacing}px`;
  ctx.fillStyle = s.color ?? '#1c1917';
  ctx.textBaseline = 'middle';
  const align = s.textAlign === 'center' || s.textAlign === 'right' ? s.textAlign : 'left';
  ctx.textAlign = align;
  const lines = wrap(ctx, s.text ?? '', s.textMode === 'auto-w' ? null : s.w);
  const total = lines.length * lh;
  const top = s.textVAlign === 'middle' ? (s.h - total) / 2 : s.textVAlign === 'bottom' ? s.h - total : 0;
  const x = align === 'center' ? s.w / 2 : align === 'right' ? s.w : 0;
  lines.forEach((line, i) => { if (line) ctx.fillText(line, x, top + i * lh + lh / 2); });
  ctx.restore();
}

// ---- tree walk ----
function drawShape(ctx: ExportCtx, view: TreeView, id: ShapeId, scale: number, parentAlpha: number): void {
  const s = live(view, id);
  if (!s || s.hidden) return;
  const alpha = parentAlpha * (s.opacity ?? 1);
  ctx.save();
  ctx.translate(s.x, s.y);
  if (s.rotation || s.flipX || s.flipY) {
    ctx.translate(s.w / 2, s.h / 2);
    if (s.rotation) ctx.rotate((s.rotation * Math.PI) / 180);
    if (s.flipX || s.flipY) ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
    ctx.translate(-s.w / 2, -s.h / 2);
  }
  if (s.kind === 'text') {
    paintShape(ctx, s, scale, alpha);
    paintText(ctx, s, alpha);
  } else if (s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'frame') {
    paintShape(ctx, s, scale, alpha);
  }
  const kids = view.children.get(id) ?? [];
  if (kids.length) {
    if (s.kind === 'frame' && s.clip !== false) { path(ctx, s); ctx.clip(); }
    for (const c of kids) drawShape(ctx, view, c, scale, alpha);
  }
  ctx.restore();
}

/** Draws the selection (roots in z-order) into ctx. Output pixel (0,0) is the top-left of `bounds`. */
export function renderToCanvas(ctx: ExportCtx, view: TreeView, ids: readonly ShapeId[], opts: RenderOpts): void {
  const bounds = opts.bounds ?? boundsOf(view, ids);
  if (!bounds) return;
  const { scale } = opts;
  if (opts.background) {
    ctx.save();
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, Math.ceil(bounds.w * scale), Math.ceil(bounds.h * scale));
    ctx.restore();
  }
  // Z-order: global paint order, not selection order. Roots that are descendants of each other are collapsed.
  const roots = new Set(exportRoots(view, ids));
  for (const id of flattenAll(view)) {
    if (!roots.has(id)) continue;
    const s = live(view, id)!;
    ctx.save();
    const m = worldMatrix(view, s.parent !== null && view.shapes.has(s.parent) ? s.parent : null);
    const t = multiply([scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale], m);
    ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
    drawShape(ctx, view, id, scale, ancestorAlpha(view, id));
    ctx.restore();
  }
}

function flattenAll(view: TreeView): ShapeId[] {
  const out: ShapeId[] = [];
  const walk = (p: ShapeId | null) => { for (const c of view.children.get(p) ?? []) { out.push(c); walk(c); } };
  walk(null);
  return out;
}

function ancestorAlpha(view: TreeView, id: ShapeId): number {
  let a = 1;
  for (const p of ancestors(view, id)) a *= view.shapes.get(p)!.opacity ?? 1;
  return a;
}

// ---- real canvas (browser only) ----
export interface ExportOpts {
  scale: 1 | 2 | 3;
  background?: string;
  /** Test seam: builds the canvas. Default uses document.createElement('canvas'). */
  createCanvas?: (w: number, h: number) => { getContext(type: '2d'): ExportCtx | null; toBlob(cb: (b: Blob | null) => void, type: string): void };
}

/** Renders the selection (or `ids` = all roots for a whole-board export) to a PNG. `scale` alone decides pixel size. */
export async function exportPng(board: { getState(): TreeView }, ids: readonly ShapeId[], opts: ExportOpts): Promise<Blob> {
  const view = board.getState();
  const bounds = boundsOf(view, ids);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) throw new Error('Nothing to export');
  const w = Math.max(1, Math.ceil(bounds.w * opts.scale));
  const h = Math.max(1, Math.ceil(bounds.h * opts.scale));
  if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready;
  const canvas = opts.createCanvas
    ? opts.createCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  renderToCanvas(ctx, view, ids, { scale: opts.scale, background: opts.background, bounds });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

/** Saves a blob through a temporary link click. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
