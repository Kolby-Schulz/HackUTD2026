import { describe, expect, it } from 'vitest';
import { createDocStore } from '../core/store';
import type { Op } from '../core/types';
import { frameTarget, loadingFrames } from './designClaims';
import type { DesignClaimRow } from './types';

const NOW = 1_000_000n;
const claim = (frameId: string, holder = 'agent-claude3-x', expires = NOW + 60_000_000n): DesignClaimRow =>
  ({ target: frameTarget('b1', frameId), kind: 'board', scope: 'b1', holder, expiresAt: { microsSinceUnixEpoch: expires } });
const frame = (id: string): Op => ({ t: 'create', shape: { id, kind: 'frame', name: id, x: 0, y: 0, w: 390, h: 844, fills: [], parent: null, index: 'a', createdBy: 'agent-claude3-x' } });
const child = (id: string, parent: string): Op => ({ t: 'create', shape: { id, kind: 'rect', name: id, x: 0, y: 0, w: 10, h: 10, fills: [], parent, index: 'a', createdBy: 'agent-claude3-x' } });

describe('loading frames', () => {
  it('a claimed frame with no layers is loading, and stops once a layer arrives', () => {
    const doc = createDocStore({ boardId: 'b1' });
    doc.dispatch('agent-claude3-x', 'Draw', [frame('f1')]);
    expect(loadingFrames([claim('f1')], doc.getState(), 'b1', NOW)).toEqual([{ frameId: 'f1', holder: 'agent-claude3-x' }]);
    doc.dispatch('agent-claude3-x', 'Draw', [child('c1', 'f1')]);
    expect(loadingFrames([claim('f1')], doc.getState(), 'b1', NOW)).toEqual([]);
  });

  it('ignores expired claims, claims by people, other boards and missing frames', () => {
    const doc = createDocStore({ boardId: 'b1' });
    doc.dispatch('agent-claude3-x', 'Draw', [frame('f1')]);
    const st = doc.getState();
    expect(loadingFrames([claim('f1', 'agent-claude3-x', NOW - 1n)], st, 'b1', NOW)).toEqual([]);
    expect(loadingFrames([claim('f1', 'human-abcd')], st, 'b1', NOW)).toEqual([]);
    expect(loadingFrames([claim('f1')], st, 'other', NOW)).toEqual([]);
    expect(loadingFrames([claim('nope')], st, 'b1', NOW)).toEqual([]);
  });
});
