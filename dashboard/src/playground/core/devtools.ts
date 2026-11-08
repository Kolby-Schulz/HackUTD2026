// window.board: a thin console shim over board.exec (D4). Legacy names keep working:
// addShape / updateShape / shapes / cursors / addCursor / moveCursor / press / removeCursor / spawnAgent.
// The page (WP-11) may pass `legacy` hooks to drive its own animated cursors instead of the plain presence ones.
import { bench } from './bench';
import type { BoardKit } from './commands';
import { flatten } from './tree';
import { perf, setDebug } from './perf';
import { stress } from './stress';
import type { Batch, Command, Result, Shape, ShapeId } from './types';

export interface LegacyHooks {
  spawnAgent?: () => string;
  addCursor?: (name?: string, color?: string) => string;
  moveCursor?: (id: string, x: number, y: number, ms?: number) => unknown;
  press?: (id: string, down: boolean) => unknown;
  removeCursor?: (id: string) => unknown;
  cursors?: () => unknown[];
}

const CONSOLE = 'api-console';

/** Legacy shapes had `fill: string`; the document has `fills[]`. */
function fromLegacy(s: Record<string, any>): Record<string, any> {
  const { fill, kind: _k, id: _i, ...rest } = s;
  if (typeof fill === 'string' && rest.fills === undefined) rest.fills = [{ type: 'solid', color: fill }];
  return rest;
}
const toLegacy = (s: Shape) => ({ ...s, fill: s.fills.find((f) => f.type === 'solid')?.color });

export function createDevtools(board: BoardKit, legacy: LegacyHooks = {}) {
  let n = 0;
  if (!board.actors.get(CONSOLE)) board.actors.spawn({ id: CONSOLE, kind: 'api', name: 'Console' });
  const run = (commands: Command[], actor = CONSOLE): Result[] =>
    board.exec({ actor, opId: `console-${Date.now()}-${++n}`, commands }).results;

  return {
    /** board.exec({ commands: [...] }) or a bare command / command array; actor and opId default. */
    exec: (b: Partial<Batch> | Command | Command[]) => {
      const p: Partial<Batch> = Array.isArray(b) ? { commands: b } : 't' in b ? { commands: [b as Command] } : (b as Partial<Batch>);
      return board.exec({ actor: CONSOLE, opId: `console-${Date.now()}-${++n}`, commands: [], ...p });
    },
    gesture: board.gesture, undo: (a: string = CONSOLE) => board.undo(a), redo: (a: string = CONSOLE) => board.redo(a),
    snapshot: board.snapshot, subscribe: board.subscribe, core: board,
    help: () => 'board.exec({commands:[{t:"shape.create",kind:"rect",props:{x:0,y:0,w:100,h:100}}]})',

    addShape: (s: Record<string, any> = {}): ShapeId => {
      const props = fromLegacy({ name: 'Shape', x: 0, y: 0, w: 100, h: 100, fill: '#e7e5e0', ...s });
      const [r] = run([{ t: 'shape.create', kind: s.kind ?? 'rect', props, ...(s.parent ? { parent: s.parent } : {}), ...(s.id ? { id: s.id } : {}) }]);
      if (!r.ok) throw new Error(r.message);
      return r.id!;
    },
    updateShape: (id: ShapeId, p: Record<string, any>) => run([{ t: 'shape.update', ids: [id], patch: fromLegacy(p) }])[0].ok,
    shapes: () => { const st = board.doc.getState(); return flatten(st).map((id) => toLegacy(st.shapes.get(id)!)); },
    cursors: () => legacy.cursors?.() ?? board.actors.list().map((a) => {
      const p = board.presence.get(a.id);
      return { id: a.id, x: p?.x ?? 0, y: p?.y ?? 0, down: !!p?.down };
    }).filter((c) => board.presence.get(c.id)),

    spawnAgent: () => legacy.spawnAgent?.() ?? board.actors.spawn({ kind: 'agent', name: 'Agent' }).id,
    addCursor: (name = 'Bot', color?: string) => {
      if (legacy.addCursor) return legacy.addCursor(name, color);
      const a = board.actors.spawn({ kind: 'api', name, ...(color ? { color } : {}) });
      board.presence.publish({ actor: a.id, x: 0, y: 0, down: false });
      return a.id;
    },
    moveCursor: (id: string, x: number, y: number, ms?: number) =>
      legacy.moveCursor ? legacy.moveCursor(id, x, y, ms) : (board.presence.publish({ actor: id, x, y }), Promise.resolve()),
    press: (id: string, down: boolean) => legacy.press ? legacy.press(id, down) : board.presence.publish({ actor: id, down }),
    removeCursor: (id: string) => {
      if (legacy.removeCursor) return legacy.removeCursor(id);
      board.presence.remove(id); board.actors.remove(id);
    },
    bench, stress, perf,
    /** Show or hide the debug HUD (WP-33). */
    debug: (on = true) => setDebug(on),
  };
}

/** Put the shim on window.board; returns the uninstall function. */
export function installDevtools(board: BoardKit, legacy?: LegacyHooks): () => void {
  const dev = createDevtools(board, legacy);
  (globalThis as any).board = dev;
  return () => { if ((globalThis as any).board === dev) delete (globalThis as any).board; };
}
