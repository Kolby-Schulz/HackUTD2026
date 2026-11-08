// The server half of the mapper: sends FileMaps to upsert_symbols, but only when the
// server's code map actually differs, so restarting the mapper (or re-saving a file
// without changing an interface) writes nothing and never bumps a symbol's version.
//
// Two things on the server are not the mapper's to overwrite, and upsert_symbols keeps
// both itself (issue #25), so the mapper just sends what it parsed:
//   - behavior_note: agents set it through report_change('behavior'); the mapper always
//     sends '' (spec section 9: "leave empty from the mapper").
//   - signature text when the hash is unchanged: report_change('signature') rewrites the
//     row's signature with the agent's new one while the agent still works in its
//     worktree. Until the change reaches this checkout (and the hash moves), the server
//     keeps the agent's text.
import { DbConnection } from '@contract/client';
import type { FileMap, MappedEdge, MappedSymbol } from './map.ts';

/** The fields of a server `symbol` row the mapper compares (generated row type, camelCase). */
export interface ServerSymbol {
  id: string;
  name: string;
  kind: string;
  file: string;
  signature: string;
  signatureHash: string;
  behaviorNote: string;
}

export interface Upsert {
  file: string;
  symbols: MappedSymbol[];
  edges: MappedEdge[];
}

const edgeKey = (e: MappedEdge) => `${e.callerId}\u0000${e.calleeId}`;

/**
 * What to send for `map` given the server's rows, or undefined when the server already
 * matches (same symbol ids, names, kinds and hashes, and the same outgoing edges).
 * `serverSymbols`: rows whose file is map.file. `serverEdges`: rows whose caller is one of
 * them or one of map's symbols.
 */
export function planUpsert(map: FileMap, serverSymbols: ServerSymbol[], serverEdges: MappedEdge[]): Upsert | undefined {
  const byId = new Map(serverSymbols.map((s) => [s.id, s]));
  const sameSymbols =
    serverSymbols.length === map.symbols.length &&
    map.symbols.every((s) => {
      const cur = byId.get(s.id);
      return cur && cur.name === s.name && cur.kind === s.kind && cur.signatureHash === s.signatureHash;
    });
  const want = new Set(map.edges.map(edgeKey));
  const have = new Set(serverEdges.map(edgeKey));
  const sameEdges = want.size === have.size && [...want].every((k) => have.has(k));
  if (sameSymbols && sameEdges) return undefined;
  return { file: map.file, symbols: map.symbols, edges: map.edges };
}

export interface SyncOptions {
  host: string; // SPACETIME_HOST, e.g. ws://localhost:3000
  dbName: string; // SPACETIME_DB_NAME
  /** Milliseconds to wait for the connection and first subscription. Default 10 s. */
  timeoutMs?: number;
  /** Called once if the connection drops after connecting. */
  onDisconnect?: (reason: string) => void;
}

/** A connection that mirrors the server's code map and writes it through upsert_symbols. */
export class MapSync {
  private closed = false;

  private constructor(private readonly conn: DbConnection) {}

  /** Connects anonymously (upsert_symbols needs no agent) and subscribes to the code map. */
  static connect(opts: SyncOptions): Promise<MapSync> {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    return new Promise((resolvePromise, reject) => {
      let sync: MapSync | undefined;
      const timer = setTimeout(
        () => reject(new Error(`mapper: no response from ${opts.host} (${opts.dbName}) within ${timeoutMs} ms`)),
        timeoutMs,
      );
      const fail = (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      const conn: DbConnection = DbConnection.builder()
        .withUri(opts.host)
        .withDatabaseName(opts.dbName)
        .onConnect(() => {
          conn
            .subscriptionBuilder()
            .onApplied(() => {
              clearTimeout(timer);
              sync = new MapSync(conn);
              resolvePromise(sync);
            })
            .onError((ctx) => fail(new Error(`mapper: subscription failed: ${String(ctx.event ?? 'unknown error')}`)))
            .subscribe(['SELECT * FROM symbol', 'SELECT * FROM symbol_edge']);
        })
        .onConnectError((_ctx, err) => fail(err))
        .onDisconnect((_ctx, err) => {
          if (!sync || sync.closed) return;
          sync.closed = true;
          opts.onDisconnect?.(err ? String(err) : 'connection lost');
        })
        .build();
    });
  }

  /** Files the server has symbols for. */
  serverFiles(): Set<string> {
    return new Set([...this.conn.db.symbol.iter()].map((s) => s.file));
  }

  /** The server's current rows for one file (for tests and logging). */
  serverSymbols(file: string): ServerSymbol[] {
    return [...this.conn.db.symbol.file.filter(file)];
  }

  /**
   * Sends one file's map if the server differs. Returns what was sent, or undefined when
   * nothing needed to change. Throws if the reducer rejects it.
   */
  async push(map: FileMap): Promise<Upsert | undefined> {
    if (this.closed) throw new Error('mapper: connection closed');
    const db = this.conn.db;
    const serverSymbols = this.serverSymbols(map.file);
    const callers = new Set([...serverSymbols.map((s) => s.id), ...map.symbols.map((s) => s.id)]);
    const serverEdges: MappedEdge[] = [];
    for (const id of callers) {
      for (const e of db.symbolEdge.caller_id.filter(id)) serverEdges.push({ callerId: e.callerId, calleeId: e.calleeId });
    }
    const upsert = planUpsert(map, serverSymbols, serverEdges);
    if (!upsert) return undefined;
    await this.conn.reducers.upsertSymbols(upsert);
    return upsert;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.conn.disconnect();
  }
}
