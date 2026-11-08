import { describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { actionInfo } from '../../agents/runtime';
import { agentChatHooks } from './agentChat';
import { createChatStore } from '../../chat/store';
import { changedSince, inspectTx } from './txDiff';

describe('tx diff and Changed since', () => {
  it('reads the colour change of a tx and detects a later edit', () => {
    const board = createBoard({ me: 'human-1' });
    const c = board.exec({ actor: 'agent-a', opId: 'o1', commands: [{ t: 'shape.create', kind: 'rect', props: { x: 0, y: 0, w: 10, h: 10, fills: [{ type: 'solid', color: '#111111' }] } }] });
    const id = (c.results[0] as { id: string }).id;
    const r = board.exec({ actor: 'agent-a', opId: 'o2', commands: [{ t: 'shape.update', ids: [id], patch: { fills: [{ type: 'solid', color: '#a855f7' }] } }] });
    const info = inspectTx(board.doc, r.tx!)!;
    expect(info.diff).toEqual({ kind: 'color', from: '#111111', to: '#a855f7' });
    expect(changedSince(board.doc, info)).toBe(false);
    board.exec({ actor: 'human-1', opId: 'o3', commands: [{ t: 'shape.update', ids: [id], patch: { fills: [{ type: 'solid', color: '#ef4444' }] } }] });
    expect(changedSince(board.doc, info)).toBe(true);
    expect(board.revert('human-1', r.tx!).ok).toBe(false);   // the skip-superseded rule agrees
  });

  it('Undo of an untouched tx reverts exactly that batch', () => {
    const board = createBoard({ me: 'human-1' });
    const c = board.exec({ actor: 'agent-a', opId: 'o1', commands: [{ t: 'shape.create', kind: 'rect', props: { x: 0, y: 0, w: 10, h: 10, fills: [{ type: 'solid', color: '#111111' }] } }] });
    const id = (c.results[0] as { id: string }).id;
    const r = board.exec({ actor: 'agent-a', opId: 'o2', commands: [{ t: 'shape.update', ids: [id], patch: { w: 50 } }] });
    expect(inspectTx(board.doc, r.tx!)!.diff).toEqual({ kind: 'size', dw: 40, dh: 0 });
    expect(board.revert('human-1', r.tx!).ok).toBe(true);
    expect(board.doc.getState().shapes.get(id)!.w).toBe(10);
  });
});

describe('actionInfo', () => {
  it('words an edit and lists layers', () => {
    expect(actionInfo('Iris: fill is now purple', [{ t: 'shape.update', ids: ['s1'], patch: {} }], [{ ok: true }])).toEqual({ summary: 'Changed fill to purple', layers: ['s1'] });
    expect(actionInfo('Iris: fill is now red, made it bigger', [{ t: 'shape.update', ids: ['s1'], patch: {} }], []).summary).toBe('Changed fill to red, made it bigger');
    expect(actionInfo('Iris: removed Button', [{ t: 'shape.delete', ids: ['s1'] }], []).summary).toBe('Removed Button');
  });
  it('summarises a build by its layer count', () => {
    const cmds = [{ t: 'shape.create' as const, kind: 'frame' as const, id: 'f', props: {} }, { t: 'shape.create' as const, kind: 'rect' as const, id: 'r', parent: 'f', props: {} }];
    expect(actionInfo('Iris: build Profile card', cmds, [])).toEqual({ summary: 'Built Profile card (2 layers)', layers: ['f', 'r'] });
  });
});

describe('agentChatHooks', () => {
  const agent = { id: 'agent-a', kind: 'agent' as const, name: 'Iris', color: '#f00', caps: [] };
  it('replaces the thinking line with the card', () => {
    const store = createChatStore();
    const h = agentChatHooks(store);
    h.onThinking(agent, true, { shapeId: 's1' });
    expect(store.thread('agent-a').map((m) => m.body.kind)).toEqual(['status']);
    h.onAction(agent, { summary: 'Changed fill to purple', tx: 't1', layers: ['s1'] });
    const [t, card] = store.thread('agent-a');
    expect(t.body).toMatchObject({ kind: 'status', final: true, text: '' });
    expect(card.body).toMatchObject({ kind: 'action', tx: 't1' });
  });
  it('sweeps a placeholder left over from a reload', () => {
    const store = createChatStore();
    store.post({ thread: 'agent-a', from: 'agent-a', name: 'Iris', color: '#f00', body: { kind: 'status', text: 'Thinking…' } });
    agentChatHooks(store);
    expect(store.messages()[0].body).toMatchObject({ final: true });
  });
});
