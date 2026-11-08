// The command API (AGENT-1, AGENT-4, SELECT-46, D4): the one door every document edit goes through.
//
//   exec(batch)  -> plan: gate + compile each Command to ops against a scratch copy of the document,
//                   then ONE store.dispatch for the whole batch (one Tx, one change notification, one undo step).
//   gesture()    -> same planner, but frames go into a store transaction; every update() re-plans from the base.
//
// Coordinates in commands are parent space (a root shape's parent space is the world). No React or DOM here.
import { createActorRegistry, isHuman } from './actors';
import { createEventBus } from './events';
import type { EventBus, EventDraft } from './events';
import { applyOp } from './ops';
import { keysBetween } from './order';
import { SpatialIndex } from './spatial';
import { createDocStore } from './store';
import { descendants, flatten, PROP_KEYS, reparentBox, wouldCycle } from './tree';
import { norm, rotatedBounds, union } from './geom';
import { newId } from './ids';
import { createGate } from './gate';
import type { Gate } from './gate';
import { createUndo } from './undo';
import type { UndoManager } from './undo';
import { createPresenceBus } from '../presence/bus';
import type { MemoryPresenceBus } from '../presence/bus';
import { createClaims } from '../presence/claims';
import type { Claims } from '../presence/claims';
import { createLocks } from '../presence/locks';
import type { Locks } from '../presence/locks';
import { createSelectionStore } from '../presence/selection';
import type { SelectionStore } from '../presence/selection';
import type {
  Actor, ActorId, ActorRegistry, Batch, Board, Cap, Command, DocState, DocStore, ExecResult, Gesture, Kind,
  Op, OpEnvelope, Rect, Result, Shape, ShapeId, ShapeProps, Snapshot, Tx, TxHandle,
} from './types';

export const MAX_COMMANDS = 500;
const OPID_CACHE = 1000;
const KINDS: readonly Kind[] = ['frame', 'group', 'rect', 'ellipse', 'text', 'line', 'image'];

type Failure = Extract<Result, { ok: false }>;
const fail = (error: Failure['error'], message: string, holder?: ActorId): Failure =>
  holder === undefined ? { ok: false, error, message } : { ok: false, error, message, holder };

// ---- small document helpers ----

const live = (s: DocState, id: ShapeId): Shape | undefined => {
  const sh = s.shapes.get(id);
  return sh && !sh.deleted ? sh : undefined;
};
/** Where a shape actually sits in the tree: its parent if that is alive, else the root. */
const effParent = (s: DocState, sh: Shape): ShapeId | null =>
  sh.parent !== null && live(s, sh.parent) ? sh.parent : null;
const isContainer = (sh: Shape) => sh.kind === 'frame' || sh.kind === 'group';
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Ids in list order without repeats and without shapes whose ancestor is also listed (they move with it). */
function roots(s: DocState, ids: readonly ShapeId[]): ShapeId[] {
  const set = new Set(ids);
  const out: ShapeId[] = [];
  for (const id of set) {
    let p = live(s, id) ? effParent(s, s.shapes.get(id)!) : null;
    let covered = false;
    while (p !== null) { if (set.has(p)) { covered = true; break; } p = effParent(s, s.shapes.get(p)!); }
    if (!covered) out.push(id);
  }
  return out;
}

/** `n` fresh sibling keys placed right after `afterId` (null = at the start) inside the sibling list `S`. */
function keysAfter(s: DocState, S: readonly ShapeId[], afterId: ShapeId | null, n: number): string[] | null {
  let a: string | undefined, b: string | undefined;
  if (afterId === null) b = S.length ? s.shapes.get(S[0])!.index : undefined;
  else {
    const i = S.indexOf(afterId);
    if (i < 0) return null;
    a = s.shapes.get(afterId)!.index;
    b = i + 1 < S.length ? s.shapes.get(S[i + 1])!.index : undefined;
  }
  return keysBetween(n, a, b);
}

type At = 'top' | 'bottom' | { after: ShapeId };
function keysAt(s: DocState, parent: ShapeId | null, at: At, n: number, exclude: ReadonlySet<ShapeId>): string[] | null {
  const S = (s.children.get(parent) ?? []).filter((id) => !exclude.has(id));
  const afterId = at === 'top' ? (S.length ? S[S.length - 1] : null) : at === 'bottom' ? null : at.after;
  return keysAfter(s, S, afterId, n);
}

// ---- planning: Commands -> ops ----

interface Ctx {
  actor: ActorId;
  state: DocState;                      // scratch document: earlier commands of this batch are already applied
  i: number;                            // index of the command being compiled
  made: (ShapeId | undefined)[];        // made[n] = id produced by command n (the `$n` targets)
  mkId(i: number, k: number): ShapeId;  // new shape id number k of command i (stable across gesture frames)
  deps: Deps;
}
interface Deps { claims: Claims; presence: MemoryPresenceBus; selection: SelectionStore; extra?: ExtraHandler }
/** Seam for commands this module does not own yet (comments, chat). Return undefined to decline. */
export type ExtraHandler = (actor: ActorId, cmd: Command) => Result | undefined;

type Compiled = { ok: true; ops: Op[]; id?: ShapeId; after?: (r: { id?: ShapeId }) => void } | Failure;
const done = (ops: Op[], id?: ShapeId, after?: (r: { id?: ShapeId }) => void): Compiled =>
  ({ ok: true, ops, ...(id !== undefined ? { id } : {}), ...(after ? { after } : {}) });

function ref(c: Ctx, r: unknown): ShapeId | Failure {
  if (typeof r !== 'string' || r === '') return fail('invalid', 'a shape id or $n reference is required');
  if (/^\$\d+$/.test(r)) {
    const n = Number(r.slice(1));
    if (n >= c.i) return fail('invalid', `${r} must refer to an earlier command`);
    const id = c.made[n];
    return id === undefined ? fail('invalid', `${r}: command ${n} did not produce a shape`) : id;
  }
  return r;
}
/** Resolve refs and require every target to be alive. */
function targets(c: Ctx, refs: unknown): ShapeId[] | Failure {
  if (!Array.isArray(refs)) return fail('invalid', 'ids must be an array');
  const out: ShapeId[] = [];
  for (const r of refs) {
    const id = ref(c, r);
    if (typeof id !== 'string') return id;
    if (!live(c.state, id)) return fail('not_found', `no live shape ${id}`);
    out.push(id);
  }
  return out;
}
function parentRef(c: Ctx, r: unknown): ShapeId | null | Failure {
  if (r === null || r === undefined) return null;
  const id = ref(c, r);
  if (typeof id !== 'string') return id;
  const p = live(c.state, id);
  if (!p) return fail('not_found', `no live parent ${id}`);
  if (!isContainer(p)) return fail('invalid', `${id} is a ${p.kind}, not a frame or group`);
  return id;
}
function atRef(c: Ctx, at: unknown): At | Failure {
  if (at === undefined || at === 'top') return 'top';
  if (at === 'bottom') return 'bottom';
  if (typeof at === 'object' && at !== null && 'after' in at) {
    const id = ref(c, (at as { after: unknown }).after);
    return typeof id === 'string' ? { after: id } : id;
  }
  return fail('invalid', 'at must be "top", "bottom" or { after }');
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Validate a props/patch object: only known ShapeProps keys, finite numbers where it matters. */
function cleanProps(p: unknown, forUpdate: boolean): Partial<ShapeProps> | Failure {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return fail('invalid', 'props must be an object');
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!(PROP_KEYS as string[]).includes(k)) {
      return fail('invalid', k === 'parent' || k === 'index' ? `"${k}" is structure: use shape.reparent / shape.reorder` : `unknown shape prop "${k}"`);
    }
    if (['x', 'y', 'w', 'h', 'rotation', 'opacity'].includes(k) && v !== undefined && !finite(v)) return fail('invalid', `${k} must be a finite number`);
    if (forUpdate && (k === 'w' || k === 'h') && (v as number) < 0) return fail('invalid', `${k} must not be negative`);
    out[k] = v;
  }
  return out as Partial<ShapeProps>;
}

const DEFAULTS: Record<Kind, Partial<ShapeProps>> = {
  frame: { w: 400, h: 300, fills: [{ type: 'solid', color: '#ffffff' }], clip: true },
  group: { w: 0, h: 0, fills: [] },
  rect: { w: 100, h: 100, fills: [{ type: 'solid', color: '#d9d9d9' }] },
  ellipse: { w: 100, h: 100, fills: [{ type: 'solid', color: '#d9d9d9' }] },
  text: { w: 100, h: 24, fills: [], text: '', fontSize: 16, textMode: 'auto-w' },
  line: { w: 100, h: 0, fills: [], strokes: [{ color: '#1a1a1a', width: 1 }] },
  image: { w: 100, h: 100, fills: [] },
};

/** Apply ops to a scratch state with throwaway envelopes (stamps only need to beat what is already there). */
function applyScratch(s: DocState, ops: readonly Op[], actor: ActorId, clock: { n: number }): DocState {
  let st = s;
  for (const body of ops) {
    const env: OpEnvelope = { opId: `~plan:${clock.n}`, actor, lamport: ++clock.n, ts: 0, tx: '~plan', body };
    st = applyOp(st, env);
  }
  return st;
}

function compile(cmd: Command, c: Ctx, clock: { n: number }): Compiled {
  const { state: s, actor } = c;
  switch (cmd.t) {
    case 'shape.create': {
      if (!KINDS.includes(cmd.kind)) return fail('invalid', `unknown kind "${String(cmd.kind)}"`);
      const parent = parentRef(c, cmd.parent);
      if (parent !== null && typeof parent !== 'string') return parent;
      const at = atRef(c, cmd.at);
      if (typeof at === 'object' && 'ok' in at) return at;
      const props = cleanProps(cmd.props ?? {}, false);
      if ('ok' in props) return props;
      const id = cmd.id ?? c.mkId(c.i, 0);
      if (typeof id !== 'string' || id === '' || /^\$/.test(id)) return fail('invalid', 'bad shape id');
      if (s.shapes.has(id)) return fail('invalid', `shape id ${id} already exists`);
      if (typeof at === 'object' && at.after !== undefined && live(s, at.after) && effParent(s, live(s, at.after)!) !== parent) {
        return fail('invalid', 'at.after must be a sibling under the same parent');
      }
      const index = keysAt(s, parent, at as At, 1, new Set())?.[0];
      if (index === undefined) return fail('invalid', 'at.after must be a live sibling');
      const shape = {
        name: cap1(cmd.kind), ...DEFAULTS[cmd.kind], ...props, id, kind: cmd.kind, parent, index,
        createdBy: actor, author: props.author ?? actor,
      } as Omit<Shape, 'stamps' | 'deleted'>;
      return done([{ t: 'create', shape }], id);
    }

    case 'shape.update': {
      const ids = targets(c, cmd.ids);
      if (!Array.isArray(ids)) return ids;
      const patch = cleanProps(cmd.patch, true);
      if ('ok' in patch) return patch;
      return done(ids.map((id) => ({ t: 'set', id, patch: { ...patch } }) as Op), ids[0]);
    }

    case 'shape.translate': {
      const ids = targets(c, cmd.ids);
      if (!Array.isArray(ids)) return ids;
      if (!finite(cmd.dx) || !finite(cmd.dy)) return fail('invalid', 'dx and dy must be finite numbers');
      return done(roots(s, ids).map((id) => {
        const sh = s.shapes.get(id)!;
        return { t: 'set', id, patch: { x: sh.x + cmd.dx, y: sh.y + cmd.dy } } as Op;
      }), ids[0]);
    }

    case 'shape.resize': {
      const ids = targets(c, [cmd.id]);
      if (!Array.isArray(ids)) return ids;
      const b = cmd.box;
      if (!b || !finite(b.x) || !finite(b.y) || !finite(b.w) || !finite(b.h)) return fail('invalid', 'box needs finite x, y, w, h');
      const r = norm(b);
      return done([{ t: 'set', id: ids[0], patch: { x: r.x, y: r.y, w: r.w, h: r.h } }], ids[0]);
    }

    case 'shape.delete': {
      const ids = targets(c, cmd.ids);
      if (!Array.isArray(ids)) return ids;
      // a tombstoned parent would float its children to the root, so delete the whole subtree
      const all = new Set<ShapeId>();
      for (const id of ids) { all.add(id); descendants(s, id).forEach((d) => all.add(d)); }
      return done([...all].map((id) => ({ t: 'remove', id }) as Op), ids[0]);
    }

    case 'shape.duplicate': {
      const ids = targets(c, cmd.ids);
      if (!Array.isArray(ids)) return ids;
      const off = cmd.offset ?? { x: 20, y: 20 };
      if (!finite(off.x) || !finite(off.y)) return fail('invalid', 'offset must be finite');
      const ops: Op[] = [];
      let k = 0, first: ShapeId | undefined;
      for (const rid of roots(s, ids)) {
        const src = s.shapes.get(rid)!;
        const parent = effParent(s, src);
        const S = s.children.get(parent) ?? [];
        const rootIndex = keysAfter(s, S, rid, 1)![0];
        const map = new Map<ShapeId, ShapeId>();
        for (const oid of [rid, ...descendants(s, rid)]) {
          const o = s.shapes.get(oid)!;
          const nid = c.mkId(c.i, k++);
          map.set(oid, nid);
          first ??= nid;
          const copy: Record<string, unknown> = {};
          for (const key of PROP_KEYS) if (o[key] !== undefined) copy[key] = o[key];
          if (oid === rid) Object.assign(copy, { x: o.x + off.x, y: o.y + off.y });
          ops.push({
            t: 'create',
            shape: { ...copy, id: nid, kind: o.kind, parent: oid === rid ? parent : map.get(o.parent!)!, index: oid === rid ? rootIndex : o.index, createdBy: actor, author: actor } as Omit<Shape, 'stamps' | 'deleted'>,
          });
        }
      }
      return done(ops, first);
    }

    case 'shape.reparent': {
      const ids = targets(c, cmd.ids);
      if (!Array.isArray(ids)) return ids;
      const parent = parentRef(c, cmd.parent);
      if (parent !== null && typeof parent !== 'string') return parent;
      const at = atRef(c, cmd.at);
      if (typeof at === 'object' && 'ok' in at) return at;
      const moved = roots(s, ids);
      for (const id of moved) if (wouldCycle(s, id, parent)) return fail('invalid', `cannot move ${id} into itself or its own descendant`);
      const paint = new Map(flatten(s).map((id, n) => [id, n]));
      moved.sort((a, b) => (paint.get(a) ?? 0) - (paint.get(b) ?? 0));
      if (typeof at === 'object' && live(s, at.after) && effParent(s, live(s, at.after)!) !== parent) {
        return fail('invalid', 'at.after must be a sibling under the new parent');
      }
      const keys = keysAt(s, parent, at as At, moved.length, new Set(moved));
      if (!keys) return fail('invalid', 'at.after must be a live sibling that is not being moved');
      const ops: Op[] = [];
      moved.forEach((id, n) => {
        ops.push({ t: 'place', id, parent, index: keys[n] });
        if (cmd.keepWorld) {
          const box = reparentBox(s, id, parent);
          if (!box) return;
          const patch: Partial<ShapeProps> = { x: box.x, y: box.y };
          if (s.shapes.get(id)!.rotation !== undefined || Math.abs(box.rotation ?? 0) > 1e-9) patch.rotation = box.rotation;
          ops.push({ t: 'set', id, patch });
        }
      });
      return done(ops, ids[0]);
    }

    case 'shape.reorder': {
      const ids = targets(c, cmd.ids);
      if (!Array.isArray(ids)) return ids;
      if (!['front', 'back', 'forward', 'backward'].includes(cmd.to)) return fail('invalid', 'to must be front, back, forward or backward');
      const byParent = new Map<ShapeId | null, Set<ShapeId>>();
      for (const id of new Set(ids)) {
        const p = effParent(s, s.shapes.get(id)!);
        if (!byParent.has(p)) byParent.set(p, new Set());
        byParent.get(p)!.add(id);
      }
      const ops: Op[] = [];
      for (const [parent, set] of byParent) {
        const S = s.children.get(parent) ?? [];
        const sel = S.filter((id) => set.has(id));
        const rest = S.filter((id) => !set.has(id));
        const n = sel.length;
        const first = S.indexOf(sel[0]), last = S.indexOf(sel[n - 1]);
        let afterId: ShapeId | null | undefined;
        if (cmd.to === 'front') afterId = S.slice(-n).every((id) => set.has(id)) ? undefined : (rest.length ? rest[rest.length - 1] : null);
        else if (cmd.to === 'back') afterId = S.slice(0, n).every((id) => set.has(id)) ? undefined : null;
        else if (cmd.to === 'forward') afterId = S.slice(last + 1).find((id) => !set.has(id));
        else {
          const pv = S.slice(0, first).reverse().find((id) => !set.has(id));
          afterId = pv === undefined ? undefined : (rest.indexOf(pv) > 0 ? rest[rest.indexOf(pv) - 1] : null);
        }
        if (afterId === undefined) continue; // already there
        const keys = keysAfter(s, rest, afterId, n)!;
        sel.forEach((id, j) => ops.push({ t: 'place', id, parent, index: keys[j] }));
      }
      return done(ops, ids[0]);
    }

    case 'shape.group': {
      const ids = targets(c, cmd.ids);
      if (!Array.isArray(ids)) return ids;
      const kind: Kind = cmd.as === 'frame' ? 'frame' : 'group';
      if (cmd.as !== undefined && cmd.as !== 'frame' && cmd.as !== 'group') return fail('invalid', 'as must be group or frame');
      const kids = roots(s, ids);
      if (kids.length === 0) return fail('invalid', 'nothing to group');
      const parent = effParent(s, s.shapes.get(kids[0])!);
      if (kids.some((id) => effParent(s, s.shapes.get(id)!) !== parent)) return fail('invalid', 'shapes to group must share a parent');
      const boxes = kids.map((id) => { const k = s.shapes.get(id)!; return rotatedBounds({ x: k.x, y: k.y, w: k.w, h: k.h }, k.rotation ?? 0); });
      const box = union(boxes)!;
      const S = s.children.get(parent) ?? [];
      const kidSet = new Set(kids);
      const rest = S.filter((id) => !kidSet.has(id));
      const topPos = Math.max(...kids.map((id) => S.indexOf(id)));
      const below = S.slice(0, topPos).filter((id) => !kidSet.has(id));
      const index = keysAfter(s, rest, below.length ? below[below.length - 1] : null, 1)![0];
      const gid = c.mkId(c.i, 0);
      const group = {
        name: cmd.name ?? cap1(kind), ...(kind === 'frame' ? { clip: true } : {}), fills: [],
        x: box.x, y: box.y, w: box.w, h: box.h, id: gid, kind, parent, index, createdBy: actor, author: actor,
      } as Omit<Shape, 'stamps' | 'deleted'>;
      const ops: Op[] = [{ t: 'create', shape: group }];
      const inOrder = S.filter((id) => kidSet.has(id));
      for (const id of inOrder) {
        const k = s.shapes.get(id)!;
        ops.push({ t: 'place', id, parent: gid, index: k.index }, { t: 'set', id, patch: { x: k.x - box.x, y: k.y - box.y } });
      }
      return done(ops, gid);
    }

    case 'shape.ungroup': {
      const ids = targets(c, cmd.ids);
      if (!Array.isArray(ids)) return ids;
      const ops: Op[] = [];
      let cur = s;
      for (const gid of new Set(ids)) {
        const g = live(cur, gid);
        if (!g) continue; // removed by an earlier ungroup of the same command
        if (!isContainer(g)) return fail('invalid', `${gid} is a ${g.kind}, not a group or frame`);
        const parent = effParent(cur, g);
        const S = cur.children.get(parent) ?? [];
        const gi = S.indexOf(gid);
        const rest = S.filter((id) => id !== gid);
        const kids = cur.children.get(gid) ?? [];
        const keys = keysAfter(cur, rest, gi > 0 ? S[gi - 1] : null, kids.length)!;
        const step: Op[] = [];
        kids.forEach((kid, n) => {
          step.push({ t: 'place', id: kid, parent, index: keys[n] });
          const box = reparentBox(cur, kid, parent);
          if (box) {
            const patch: Partial<ShapeProps> = { x: box.x, y: box.y };
            if (cur.shapes.get(kid)!.rotation !== undefined || Math.abs(box.rotation ?? 0) > 1e-9) patch.rotation = box.rotation;
            step.push({ t: 'set', id: kid, patch });
          }
        });
        step.push({ t: 'remove', id: gid });
        ops.push(...step);
        cur = applyScratch(cur, step, actor, clock);
      }
      return done(ops);
    }

    case 'selection.set': {
      const ids = targets(c, cmd.ids);
      if (!Array.isArray(ids)) return ids;
      return done([], undefined, () => c.deps.selection.set(actor, ids));
    }

    case 'claim.acquire': {
      const t = cmd.target;
      if (!t || (t.kind !== 'rect' && !live(s, t.id))) return fail('not_found', 'claim target does not exist');
      return done([], undefined, (r) => {
        const claim = c.deps.claims.acquire(actor, t, { ttlMs: cmd.ttlMs, reason: cmd.reason });
        r.id = claim.id;
      });
    }
    case 'claim.release': {
      const claim = c.deps.claims.list().find((k) => k.id === cmd.claimId);
      if (!claim) return fail('not_found', `no claim ${String(cmd.claimId)}`);
      if (claim.holder !== actor && !isHuman(actor)) return fail('forbidden', `claim is held by ${claim.holder}`, claim.holder);
      return done([], undefined, () => { c.deps.claims.release(claim.id); });
    }
    case 'status.set':
      return done([], undefined, () => c.deps.presence.publish({ actor, state: cmd.state, ...(cmd.detail !== undefined ? { detail: cmd.detail } : {}) }));

    case 'comment.create': case 'comment.reply': case 'comment.resolve': case 'chat.say': {
      const r = c.deps.extra?.(actor, cmd);
      if (r) return r.ok ? done([], r.id) : r;
      return fail('invalid', `${(cmd as Command).t} is not available yet`);
    }
    default:
      return fail('invalid', `unknown command "${String((cmd as { t?: unknown }).t)}"`);
  }
}

const NEEDS: Record<Command['t'], Cap> = {
  'shape.create': 'write', 'shape.update': 'write', 'shape.translate': 'write', 'shape.resize': 'write',
  'shape.delete': 'write', 'shape.duplicate': 'write', 'shape.reparent': 'write', 'shape.reorder': 'write',
  'shape.group': 'write', 'shape.ungroup': 'write', 'selection.set': 'read',
  'comment.create': 'comment', 'comment.reply': 'comment', 'comment.resolve': 'comment', 'chat.say': 'comment',
  'claim.acquire': 'claim', 'claim.release': 'claim', 'status.set': 'read',
};

/** Shape ids a command touches, for the lock / claim check. */
function touched(cmd: Command, c: Ctx): ShapeId[] {
  const out: ShapeId[] = [];
  const add = (r: unknown) => { if (typeof r === 'string') { const id = ref(c, r); if (typeof id === 'string') out.push(id); } };
  switch (cmd.t) {
    case 'shape.create': add(cmd.parent); break;
    case 'shape.update': case 'shape.translate': case 'shape.delete': case 'shape.reorder': case 'shape.group': case 'shape.ungroup':
      if (Array.isArray(cmd.ids)) cmd.ids.forEach(add);
      break;
    case 'shape.resize': add(cmd.id); break;
    case 'shape.duplicate': if (Array.isArray(cmd.ids)) cmd.ids.forEach(add); break;
    case 'shape.reparent': if (Array.isArray(cmd.ids)) cmd.ids.forEach(add); add(cmd.parent); break;
    default: break;
  }
  return out.filter((id) => c.state.shapes.has(id));
}

const LABELS: Record<Command['t'], string> = {
  'shape.create': 'Create', 'shape.update': 'Edit', 'shape.translate': 'Move', 'shape.resize': 'Resize',
  'shape.delete': 'Delete', 'shape.duplicate': 'Duplicate', 'shape.reparent': 'Reparent', 'shape.reorder': 'Reorder',
  'shape.group': 'Group', 'shape.ungroup': 'Ungroup', 'selection.set': 'Select', 'comment.create': 'Comment',
  'comment.reply': 'Reply', 'comment.resolve': 'Resolve', 'chat.say': 'Chat', 'claim.acquire': 'Claim',
  'claim.release': 'Release claim', 'status.set': 'Status',
};
const labelFor = (b: Pick<Batch, 'label' | 'commands'>) =>
  b.label ?? (b.commands.length === 1 ? LABELS[b.commands[0].t] ?? 'Edit' : 'Batch');

interface Plan { results: Result[]; ops: Op[]; afters: Array<() => void>; failed: boolean }

/**
 * Compile a batch against `base`. Atomic: stops at the first failure (nothing will be applied).
 * Best effort: failed commands are skipped, the rest still compile against the evolving scratch state.
 */
function plan(
  b: Pick<Batch, 'actor' | 'commands' | 'atomic'>, base: DocState,
  gate: Gate, deps: Deps, mkId: (i: number, k: number) => ShapeId,
): Plan {
  const results: Result[] = [];
  const ops: Op[] = [];
  const afters: Array<() => void> = [];
  const made: (ShapeId | undefined)[] = [];
  const clock = { n: base.lamport };
  let state = base;
  let failed = false;
  for (let i = 0; i < b.commands.length; i++) {
    const cmd = b.commands[i];
    const c: Ctx = { actor: b.actor, state, i, made, mkId, deps };
    let out: Compiled;
    try {
      const need = typeof cmd === 'object' && cmd !== null ? NEEDS[cmd.t] : undefined;
      if (!need) out = fail('invalid', `unknown command "${String((cmd as { t?: unknown } | null)?.t)}"`);
      else out = gate.check(b.actor, need, touched(cmd, c)) ?? compile(cmd, c, clock);
      if (out.ok) state = applyScratch(state, out.ops, b.actor, clock); // may throw on bad geometry
    } catch (e) {
      out = fail('invalid', e instanceof Error ? e.message : String(e));
    }
    if (out.ok) {
      const res: Result = out.id !== undefined ? { ok: true, id: out.id } : { ok: true };
      made[i] = out.id;
      ops.push(...out.ops);
      if (out.after) { const f = out.after; afters.push(() => { const r: { id?: ShapeId } = {}; f(r); if (r.id !== undefined && res.ok) res.id = r.id; }); }
      results.push(res);
    } else {
      failed = true;
      results.push(out);
      if (b.atomic) {
        for (let j = i + 1; j < b.commands.length; j++) results.push(fail('invalid', `not run: command ${i} failed`));
        break;
      }
    }
  }
  if (b.atomic && failed) {
    const at = results.findIndex((r) => !r.ok);
    results.forEach((r, j) => { if (r.ok) results[j] = fail('invalid', `rolled back: command ${at} failed`); });
    return { results, ops: [], afters: [], failed: true };
  }
  return { results, ops, afters, failed };
}

// ---- the board ----

export interface BoardOptions {
  store?: DocStore;
  boardId?: string;
  /** The local human. Registered on creation; their selection feeds Snapshot.selection. Default `human-you`. */
  me?: ActorId;
  now?: () => number;
  locks?: Locks;
  claims?: Claims;
  presence?: MemoryPresenceBus;
  actors?: ActorRegistry & { nextColor(): string; spawn(a: Partial<Actor> & { kind: Actor['kind']; name: string }): Actor; can(id: ActorId, cap: Cap): boolean };
  extra?: ExtraHandler;
}
/** The Board plus the parts a page or test needs to reach (locks, claims, selection, index, undo manager). */
export interface BoardKit extends Board {
  presence: MemoryPresenceBus;
  actors: ReturnType<typeof createActorRegistry>;
  locks: Locks; claims: Claims; selection: SelectionStore; index: SpatialIndex; undoManager: UndoManager;
  events: EventBus; gate: Gate; me: ActorId;
}

export function createBoard(opts: BoardOptions = {}): BoardKit {
  const doc = opts.store ?? createDocStore(opts.boardId !== undefined ? { boardId: opts.boardId } : {});
  const events = createEventBus(opts.now);
  const actors = opts.actors ?? createActorRegistry();
  const presence = opts.presence ?? createPresenceBus(opts.now ? { now: opts.now } : {});
  const locks = opts.locks ?? createLocks(opts.now);
  const claims = opts.claims ?? createClaims(opts.now);
  const selection = createSelectionStore();
  const undoManager = createUndo(doc);
  const gate = createGate({ actors, locks, claims });
  const index = new SpatialIndex();
  const me = opts.me ?? 'human-you';
  if (!actors.get(me)) actors.spawn({ id: me, kind: 'human', name: 'You' });

  index.rebuild(doc.getState());
  doc.onChange((ids) => index.update(doc.getState(), ids));

  selection.subscribe((actor, s) => {
    events.emit({ t: 'selection.changed', actor, ids: s.ids });
    presence.publish({ actor, selection: s.ids });
  });
  const prune = () => selection.prune((id) => !!live(doc.getState(), id));

  const deps: Deps = { claims, presence, selection, ...(opts.extra ? { extra: opts.extra } : {}) };
  let seq = 0;
  const cache = new Map<string, ExecResult>();

  function emit(e: EventDraft) { events.emit(e); }
  /** One event per kind per tx: created (create/restore), deleted (remove), updated (set/place of the rest). */
  function emitTx(tx: Tx, actor: ActorId, causedBy?: string) {
    const created = new Set<ShapeId>(), deleted = new Set<ShapeId>(), updated = new Set<ShapeId>();
    for (const op of tx.ops) {
      if (op.t === 'create') created.add(op.shape.id);
      else if (op.t === 'restore') created.add(op.id);
      else if (op.t === 'remove') deleted.add(op.id);
      else if (op.t === 'set' || op.t === 'place') updated.add(op.id);
    }
    const extra = causedBy !== undefined ? { causedBy } : {};
    if (created.size) emit({ t: 'shape.created', actor, ids: [...created], ...extra });
    const upd = [...updated].filter((id) => !created.has(id) && !deleted.has(id));
    if (upd.length) emit({ t: 'shape.updated', actor, ids: upd, ...extra });
    if (deleted.size) emit({ t: 'shape.deleted', actor, ids: [...deleted], ...extra });
    prune();
  }

  function remember(key: string, r: ExecResult) {
    cache.set(key, r);
    if (cache.size > OPID_CACHE) cache.delete(cache.keys().next().value as string);
  }

  function exec(b: Batch): ExecResult {
    if (!b || typeof b.actor !== 'string' || typeof b.opId !== 'string' || !Array.isArray(b.commands)) {
      return { ok: false, seq, results: [fail('invalid', 'a batch needs actor, opId and commands[]')] };
    }
    const key = `${b.actor}|${b.opId}`;
    const hit = cache.get(key);
    if (hit) return { ...hit, duplicate: true };
    if (b.commands.length > MAX_COMMANDS) {
      return { ok: false, seq, results: [fail('invalid', `a batch holds at most ${MAX_COMMANDS} commands`)] };
    }

    const p = plan(b, doc.getState(), gate, deps, () => newId());
    const causedBy = b.causedBy ?? b.opId;
    let tx: Tx | null = null;
    let results = p.results;
    const aborted = b.atomic && p.failed;
    if (!aborted) {
      try {
        tx = doc.dispatch(b.actor, labelFor(b), p.ops, { causedBy });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, seq, results: b.commands.map(() => fail('invalid', msg)) };
      }
      p.afters.forEach((f) => f());
      if (tx) { undoManager.record(tx); emitTx(tx, b.actor, causedBy); }
    }
    const ok = !p.failed && !aborted;
    const applied = !aborted && (tx !== null || p.afters.length > 0);
    if (applied) seq++;
    results = p.results;
    const out: ExecResult = { ok, seq, results, ...(tx ? { tx: tx.id } : {}) };
    if (ok || tx) remember(key, out); // a failed batch that changed nothing may be retried with the same opId
    return out;
  }

  function gesture(actor: ActorId, label: string, o: { coalesceKey?: string } = {}): Gesture {
    open.get(actor)?.abort(); // one open gesture per actor: a new one supersedes a stale one
    const ids = new Map<string, ShapeId>();
    const mkId = (i: number, k: number) => {
      const key = `${i}:${k}`;
      let id = ids.get(key);
      if (!id) ids.set(key, (id = newId()));
      return id;
    };
    const begin = (): TxHandle => doc.begin(actor, label, o);
    let handle = begin();
    let last: Plan = { results: [], ops: [], afters: [], failed: false };
    let finished = false;
    const g: Gesture = {
      update(cmds) {
        if (finished) throw new Error('gesture already finished');
        handle.abort(); // back to the base (committed + other actors' open gestures), then replay this frame
        last = plan({ actor, commands: cmds, atomic: false }, doc.getState(), gate, deps, mkId);
        handle = begin();
        try { handle.apply(last.ops); } catch (e) {
          handle.abort(); handle = begin();
          const msg = e instanceof Error ? e.message : String(e);
          last = { results: cmds.map(() => fail('invalid', msg)), ops: [], afters: [], failed: true };
        }
      },
      commit() {
        if (finished) throw new Error('gesture already finished');
        finished = true; open.delete(actor);
        const tx = handle.commit();
        last.afters.forEach((f) => f());
        if (tx) { undoManager.record(tx); emitTx(tx, actor); seq++; }
        return { ok: !last.failed, seq, results: last.results, ...(tx ? { tx: tx.id } : {}) };
      },
      abort() {
        if (finished) return;
        finished = true; open.delete(actor);
        handle.abort();
      },
    };
    open.set(actor, g);
    return g;
  }
  const open = new Map<ActorId, Gesture>();

  function afterUndo(actor: ActorId, tx: Tx | null) { if (tx) { emitTx(tx, actor); seq++; } }

  const board: BoardKit = {
    exec, gesture, doc, presence, actors, locks, claims, selection, index, undoManager, events, gate, me,
    undo(actor) {
      if (!gate.can(actor, 'write')) return false;
      const r = undoManager.undo(actor);
      afterUndo(actor, r.tx);
      return r.ok;
    },
    redo(actor) {
      if (!gate.can(actor, 'write')) return false;
      const r = undoManager.redo(actor);
      afterUndo(actor, r.tx);
      return r.ok;
    },
    revert(by, txId) {
      if (!gate.can(by, 'write')) return fail('forbidden', `${by} lacks the "write" capability`);
      const r = undoManager.revert(by, txId);
      afterUndo(by, r.tx);
      if (r.ok) return { ok: true };
      return fail('stale', r.skipped.length ? `${r.skipped.length} field(s) were changed since` : `nothing to revert for ${txId}`);
    },
    subscribe: (f, cb) => events.subscribe(f, cb),
    snapshot(o = {}): Snapshot {
      const st = doc.getState();
      let ids = flatten(st);
      if (o.region) { const inside = new Set(index.queryRect(o.region)); ids = ids.filter((id) => inside.has(id)); }
      return {
        rev: st.rev, seq, shapes: ids.map((id) => st.shapes.get(id)!), selection: [...selection.get(me).ids],
        actors: actors.list(), ...(o.region ? { region: o.region } : {}),
      };
    },
  };
  return board;
}

export type { Rect };
