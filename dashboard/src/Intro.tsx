// Title card, one continuous motion: two blue sparkles draw two parallel lanes downward (two
// agents working side by side), the lanes hook inward and meet in the middle (InSync catching
// the conflict live), then the same two curves swing down into one straight line, turning
// blue, with the sparkles riding them out to the ends. The name rises out of that line.
//
// Everything is computed from one clock (a Motion value), so the sparkles always sit exactly
// on the curves and nothing jumps. Built with Motion (motion/react, MIT, free).
// Plays once per browser session; ?intro=1 forces it, ?intro=0 turns it off, ?intro=hold
// keeps the title card up until clicked (for screen recordings), and clicking the header
// logo replays it. Any click or key skips it.
import { useEffect, useState } from 'react';
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
const T = { draw: 1.35, meet: 1.35, morphFrom: 1.5, morphTo: 2.45, title: 2.15, end: 4.6 };

// ---- geometry (viewBox 600 x 400; the meeting point is the stage center, 300,200) ----
type P = [number, number];
type Cubic = [P, P, P, P];
const LANE: Cubic = [[268, 40], [268, 168], [270, 200], [300, 200]]; // straight down, hooks in
const RULE: Cubic = [[132, 200], [188, 200], [244, 200], [300, 200]]; // left half of the line
const mirror = (c: Cubic): Cubic => c.map(([x, y]) => [600 - x, y]) as Cubic;

const lerp = (a: number, b: number, m: number) => a + (b - a) * m;
const lerpP = (a: P, b: P, m: number): P => [lerp(a[0], b[0], m), lerp(a[1], b[1], m)];
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

/** The stroke's shape at time t: drawn out along the lane, then morphing into the line. */
function curveAt(t: number, lane: Cubic, rule: Cubic): Cubic {
  const m = inOut(phase(t, T.morphFrom, T.morphTo));
  if (m > 0) return lane.map((p, i) => lerpP(p, rule[i], m)) as Cubic;
  return head(lane, Math.max(0.0001, inOut(phase(t, 0, T.draw))));
}

/** Where the sparkle is at time t: the drawing tip, then riding back out to the line's end. */
function sparkAt(t: number, lane: Cubic, rule: Cubic): P {
  if (t < T.morphFrom) return at(lane, inOut(phase(t, 0, T.draw)));
  const m = inOut(phase(t, T.morphFrom, T.morphTo));
  const c = lane.map((p, i) => lerpP(p, rule[i], m)) as Cubic;
  return at(c, 1 - m);
}

/** Sparkle size over time: steady, a flare where they meet, a flare at the ends, then gone. */
function sparkScale(t: number): number {
  const bump = (c: number, w: number, h: number) => h * Math.max(0, 1 - Math.abs(t - c) / w);
  if (t > T.morphTo + 0.15) return Math.max(0, 1.6 * (1 - phase(t, T.morphTo + 0.15, T.morphTo + 0.75)));
  return 1 + bump(T.meet, 0.18, 0.7) + bump(T.morphTo + 0.1, 0.2, 0.6);
}

const WHITE = '#f0f6fc'; // --text
const BLUE = '#4493f8'; // --accent
const SPARKLE = 'M0 -10 C1.2 -2.4 2.4 -1.2 10 0 C2.4 1.2 1.2 2.4 0 10 C-1.2 2.4 -2.4 1.2 -10 0 C-2.4 -1.2 -1.2 -2.4 0 -10Z';
// Background code-map dots drifting slowly for depth.
const DUST = Array.from({ length: 46 }, (_, i) => ({ x: (i * 137) % 600, y: 420 - ((i * 211) % 520), r: 1 + (i % 3) * 0.6 }));

function Stroke({ t, lane, rule }: { t: MotionValue<number>; lane: Cubic; rule: Cubic }) {
  const d = useTransform(t, (v) => toD(curveAt(v, lane, rule)));
  const stroke = useTransform(t, [T.morphFrom, T.morphTo], [WHITE, BLUE]);
  return <motion.path d={d} style={{ stroke }} strokeWidth={3} strokeLinecap="round" fill="none" />;
}

function Spark({ t, lane, rule, lag = 0 }: { t: MotionValue<number>; lane: Cubic; rule: Cubic; lag?: number }) {
  const x = useTransform(t, (v) => sparkAt(Math.max(0, v - lag), lane, rule)[0]);
  const y = useTransform(t, (v) => sparkAt(Math.max(0, v - lag), lane, rule)[1]);
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

export function Intro({ onDone }: { onDone: () => void }) {
  const t = useMotionValue(0);
  const [met, setMet] = useState(false);
  const [titled, setTitled] = useState(false);
  const camera = useTransform(t, [0, T.draw], [70, 0], { ease: outCubic });
  const dust = useTransform(t, [0, T.end], [40, -20]);

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

  const lanes = [[LANE, RULE], [mirror(LANE), mirror(RULE)]] as const;

  return (
    <motion.div className="intro" role="dialog" aria-label={`${APP_NAME} intro`} onClick={onDone}
      initial={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.04, filter: 'blur(6px)' }} transition={{ duration: 0.55, ease: 'easeOut' }}>
      <div className="intro-stage">
        <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <motion.g style={{ y: dust, opacity: 0.35 }}>
            {DUST.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="var(--text2)" />)}
          </motion.g>
          <motion.g style={{ y: camera }}>
            {met && (
              <motion.circle cx={300} cy={200} fill="none" stroke={BLUE} strokeWidth={2}
                initial={{ r: 4, opacity: 0.8 }} animate={{ r: 80, opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
            )}
            {lanes.map(([lane, rule], i) => <Stroke key={i} t={t} lane={lane} rule={rule} />)}
            {lanes.map(([lane, rule], i) => [0.09, 0.06, 0.03, 0].map((lag) => (
              <Spark key={`${i}-${lag}`} t={t} lane={lane} rule={rule} lag={lag} />
            )))}
          </motion.g>
        </svg>

        <div className="intro-title" aria-label={APP_NAME}>
          {APP_NAME.split('').map((ch, i) => (
            <motion.span key={i} aria-hidden="true" initial={{ y: '115%' }} animate={{ y: titled ? '0%' : '115%' }}
              transition={{ type: 'spring', stiffness: 240, damping: 22, delay: titled ? i * 0.045 : 0 }}>
              {ch}
            </motion.span>
          ))}
        </div>

        <motion.p className="intro-tag" initial={{ opacity: 0, y: -8 }} animate={titled ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.6, delay: titled ? 0.5 : 0, ease: 'easeOut' }}>
          {TAGLINE}
        </motion.p>
      </div>
      <button className="intro-skip" onClick={(e) => { e.stopPropagation(); onDone(); }}>Skip</button>
    </motion.div>
  );
}

/** The static mark: two lanes bowing toward each other, held by a rung. */
export function LanesMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--surface)" stroke="var(--border)" />
      <g fill="none" stroke="var(--text)" strokeWidth="2.4" strokeLinecap="round">
        <path d="M11 6 Q15.5 16 11 26" />
        <path d="M21 6 Q16.5 16 21 26" />
      </g>
      <line x1="13.3" y1="16" x2="18.7" y2="16" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
