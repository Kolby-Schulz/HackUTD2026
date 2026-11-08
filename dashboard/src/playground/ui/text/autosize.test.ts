import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { opId } from '../../core/ids';
import { setMeasureEnv } from '../../render/measure';
import { mayWriteMeasured, modeAfterResize, sizePatch, writeMeasuredSize } from './autosize';

beforeEach(() => setMeasureEnv({
  lineWidth: (l) => l.length * 10,
  wrap: (t, _s, w) => { const per = Math.max(1, Math.floor(w / 10)); const out: string[] = []; for (let i = 0; i < t.length; i += per) out.push(t.slice(i, i + per)); return out.length ? out : ['']; },
}));
afterEach(() => setMeasureEnv(null));

function make(actor: string, props: object) {
  const board = createBoard({ me: 'human-t' });
  const r = board.exec({ actor, opId: opId(actor), commands: [{ t: 'shape.create', kind: 'text', props: { w: 5, h: 5, fontSize: 10, ...props } }] });
  const id = r.results[0].ok ? r.results[0].id! : '';
  return { board, id, get: () => board.doc.getState().shapes.get(id)! };
}

describe('modeAfterResize', () => {
  it('width edge -> auto-h, height edge or corner -> fixed', () => {
    expect(modeAfterResize('auto-w', 'e')).toBe('auto-h');
    expect(modeAfterResize('fixed', 'w')).toBe('fixed');
    expect(modeAfterResize('auto-w', 's')).toBe('fixed');
    expect(modeAfterResize('auto-h', 'se')).toBe('fixed');
  });
});

describe('writeMeasuredSize', () => {
  it('auto-w grows width and height, then is idempotent', () => {
    const t = make('human-t', { text: 'abcd', textMode: 'auto-w' });
    expect(sizePatch(t.get())).toEqual({ w: 40, h: 12 });
    expect(writeMeasuredSize(t.board, t.id, { role: 'editor', actor: 'human-t' })).toBe(true);
    expect(t.get()).toMatchObject({ w: 40, h: 12 });
    expect(writeMeasuredSize(t.board, t.id, { role: 'editor', actor: 'human-t' })).toBe(false);
  });
  it('fixed is never rewritten', () => {
    expect(sizePatch(make('human-t', { text: 'abcd', textMode: 'fixed' }).get())).toBeNull();
  });
  it('host re-measures agent text as the system actor; viewers and non-agent text are skipped', () => {
    const t = make('agent-a', { text: 'abcd', textMode: 'auto-w' });
    expect(writeMeasuredSize(t.board, t.id, { role: 'host' }, false)).toBe(false);
    expect(writeMeasuredSize(t.board, t.id, { role: 'host' }, true)).toBe(true);
    expect(t.get()).toMatchObject({ w: 40 });
    expect(mayWriteMeasured(t.get(), { role: 'host' }, true)).toBe(true);
    const h = make('human-t', { text: 'abcd', textMode: 'auto-w' });
    expect(writeMeasuredSize(h.board, h.id, { role: 'host' }, true)).toBe(false);
  });
});
