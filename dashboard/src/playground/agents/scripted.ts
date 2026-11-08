// The scripted AgentDriver: today's runAgent/build/handle from engine.ts, acting only through
// Board (exec / gesture) and the choreographer. No React, no DOM, no store writes.
//
// One gesture per template build (so `board.undo(agent)` removes the whole build in one step);
// typing grows a text layer's `text` inside that same gesture, one character per update.
import { newId, opId } from '../core/ids';
import { absRect } from '../core/tree';
import type { AgentContext, AgentDriver, Command, Shape, Task } from '../core/types';
import { CANCEL } from './choreographer';
import type { Choreographer } from './choreographer';
import { HELP, editCommands, parseEdit, pickTemplate } from './intent';
import { TEMPLATES, childProps, frameProps } from './templates';
import type { Tpl } from './templates';

/** What the scripted driver needs beyond AgentContext: the runtime hands over the choreographer. */
export type ScriptedContext = AgentContext & { choreo: Choreographer };

// ---- slot grid: each build gets a cell on the board ----
export const COLS = 5, CELL_W = 500, CELL_H = 620, MAX_SLOTS = 30;
export interface Slots { claim(): number; clear(): void }
export function createSlots(max = MAX_SLOTS): Slots {
  const used = new Set<number>();
  return {
    claim() {
      let k = 0;
      while (used.has(k)) k++;
      if (k >= max) return -1;
      used.add(k);
      return k;
    },
    clear() { used.clear(); },
  };
}
/** World position of a template frame centred in its slot cell. */
export function slotOrigin(slot: number, tpl: Tpl) {
  return { x: (slot % COLS) * CELL_W + Math.round((CELL_W - tpl.w) / 2), y: Math.floor(slot / COLS) * CELL_H + 40 };
}

export function createScriptedDriver(o: { slots: Slots; templates?: Tpl[] }): AgentDriver {
  const templates = o.templates ?? TEMPLATES;
  const inbox: Array<{ task: Task; done: () => void }> = [];
  let ctx!: ScriptedContext;
  let alive = false;
  let serving = false;
  let nextTpl: Tpl | undefined;

  const wait = (ms: number) => ctx.choreo.wait(ms);
  /** Between steps: wait out a pause, then handle any notes people sent this agent. */
  async function gate() {
    await wait(0);
    await serve();
  }
  /** Idle wait that still answers notes promptly. */
  async function idle(ms: number) {
    for (let left = ms; left > 0; left -= 60) {
      await wait(60);
      if (inbox.length) await gate();
    }
  }

  async function serve() {
    if (serving || !inbox.length) return;
    serving = true;
    try {
      while (inbox.length) {
        await wait(0);
        const item = inbox.shift()!;
        try { await handle(item.task); } finally { item.done(); }
      }
    } finally {
      serving = false;
    }
  }

  async function handle(task: Task) {
    ctx.setState('thinking', 'reading your note');
    await wait(350);
    const doc = ctx.board.doc.getState();
    const found = task.shapeId ? doc.shapes.get(task.shapeId) : undefined;
    const shape: Shape | undefined = found && !found.deleted ? found : undefined;
    if (task.shapeId && !shape) { ctx.say('That layer is gone now, so there is nothing to change.'); return; }
    if (!shape) {
      const tpl = pickTemplate(task.text);
      ctx.say(tpl ? `Sure, I'll build a ${tpl.name} next.` : HELP);
      if (tpl) nextTpl = tpl;
      return;
    }
    const edit = parseEdit(task.text, shape);
    if (!edit) { ctx.say(HELP); return; }
    ctx.say(`On it: ${shape.name}.`);
    ctx.setState('drawing', `editing ${shape.name.toLowerCase()}`);
    const box = absRect(doc, shape.id) ?? shape;
    await ctx.choreo.moveTo(box.x + box.w / 2, box.y + box.h / 2);
    ctx.choreo.press(true);
    await wait(220);
    const res = ctx.board.exec({ actor: ctx.me.id, opId: opId(ctx.me.id), commands: editCommands(shape.id, edit), label: `${ctx.me.name}: ${edit.summary[0]}` });
    ctx.choreo.press(false);
    const fail = res.results.find((r) => !r.ok);
    ctx.say(res.ok || !fail || fail.ok ? `Done: ${edit.summary.join(', ')}.` : `Could not change ${shape.name}: ${fail.message}`);
  }

  async function build(tpl: Tpl, ox: number, oy: number) {
    const { board, me, choreo } = ctx;
    ctx.say(`Starting a ${tpl.name}.`);
    const frameId = newId('f');
    const cmds: Command[] = [];
    const g = board.gesture(me.id, `${me.name}: build ${tpl.name}`);
    const set = (idx: number, cmd: Command) => { cmds[idx] = cmd; g.update(cmds); };
    choreo.beginPlan(tpl.children.length + 1);
    let finished = false;
    try {
      ctx.setState('drawing', `framing ${tpl.name}`);
      await choreo.moveTo(ox, oy);
      const frame = (size: { w: number; h: number }): Command => ({ t: 'shape.create', kind: 'frame', id: frameId, props: frameProps(tpl, ox, oy, size) });
      set(0, frame({ w: 1, h: 1 }));
      await choreo.intent({ t: 'drag', shapeId: frameId, to: { x: ox, y: oy, w: tpl.w, h: tpl.h } }, { onDrag: (r) => set(0, frame(r)) });

      for (const el of tpl.children) {
        await gate();
        ctx.setState('drawing', `${el.kind === 'text' ? 'typing' : 'drawing'} ${el.name.toLowerCase()}`);
        const sx = ox + el.x, sy = oy + el.y, id = newId('s'), idx = cmds.length;
        const create = (props: ReturnType<typeof childProps>): Command => ({ t: 'shape.create', kind: el.kind, id, parent: frameId, props });
        const world = { x: sx, y: sy, w: el.w, h: el.h };
        if (el.kind === 'text') {
          set(idx, create(childProps(el, me.color, { typed: '' })));
          await choreo.intent({ t: 'type', shapeId: id, text: el.text ?? '' }, { rect: world, onType: (typed) => set(idx, create(childProps(el, me.color, { typed }))) });
        } else {
          await choreo.moveTo(sx, sy);
          set(idx, create(childProps(el, me.color, { size: { w: 1, h: 1 } })));
          await choreo.intent({ t: 'drag', shapeId: id, to: world }, { onDrag: (r) => set(idx, create(childProps(el, me.color, { size: r }))) });
        }
      }
      finished = true;
    } catch (e) {
      if (e !== CANCEL) { g.abort(); throw e; }
      // stopped mid-build: keep what was drawn as one valid undo step
    } finally {
      choreo.endPlan();
    }
    g.commit();
    if (!finished) throw CANCEL;
    ctx.say(`Finished the ${tpl.name} (${tpl.children.length + 1} layers). Click any part of it with the comment tool to ask for changes.`);
  }

  async function run() {
    await wait(200 + ctx.rng() * 800);
    while (alive) {
      await gate();
      const slot = o.slots.claim();
      if (slot < 0) {
        // board is full: wander and "review" other designs
        ctx.setState('thinking', 'reviewing');
        const k = Math.floor(ctx.rng() * MAX_SLOTS);
        await ctx.intent({ t: 'move', x: (k % COLS) * CELL_W + 100 + ctx.rng() * 300, y: Math.floor(k / COLS) * CELL_H + 60 + ctx.rng() * 400 });
        await idle(800 + ctx.rng() * 1500);
        continue;
      }
      const tpl = nextTpl ?? templates[Math.floor(ctx.rng() * templates.length)];
      nextTpl = undefined;
      const at = slotOrigin(slot, tpl);
      await build(tpl, at.x, at.y);
      ctx.setState('idle');
      await idle(500 + ctx.rng() * 1200);
    }
  }

  return {
    kind: 'scripted',
    start(c) {
      if (!(c as ScriptedContext).choreo) throw new Error('scripted driver needs ctx.choreo (use the agent runtime)');
      ctx = c as ScriptedContext;
      alive = true;
      run().catch((e) => {
        if (e === CANCEL) return;
        console.error(e);
        ctx.setState('error', e instanceof Error ? e.message : String(e));
      });
    },
    onTask(task) {
      if (!alive) return Promise.resolve();
      return new Promise<void>((resolve) => {
        // higher priority first, FIFO within a priority
        const at = inbox.findIndex((it) => it.task.priority < task.priority);
        inbox.splice(at < 0 ? inbox.length : at, 0, { task, done: resolve });
      });
    },
    stop() {
      alive = false;
      for (const it of inbox.splice(0)) it.done();
    },
  };
}
