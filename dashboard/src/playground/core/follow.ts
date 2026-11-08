// Follow an actor (CANVAS-27, MULTI-9, MULTI-24). No React, no DOM.
// Agents have no viewport: we keep their cursor (else the frame they work on) inside the inner 60% of the view with
// eased camera moves, zoom unchanged. Humans publish a viewport: we ease toward it. Following stops when the user
// moves the camera (wheel, pan, zoom: any camera change we did not make), on stop(), or when the actor is gone.
import type { ActorId, Cam, Presence, PresenceBus, Pt } from './types';
import type { CameraStore } from './camera';
import { scheduler as sharedScheduler, type Scheduler } from './raf';

export const INNER = 0.6;            // the cursor must stay inside this central share of the view
const SETTLE = 0.1;                  // once moving, keep going until within this share of the centre
const EASE_MS = 120;                 // time constant of the camera ease

export type FollowEnd = 'user' | 'stopped' | 'gone';
export interface FollowState { id: ActorId | null }

/** Where the camera should look for this actor (world point) and, for humans, the zoom to match. Pure. */
export function followTarget(p: Presence | undefined, kind: 'human' | 'other'): { pt: Pt; z?: number; w?: number } | null {
  if (!p) return null;
  if (kind === 'human' && p.viewport) {
    const v = p.viewport;
    return { pt: { x: v.x + v.w / 2, y: v.y + v.h / 2 }, z: v.z };
  }
  if (p.x !== undefined && p.y !== undefined) return { pt: { x: p.x, y: p.y } };
  if (p.focus) return { pt: { x: p.focus.x + p.focus.w / 2, y: p.focus.y + p.focus.h / 2 } };
  if (p.viewport) return { pt: { x: p.viewport.x + p.viewport.w / 2, y: p.viewport.y + p.viewport.h / 2 } };
  return null;
}

/** Pure: next camera for an agent follow. Returns `cam` itself while the point sits inside the inner area. */
export function trackPoint(cam: Cam, view: { w: number; h: number }, pt: Pt, dtMs: number, moving: boolean): { cam: Cam; moving: boolean } {
  const sx = pt.x * cam.z + cam.x, sy = pt.y * cam.z + cam.y;      // view-local px
  const limit = moving ? SETTLE : INNER / 2;
  const off = Math.abs(sx - view.w / 2) > view.w * limit || Math.abs(sy - view.h / 2) > view.h * limit;
  if (!off) return { cam, moving: false };
  const k = 1 - Math.exp(-dtMs / EASE_MS);
  return { cam: { z: cam.z, x: cam.x + (view.w / 2 - sx) * k, y: cam.y + (view.h / 2 - sy) * k }, moving: true };
}

export interface FollowDeps {
  store: CameraStore;
  presence: Pick<PresenceBus, 'get'>;
  me: ActorId;
  kindOf(id: ActorId): 'human' | 'other';
  sched?: Scheduler;
  onEnd?(id: ActorId, why: FollowEnd): void;
}

export interface Follow {
  start(id: ActorId): boolean;
  stop(why?: FollowEnd): void;
  current(): ActorId | null;
  subscribe(fn: () => void): () => void;
}

export function createFollow(d: FollowDeps): Follow {
  const sched = d.sched ?? sharedScheduler;
  const subs = new Set<() => void>();
  let target: ActorId | null = null;
  let last: Cam | null = null;
  let lastView = { w: 0, h: 0 };
  let moving = false;
  const sub = sched.register((dt) => {
    if (!target) return;
    const id = target;
    const p = d.presence.get(id);
    if (!p) { end('gone'); return; }
    const view = d.store.getViewSize();
    const cam = d.store.getCam();
    const resized = view.w !== lastView.w || view.h !== lastView.h;
    lastView = view;
    if (last && !resized && (cam.x !== last.x || cam.y !== last.y || cam.z !== last.z)) { end('user'); return; }
    const t = followTarget(p, d.kindOf(id));
    if (t && view.w > 0 && view.h > 0) {
      let next = cam;
      if (t.z !== undefined) {
        const k = 1 - Math.exp(-dt / EASE_MS);
        const z = cam.z + (t.z - cam.z) * k;
        const wx = t.pt.x, wy = t.pt.y;
        next = { z, x: cam.x + ((view.w / 2 - wx * z) - cam.x) * k, y: cam.y + ((view.h / 2 - wy * z) - cam.y) * k };
      } else {
        const r = trackPoint(cam, view, t.pt, dt, moving);
        next = r.cam; moving = r.moving;
      }
      if (next !== cam) d.store.setCam(next);
    }
    last = d.store.getCam();
    return true;
  }, -2);

  function emit() { [...subs].forEach((f) => f()); }
  function end(why: FollowEnd) {
    const id = target;
    if (!id) return;
    target = null; last = null; moving = false;
    emit();
    d.onEnd?.(id, why);
  }
  return {
    start(id) {
      if (id === d.me || !d.presence.get(id)) return false;
      target = id; last = d.store.getCam(); lastView = d.store.getViewSize(); moving = true;
      emit();
      sub.wake();
      return true;
    },
    stop(why = 'stopped') { end(why); },
    current: () => target,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

// ---- the page-wide follower (one board is mounted at a time) ----
let page: Follow | null = null;
let pageKey: unknown = null;
const pageSubs = new Set<() => void>();
const pageEnd = new Set<(id: ActorId, why: FollowEnd) => void>();
let unPage: (() => void) | null = null;

/** Follow `id` on this board's camera. Replaces any earlier follow. Returns false when the actor has no presence. */
export function followActor(env: { board: { me: ActorId; presence: Pick<PresenceBus, 'get'>; actors: { get?(id: ActorId): { kind: string } | undefined; list(): { id: ActorId; kind: string }[] } }; camera: CameraStore }, id: ActorId): boolean {
  if (!page || pageKey !== env.camera) {
    unPage?.(); page?.stop();
    const b = env.board;
    page = createFollow({
      store: env.camera, presence: b.presence, me: b.me,
      kindOf: (a) => (b.actors.list().find((x) => x.id === a)?.kind === 'human' ? 'human' : 'other'),
      onEnd: (a, why) => [...pageEnd].forEach((f) => f(a, why)),
    });
    pageKey = env.camera;
    unPage = page.subscribe(() => [...pageSubs].forEach((f) => f()));
  }
  return page.start(id);
}
export function stopFollow(why: FollowEnd = 'stopped') { page?.stop(why); }
export const followingId = (): ActorId | null => page?.current() ?? null;
export function subscribeFollow(fn: () => void): () => void { pageSubs.add(fn); return () => { pageSubs.delete(fn); }; }
export function onFollowEnd(fn: (id: ActorId, why: FollowEnd) => void): () => void { pageEnd.add(fn); return () => { pageEnd.delete(fn); }; }
