// Title card, one continuous motion: two blue sparkles draw two parallel lanes downward (two
// agents working side by side). The lanes hook in and meet in the middle (InSync catching the
// conflict live), then the same two curves bend into the two halves of one Bezier S, turning
// blue, with the sparkles riding out to its ends. The S then settles into the word as the S of
// "InSync" while the other letters rise in around it.
//
// Everything is computed from one clock (a Motion value), so the sparkles always sit exactly
// on the curves and nothing jumps. Built with Motion (motion/react, MIT, free).
// Plays once per browser session; ?intro=1 forces it, ?intro=0 turns it off, ?intro=hold
// keeps the title card up until clicked (for screen recordings), and clicking the header
// logo replays it. Any click or key skips it.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from 'motion/react';

export const APP_NAME = 'InSync';
export const TAGLINE = 'Live coordination for AI coding agents';

const SEEN_KEY = 'insync.intro.seen';

let decided: boolean | undefined;
/** Whether the intro should play on page load (decided once: StrictMode calls initializers twice). */
export function shouldPlayIntro(): boolean {
  return (decided ??= decide());
}

function decide(): boolean {
  const q = new URLSearchParams(location.search).get('intro');
  if (q === '1' || q === 'hold') return true;
  if (q === '0') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    if (sessionStorage.getItem(SEEN_KEY)) return false;
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch { /* storage blocked: just play it */ }
  return true;
}

// ---- timeline (seconds) ----
const T = { draw: 1.25, meet: 1.25, morphFrom: 1.35, morphTo: 2.2, settleFrom: 2.35, settleTo: 3.05, title: 2.6, end: 5 };

// ---- geometry (viewBox 600 x 400; the meeting point is the stage center, 300,200) ----
type P = [number, number];
type Cubic = [P, P, P, P];
const C: P = [300, 200];
const LANE: Cubic = [[268, 40], [268, 168], [270, 200], [300, 200]]; // straight down, hooks in
const mirror = (c: Cubic): Cubic => c.map(([x, y]) => [600 - x, y]) as Cubic;

// The S: two cubic halves that both end at the center, point-symmetric around it, widened to
// match Unbounded's wide S. Its ink box is about S_W x S_H around the center.
const WIDEN = 1.35;
const widen = (c: Cubic): Cubic => c.map(([x, y]) => [300 + (x - 300) * WIDEN, y]) as Cubic;
const S_TOP: Cubic = widen([[338, 146], [320, 118], [220, 150], [300, 200]]);
const S_BOTTOM: Cubic = S_TOP.map(([x, y]) => [600 - x, 400 - y]) as Cubic;
const S_H = 130;

const lerp = (a: number, b: number, m: number) => a + (b - a) * m;
const lerpP = (a: P, b: P, m: number): P => [lerp(a[0], b[0], m), lerp(a[1], b[1], m)];
const lerpC = (a: Cubic, b: Cubic, m: number) => a.map((p, i) => lerpP(p, b[i], m)) as Cubic;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const inOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
const outCubic = (v: number) => 1 - Math.pow(1 - v, 3);
const phase = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** de Casteljau: the part of c from 0 to s, as its own cubic (its end is exactly the point at s). */
function head(c: Cubic, s: number): Cubic {
  const [a, b, d, e] = c;
  const ab = lerpP(a, b, s), bd = lerpP(b, d, s), de = lerpP(d, e, s);
  const abd = lerpP(ab, bd, s), bde = lerpP(bd, de, s);
  return [a, ab, abd, lerpP(abd, bde, s)];
}
const at = (c: Cubic, s: number): P => head(c, s)[3];
const toD = (c: Cubic) => `M${c[0].join(' ')} C${c[1].join(' ')} ${c[2].join(' ')} ${c[3].join(' ')}`;

/** Where the S ends up: the letter slot in the word, in viewBox units (measured after fonts load). */
interface Slot { cx: number; cy: number; scale: number; stroke: number }
const NO_SLOT: Slot = { cx: 300, cy: 160, scale: 0.55, stroke: 9 };

/** Moves a curve from its place around the center into the word's S slot, by k (0..1). */
function settle(c: Cubic, k: number, slot: Slot): Cubic {
  if (k <= 0) return c;
  return c.map(([x, y]) => [
    lerp(x, slot.cx + (x - C[0]) * slot.scale, k),
    lerp(y, slot.cy + (y - C[1]) * slot.scale, k),
  ]) as Cubic;
}

/** The stroke's shape at time t: drawn along the lane, bent into its half of the S, then settled. */
function curveAt(t: number, lane: Cubic, half: Cubic, slot: Slot): Cubic {
  const m = inOut(phase(t, T.morphFrom, T.morphTo));
  const base = m > 0 ? lerpC(lane, half, m) : head(lane, Math.max(0.0001, inOut(phase(t, 0, T.draw))));
  return settle(base, inOut(phase(t, T.settleFrom, T.settleTo)), slot);
}

/** Where the sparkle is at time t: the drawing tip, then riding out to its end of the S. */
function sparkAt(t: number, lane: Cubic, half: Cubic): P {
  if (t < T.morphFrom) return at(lane, inOut(phase(t, 0, T.draw)));
  const m = inOut(phase(t, T.morphFrom, T.morphTo));
  return at(lerpC(lane, half, m), 1 - m);
}

/** Sparkle size over time: steady, a flare where they meet, a flare at the S's ends, then gone. */
function sparkScale(t: number): number {
  const bump = (c: number, w: number, h: number) => h * Math.max(0, 1 - Math.abs(t - c) / w);
  if (t > T.morphTo + 0.1) return Math.max(0, 1.6 * (1 - phase(t, T.morphTo + 0.1, T.morphTo + 0.5)));
  return 1 + bump(T.meet, 0.18, 0.7) + bump(T.morphTo + 0.05, 0.2, 0.6);
}

const WHITE = '#f0f6fc'; // --text
const BLUE = '#4493f8'; // --accent
const SPARKLE = 'M0 -10 C1.2 -2.4 2.4 -1.2 10 0 C2.4 1.2 1.2 2.4 0 10 C-1.2 2.4 -2.4 1.2 -10 0 C-2.4 -1.2 -1.2 -2.4 0 -10Z';
// Background code-map dots drifting slowly for depth.
const DUST = Array.from({ length: 46 }, (_, i) => ({ x: (i * 137) % 600, y: 420 - ((i * 211) % 520), r: 1 + (i % 3) * 0.6 }));

function Stroke({ t, lane, half, slot }: { t: MotionValue<number>; lane: Cubic; half: Cubic; slot: RefObject<Slot> }) {
  const d = useTransform(t, (v) => toD(curveAt(v, lane, half, slot.current)));
  const stroke = useTransform(t, [T.morphFrom, T.morphTo], [WHITE, BLUE]);
  const width = useTransform(t, (v) => lerp(3, slot.current.stroke, inOut(phase(v, T.settleFrom, T.settleTo))));
  return <motion.path d={d} style={{ stroke, strokeWidth: width }} strokeLinecap="round" fill="none" />;
}

function Spark({ t, lane, half, lag = 0 }: { t: MotionValue<number>; lane: Cubic; half: Cubic; lag?: number }) {
  const x = useTransform(t, (v) => sparkAt(Math.max(0, v - lag), lane, half)[0]);
  const y = useTransform(t, (v) => sparkAt(Math.max(0, v - lag), lane, half)[1]);
  const scale = useTransform(t, (v) => sparkScale(Math.max(0, v - lag)) * (lag ? 1 - lag * 6 : 1));
  return (
    <motion.g style={{ x, y, opacity: lag ? 0.5 - lag * 4 : 1 }}>
      <motion.g style={{ scale }}>
        <path className="intro-spark" d={SPARKLE} fill={BLUE} />
        {!lag && <circle r={2.2} fill="#fff" />}
      </motion.g>
    </motion.g>
  );
}

/**
 * Measures the empty S slot in the word (sized from the font's real S) and converts it to
 * viewBox units, so the drawn S lands exactly where the letter belongs.
 */
function useSlot(stage: RefObject<HTMLDivElement | null>, hole: RefObject<HTMLSpanElement | null>, font: RefObject<HTMLDivElement | null>) {
  const slot = useRef<Slot>(NO_SLOT);
  const [size, setSize] = useState<{ w: number; h: number; asc: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const measure = async () => {
      const el = font.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      await document.fonts.load(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`).catch(() => {});
      if (!alive) return;
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const s = ctx.measureText('S');
      const i = ctx.measureText('I');
      setSize({ w: s.width, h: s.actualBoundingBoxAscent + s.actualBoundingBoxDescent, asc: s.actualBoundingBoxAscent });
      // stroke = the font's stem width (the ink width of an I)
      const stem = i.actualBoundingBoxLeft + i.actualBoundingBoxRight;
      requestAnimationFrame(() => {
        const st = stage.current?.getBoundingClientRect();
        const h = hole.current?.getBoundingClientRect();
        if (!st || !h || !st.width) return;
        const u = 600 / st.width; // px -> viewBox units
        const inkH = s.actualBoundingBoxAscent + s.actualBoundingBoxDescent;
        const inkTop = h.bottom - s.actualBoundingBoxAscent; // the hole's bottom is the baseline
        slot.current = {
          cx: (h.left + h.width / 2 - st.left) * u,
          cy: (inkTop + inkH / 2 - st.top) * u,
          // the stroke is centered on the path, so shrink the path by one stem to keep the ink box
          scale: ((inkH - stem) * u) / (S_H),
          stroke: stem * u,
        };
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => { alive = false; window.removeEventListener('resize', measure); };
  }, [stage, hole, font]);

  return { slot, size };
}

export function Intro({ onDone }: { onDone: () => void }) {
  const t = useMotionValue(0);
  const [met, setMet] = useState(false);
  const [titled, setTitled] = useState(false);
  const camera = useTransform(t, [0, T.draw], [70, 0], { ease: outCubic });
  const dust = useTransform(t, [0, T.end], [40, -20]);
  const stage = useRef<HTMLDivElement>(null);
  const hole = useRef<HTMLSpanElement>(null);
  const word = useRef<HTMLDivElement>(null);
  const { slot, size } = useSlot(stage, hole, word);

  useMotionValueEvent(t, 'change', (v) => {
    if (v >= T.meet && !met) setMet(true);
    if (v >= T.title && !titled) setTitled(true);
  });

  useEffect(() => {
    const hold = new URLSearchParams(location.search).get('intro') === 'hold';
    const run = animate(t, T.end, { duration: T.end, ease: 'linear', onComplete: hold ? undefined : onDone });
    const skip = () => onDone();
    window.addEventListener('keydown', skip);
    return () => { run.stop(); window.removeEventListener('keydown', skip); };
  }, [t, onDone]);

  // Left lane becomes the S's lower half, right lane its upper half, so they never cross.
  const parts = [[LANE, S_BOTTOM], [mirror(LANE), S_TOP]] as const;
  const [before, after] = APP_NAME.split(/S(.*)/s);
  const letter = (ch: string, i: number) => (
    <motion.span key={i} aria-hidden="true" initial={{ y: '115%' }} animate={{ y: titled ? '0%' : '115%' }}
      transition={{ type: 'spring', stiffness: 240, damping: 22, delay: titled ? Math.abs(i - before.length) * 0.05 : 0 }}>
      {ch}
    </motion.span>
  );

  return (
    <motion.div className="intro" role="dialog" aria-label={`${APP_NAME} intro`} onClick={onDone}
      initial={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.04, filter: 'blur(6px)' }} transition={{ duration: 0.55, ease: 'easeOut' }}>
      <div className="intro-stage" ref={stage}>
        <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <motion.g style={{ y: dust, opacity: 0.35 }}>
            {DUST.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="var(--text2)" />)}
          </motion.g>
          <motion.g style={{ y: camera }}>
            {met && (
              <motion.circle cx={300} cy={200} fill="none" stroke={BLUE} strokeWidth={2}
                initial={{ r: 4, opacity: 0.8 }} animate={{ r: 80, opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
            )}
            {parts.map(([lane, half], i) => <Stroke key={i} t={t} lane={lane} half={half} slot={slot} />)}
            {parts.map(([lane, half], i) => [0.09, 0.06, 0.03, 0].map((lag) => (
              <Spark key={`${i}-${lag}`} t={t} lane={lane} half={half} lag={lag} />
            )))}
          </motion.g>
        </svg>

        <div className="intro-title" aria-label={APP_NAME} ref={word}>
          {before.split('').map((ch, i) => letter(ch, i))}
          <span ref={hole} className="intro-hole" style={size ? { width: size.w, height: size.asc } : undefined} />
          {after.split('').map((ch, i) => letter(ch, before.length + 1 + i))}
        </div>

        <motion.p className="intro-tag" initial={{ opacity: 0, y: -8 }} animate={titled ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.6, delay: titled ? 0.6 : 0, ease: 'easeOut' }}>
          {TAGLINE}
        </motion.p>
      </div>
      <button className="intro-skip" onClick={(e) => { e.stopPropagation(); onDone(); }}>Skip</button>
    </motion.div>
  );
}

/** The mark: one Bezier S made of two halves (two agents' paths) joined in the middle. */
export function SMark({ size = 30 }: { size?: number }) {
  // the intro's S, scaled into a 32 x 32 tile
  const k = 0.17;
  const fit = (c: Cubic): Cubic => c.map(([x, y]) => [16 + (x - 300) * k, 16 + (y - 200) * k]) as Cubic;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--surface)" stroke="var(--border)" />
      <g fill="none" strokeWidth="3" strokeLinecap="round">
        <path d={toD(fit(S_TOP))} stroke="var(--text)" />
        <path d={toD(fit(S_BOTTOM))} stroke="var(--accent)" />
      </g>
    </svg>
  );
}
