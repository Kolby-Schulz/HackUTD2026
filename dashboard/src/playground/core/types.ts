// Frozen shared types for the playground (REQUIREMENTS section 7). Types only, no React or DOM.
// Adding a field after WP-01 is an orchestrator change (optional fields only).

// ---- ids and actors ----
export type ShapeId = string;
export type ActorKind = 'human' | 'agent' | 'api' | 'system';
export type ActorId = string;                         // `${kind}-${short}`: 'human-you', 'agent-k3f9'
export type Cap = 'read' | 'write' | 'comment' | 'claim' | 'spawn' | 'admin';
export interface Actor { id: ActorId; kind: ActorKind; name: string; color: string; caps: Cap[]; role?: string; driver?: 'scripted' | 'llm' }

// ---- geometry ----
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Cam = { x: number; y: number; z: number };  // screen translation of world origin (css px), scale

// ---- shapes ----
export type Kind = 'frame' | 'group' | 'rect' | 'ellipse' | 'text' | 'line' | 'image'; // line/image: type only in P0
export type Paint = { type: 'solid'; color: string; opacity?: number; hidden?: boolean };   // gradients P2
export type Stroke = { color: string; width: number; align?: 'inside' | 'center' | 'outside'; hidden?: boolean };
export type Effect = { type: 'drop' | 'inner' | 'blur'; x: number; y: number; blur: number; spread?: number; color: string; hidden?: boolean };
export type Constraint = { h: 'left' | 'right' | 'leftright' | 'center' | 'scale'; v: 'top' | 'bottom' | 'topbottom' | 'center' | 'scale' }; // P1

export type ShapeProps = {                            // every field is LWW'd independently
  name: string; nameAuto?: boolean;
  x: number; y: number; w: number; h: number;         // parent space, unrotated box
  rotation?: number; flipX?: boolean; flipY?: boolean; // degrees clockwise about center (P1 UI)
  hidden?: boolean; locked?: boolean; opacity?: number;
  fills: Paint[]; strokes?: Stroke[]; effects?: Effect[];
  radius?: number | [number, number, number, number];
  clip?: boolean; lockRatio?: boolean;                // clip default true for frames
  text?: string; fontFamily?: string; fontSize?: number; fontWeight?: number;
  lineHeight?: number | 'auto'; letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify'; textVAlign?: 'top' | 'middle' | 'bottom';
  textMode?: 'auto-w' | 'auto-h' | 'fixed'; color?: string; humanEdited?: boolean;
  constraints?: Constraint;                           // P1
  author?: ActorId;                                   // who made / owns it for routing (reassignable)
};
export type Stamp = readonly [lamport: number, actor: ActorId];
export type Shape = ShapeProps & {
  id: ShapeId; kind: Kind;                            // kind immutable after create
  parent: ShapeId | null; index: string;              // D1, D2
  createdBy: ActorId; deleted?: true;                 // tombstone
  stamps: Partial<Record<keyof ShapeProps | 'place' | 'deleted', Stamp>>;
};

// ---- ops (replayable, idempotent) ----
export type Op =
  | { t: 'create'; shape: Omit<Shape, 'stamps' | 'deleted'> }
  | { t: 'set'; id: ShapeId; patch: Partial<ShapeProps> }
  | { t: 'place'; id: ShapeId; parent: ShapeId | null; index: string }
  | { t: 'remove'; id: ShapeId } | { t: 'restore'; id: ShapeId }
  | { t: 'board'; patch: Partial<BoardMeta> };
export type BoardMeta = { name: string; background?: string };
export type OpEnvelope = { opId: string; actor: ActorId; lamport: number; ts: number; tx: string; session?: string; body: Op };
export type Tx = {
  id: string; actor: ActorId; label: string; ops: Op[]; inverse: Op[];
  produced: Array<{ id: ShapeId; field: string; stamp: Stamp }>;
  coalesceKey?: string; ts: number; sel?: { before: ShapeId[]; after: ShapeId[] }; causedBy?: string;
};
export type DocState = { rev: number; lamport: number; shapes: ReadonlyMap<ShapeId, Shape>; children: ReadonlyMap<ShapeId | null, readonly ShapeId[]>; meta: BoardMeta };
export interface TxHandle { apply(ops: Op[]): void; commit(): Tx | null; abort(): void }
export interface DocStore {
  getState(): DocState; subscribe(l: () => void): () => void; subscribeShape(id: ShapeId, l: () => void): () => void;
  dispatch(actor: ActorId, label: string, ops: Op[], o?: { coalesceKey?: string; causedBy?: string }): Tx | null;
  begin(actor: ActorId, label: string, o?: { coalesceKey?: string }): TxHandle;
  applyRemote(envs: OpEnvelope[]): void; log(from?: number): readonly OpEnvelope[];
  onChange(l: (ids: ShapeId[]) => void): () => void;  // feeds spatial index, culling, events
  snapshot(): SavedBoard; load(b: SavedBoard): void;
}

// ---- board commands (the one API; D4) ----
export type Ref = ShapeId | `$${number}`;            // $n = id created by command n of this batch
export type Command =
  | { t: 'shape.create'; kind: Kind; props: Partial<ShapeProps>; parent?: Ref | null; at?: 'top' | 'bottom' | { after: Ref }; id?: ShapeId }
  | { t: 'shape.update'; ids: Ref[]; patch: Partial<ShapeProps> }
  | { t: 'shape.translate'; ids: Ref[]; dx: number; dy: number }
  | { t: 'shape.resize'; id: Ref; box: Rect }        // box in parent space
  | { t: 'shape.delete'; ids: Ref[] }
  | { t: 'shape.duplicate'; ids: Ref[]; offset?: Pt }
  | { t: 'shape.reparent'; ids: Ref[]; parent: Ref | null; at?: 'top' | 'bottom' | { after: Ref }; keepWorld?: boolean }
  | { t: 'shape.reorder'; ids: Ref[]; to: 'front' | 'back' | 'forward' | 'backward' }
  | { t: 'shape.group'; ids: Ref[]; as?: 'group' | 'frame'; name?: string }
  | { t: 'shape.ungroup'; ids: Ref[] }
  | { t: 'selection.set'; ids: Ref[] }                // presence, not an op
  | { t: 'comment.create'; anchor: Anchor; text: string; to?: ActorId[] }
  | { t: 'comment.reply'; threadId: string; text: string }
  | { t: 'comment.resolve'; threadId: string; state: 'open' | 'answered' | 'resolved' }
  | { t: 'chat.say'; thread: string; body: MsgBody; to?: ActorId[] }
  | { t: 'claim.acquire'; target: ClaimTarget; ttlMs?: number; reason?: string }
  | { t: 'claim.release'; claimId: string }
  | { t: 'status.set'; state: AgentState; detail?: string };
export interface Batch { actor: ActorId; opId: string; commands: Command[]; atomic?: boolean; label?: string; causedBy?: string }
export type CmdError = 'not_found' | 'locked' | 'claimed_by' | 'forbidden' | 'stale' | 'invalid' | 'duplicate';
export type Result = { ok: true; id?: ShapeId } | { ok: false; error: CmdError; holder?: ActorId; message: string };
export interface ExecResult { ok: boolean; seq: number; tx?: string; results: Result[]; duplicate?: boolean }
export interface Gesture { update(cmds: Command[]): void; commit(): ExecResult; abort(): void } // update re-applies from the base snapshot
export interface Board {
  exec(b: Batch): ExecResult; gesture(actor: ActorId, label: string, o?: { coalesceKey?: string }): Gesture;
  undo(actor: ActorId): boolean; redo(actor: ActorId): boolean; revert(by: ActorId, txId: string): Result;
  subscribe(f: Filter, cb: (e: BoardEvent) => void): () => void;
  snapshot(o?: { region?: Rect }): Snapshot; doc: DocStore; presence: PresenceBus; actors: ActorRegistry;
}

// ---- events ----
export type BoardEvent = { seq: number; at: number; actor: ActorId; causedBy?: string } & (
  | { t: 'shape.created' | 'shape.updated' | 'shape.deleted'; ids: ShapeId[] }
  | { t: 'selection.changed'; ids: ShapeId[] }
  | { t: 'comment.created' | 'comment.replied' | 'comment.resolved'; threadId: string; to?: ActorId[] }
  | { t: 'message.created'; messageId: string; thread: string; to?: ActorId[] }
  | { t: 'claim.granted' | 'claim.denied' | 'claim.released'; claimId: string; holder?: ActorId }
  | { t: 'lock.revoked'; ids: ShapeId[]; by: ActorId }
  | { t: 'conflict.opened' | 'conflict.ruled'; conflictId: string }
  | { t: 'actor.joined' | 'actor.left' | 'status.changed'; who: ActorId; state?: AgentState });
export interface Filter { actors?: ActorId[]; kinds?: BoardEvent['t'][]; addressedTo?: ActorId; shapeIds?: ShapeId[] }

// ---- presence (ephemeral; D4) ----
export type AgentState = 'idle' | 'thinking' | 'drawing' | 'waiting_user' | 'waiting_agent' | 'blocked' | 'paused' | 'stopped' | 'error';
export interface Presence {
  actor: ActorId; x?: number; y?: number; down?: boolean; tool?: string;   // world coords
  selection?: ShapeId[]; viewport?: Rect & { z: number }; focus?: Rect; typing?: string;
  state?: AgentState; detail?: string; lastInputAt: number;
}
export interface LockRecord { shapeId: ShapeId; holder: ActorId; since: number; ttlMs: number }
export type ClaimTarget = { kind: 'frame' | 'shape'; id: ShapeId } | ({ kind: 'rect' } & Rect);
export interface Claim { id: string; holder: ActorId; target: ClaimTarget; expiresAt: number; reason?: string }
export interface Conflict { id: string; kind: 'claim_contention'; actors: ActorId[]; target: ClaimTarget; state: 'open' | 'ruled'; ruling?: string }
export interface PresenceBus { publish(p: Partial<Presence> & { actor: ActorId }): void; get(a: ActorId): Presence | undefined; subscribe(cb: (all: ReadonlyMap<ActorId, Presence>) => void): () => void }

// ---- chat and comments ----
export type Anchor = { kind: 'shape'; shapeId: ShapeId; fx: number; fy: number } | { kind: 'point'; x: number; y: number } | { kind: 'orphan'; x: number; y: number; wasShapeId: ShapeId };
export type MsgBody =
  | { kind: 'text'; text: string } | { kind: 'status'; text: string; final?: boolean }
  | { kind: 'action'; summary: string; tx: string; layers: ShapeId[]; undone?: boolean }
  | { kind: 'routing'; to: ActorId; why: 'mention' | 'claim' | 'author' | 'frame-author' | 'nearest' | 'manual' }
  | { kind: 'conflict'; conflictId: string } | { kind: 'system' | 'error'; text: string };
export interface Message { id: string; thread: string; from: ActorId; at: number; body: MsgBody; shapeId?: ShapeId; threadId?: string }

// ---- agents (the seam; D4) ----
export type Intent = { t: 'move'; x: number; y: number } | { t: 'drag'; shapeId: ShapeId; to: Rect } | { t: 'type'; shapeId: ShapeId; text: string } | { t: 'think'; ms?: number } | { t: 'point'; shapeId: ShapeId };
export interface Task { id: string; agent: ActorId; kind: 'note' | 'build'; text: string; shapeId?: ShapeId; threadId?: string; priority: 0 | 1 | 2 | 3; from: ActorId; state: 'queued' | 'running' | 'done' | 'cancelled' | 'failed' }
export interface AgentContext { me: Actor; board: Board; intent(i: Intent): Promise<void>; setState(s: AgentState, detail?: string): void; say(text: string): void; signal: AbortSignal; paused(): boolean; rng(): number }
export interface AgentDriver { readonly kind: 'scripted' | 'llm'; start(ctx: AgentContext): void | Promise<void>; onTask(t: Task): Promise<void>; onEvent?(e: BoardEvent): void; stop(): void }

// ---- UI actions (D7) ----
export type FocusContext = 'canvas' | 'panel' | 'chat' | 'text-edit' | 'palette' | 'dialog';
export interface Action { id: string; title: string; group: 'Tools' | 'Edit' | 'View' | 'Arrange' | 'Share' | 'Agents' | 'Help'; keys?: { mac?: string[]; win?: string[]; all?: string[] }; contexts: FocusContext[]; when?: () => true | string; run(args?: unknown): void }

// ---- persistence (D10) ----
export type SavedBoard = { format: 'contract-board'; v: number; boardId: string; meta: BoardMeta; savedAt: number; lamport: number; seq: Record<ActorId, number>; shapes: Shape[]; logTail?: OpEnvelope[]; extras?: Record<string, unknown> };

// ---- WP-01 additions (named in section 7 as "defined in WP-01 from these") ----
export interface Snapshot {
  rev: number; seq: number; shapes: Shape[]; selection: ShapeId[]; actors: Actor[]; region?: Rect;
}
export interface ActorRegistry {
  get(id: ActorId): Actor | undefined; list(): Actor[];
  register(a: Actor): void; remove(id: ActorId): void; subscribe(cb: () => void): () => void;
}
/** What a gesture frame knows: who runs it and the document it re-applies from on every update. */
export interface GestureContext {
  actor: ActorId; label: string; coalesceKey?: string; base: ReadonlyMap<ShapeId, Shape>;
}
