// Remote cursor smoothing (MULTI-2). Pure: feed arrival-timestamped samples, ask for a position.
// Renders `delayMs` in the past with linear interpolation; when samples run late it glides with a
// critically damped follower (~60 ms) after at most 150 ms of extrapolation; sparse feeds (agents that
// only publish when they act) are glided to; a jump over 2000 world units snaps with a short fade.

/** Single flag: draw the local human's pointer as an outline arrow too. Flip to false when WP-20 uses native tool cursors. */
export const DRAW_LOCAL_CURSOR = true;

export const DELAY_MS = 100;
export const TAU_MS = 60;
export const MAX_EXTRAPOLATE_MS = 150;
export const SPARSE_GAP_MS = 250;
export const TELEPORT = 2000;
export const FADE_MS = 150;

interface Sample { x: number; y: number; t: number }
export interface Smoothed { x: number; y: number; fade: number; movedAt: number }

export interface Smoother {
  push(x: number, y: number, t: number): void;
  at(now: number): Smoothed | null;
}

export function createSmoother(): Smoother {
  let s: Sample[] = [];
  let px = 0, py = 0, pt = -1;         // displayed (damped) position and the time it was computed
  let fadeFrom = -Infinity;
  let movedAt = -Infinity;
  return {
    push(x, y, t) {
      const last = s[s.length - 1];
      if (last && last.x === x && last.y === y) return;
      if (last && Math.hypot(x - last.x, y - last.y) > TELEPORT) { s = []; px = x; py = y; pt = t; fadeFrom = t; }
      s.push({ x, y, t: last && t <= last.t ? last.t + 1 : t });
      if (s.length > 3) s.shift();
      movedAt = t;
    },
    at(now) {
      if (!s.length) return null;
      const last = s[s.length - 1];
      const dt = pt < 0 ? 0 : Math.max(0, now - pt);
      const prev = s[s.length - 2];
      let tx = last.x, ty = last.y, exact = false;
      if (prev && last.t - prev.t <= SPARSE_GAP_MS) {
        const rt = now - DELAY_MS;
        if (rt <= last.t) {
          let a = s[0], b = s[1];
          for (let i = 1; i < s.length; i++) { a = s[i - 1]; b = s[i]; if (rt <= b.t) break; }
          const k = Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t)));
          tx = a.x + (b.x - a.x) * k; ty = a.y + (b.y - a.y) * k; exact = true;
        } else {
          const over = Math.min(rt - last.t, MAX_EXTRAPOLATE_MS), span = last.t - prev.t;
          tx = last.x + ((last.x - prev.x) / span) * over; ty = last.y + ((last.y - prev.y) / span) * over;
        }
      }
      if (pt < 0 || exact) { px = tx; py = ty; }
      else { const k = 1 - Math.exp(-dt / TAU_MS); px += (tx - px) * k; py += (ty - py) * k; }
      pt = now;
      return { x: px, y: py, fade: Math.min(1, Math.max(0, (now - fadeFrom) / FADE_MS)), movedAt };
    },
  };
}
