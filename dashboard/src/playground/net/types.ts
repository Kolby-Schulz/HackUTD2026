// The board's view of SpacetimeDB (contract: vault/Scopes/integration-plan.md, PR S).
// Row types here are structural ports: only the columns the board reads, named as the generated bindings name them
// (camelCase, u64 as bigint, JSON columns as strings), so binding rows satisfy them without casts.
// The live transport (net/spacetime.ts) adapts the generated DbConnection to BoardTransport; tests use a fake.
import type { ActorId } from '../core/types';

/** Server limits from push_ops. */
export const MAX_OPS_PER_PUSH = 100;
export const MAX_OP_BODY_BYTES = 8 * 1024;

export interface BoardOpRow { opId: string; boardId: string; seq: bigint; actor: string; tx: string; body: string }
/** Anything with the SDK Identity's hex form. */
export interface IdentityLike { toHexString(): string }
export interface BoardActorRow { actor: string; boardId: string; identity: IdentityLike; kind: string; name: string; color: string; lastOpSeq: bigint }
export interface BoardPresenceRow {
  presenceId: string; boardId: string; actor: string;
  selection: string; status: string; tool: string; detail: string; typing: string; viewport: string;
}
/** `doc` is a SavedBoard (core/types) as JSON, covering every op with seq <= uptoSeq. */
export interface BoardSnapshotRow { boardId: string; uptoSeq: bigint; doc: string }
export interface BoardCursorEvent { boardId: string; actor: string; x: number; y: number; tx: number; ty: number; moveMs: number; down: boolean }

/** One op as push_ops takes it. `body` is the encoded envelope (see opcodec). */
export interface PushOp { opId: string; tx: string; body: string }

/** Actor kinds the server knows. */
export type NetActorKind = 'human' | 'agent' | 'system';
export interface JoinArgs { boardId: string; actor: ActorId; kind: NetActorKind; name: string; color: string; agentId?: string }
export interface PresenceArgs {
  boardId: string; actor: ActorId;
  selection: string; status: string; tool: string; detail: string; typing: string; viewport: string;
}
export interface CursorArgs { boardId: string; actor: ActorId; x: number; y: number; tx: number; ty: number; moveMs: number; down: boolean }

export type NetStatus = 'connecting' | 'live' | 'offline';

/** A batch of table changes. `removed` carries the primary keys of deleted rows. */
export interface RowChange<R> { added: readonly R[]; removed: readonly string[] }

/** What the board needs from SpacetimeDB. Reducer calls resolve when the server commits and reject with its error. */
export interface BoardTransport {
  status(): NetStatus;
  /** This connection's identity, once connected. */
  identity(): IdentityLike | null;
  onStatus(cb: (s: NetStatus) => void): () => void;

  /** An `agent` row for a board agent, so the dashboard and token logs see it. */
  registerAgent(a: { id: string; name: string }): Promise<void>;
  heartbeat(agentId: string): Promise<void>;
  /** The `service` lock: claiming again while holding it is the heartbeat; it goes stale after 30 s. */
  claimService(name: string, holder: string): Promise<void>;
  releaseService(name: string, holder: string): Promise<void>;
  joinBoard(a: JoinArgs): Promise<void>;
  leaveBoard(boardId: string, actor: ActorId): Promise<void>;
  pushOps(boardId: string, ops: readonly PushOp[]): Promise<void>;
  setPresence(a: PresenceArgs): Promise<void>;
  moveCursor(a: CursorArgs): Promise<void>;

  /** The subscription's initial rows have all been delivered (fires again after each reconnect). */
  onSynced(cb: () => void): () => void;
  /** Each callback gets the current rows first (the subscription's initial set), then every later change. */
  onOps(cb: (c: RowChange<BoardOpRow>) => void): () => void;
  onSnapshot(cb: (c: RowChange<BoardSnapshotRow>) => void): () => void;
  onActors(cb: (c: RowChange<BoardActorRow>) => void): () => void;
  onPresence(cb: (c: RowChange<BoardPresenceRow>) => void): () => void;
  onCursor(cb: (e: BoardCursorEvent) => void): () => void;
}
