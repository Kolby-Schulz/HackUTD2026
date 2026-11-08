import { afterEach, describe, expect, it } from 'vitest';
import { BUDGET, createFrameStats, createOpCounter, debugOn, quantile, resetDebug, setDebug, startSampler, toggleDebug, urlWantsDebug, LONG_FRAME_MS } from './perf';
import { createFakeFrameSource, createScheduler } from './raf';
import { createEventBus } from './events';

afterEach(resetDebug);

describe('quantile', () => {
  it('nearest rank', () => {
    const s = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(quantile(s, 0.5)).toBe(50);
    expect(quantile(s, 0.95)).toBe(95);
    expect(quantile(s, 1)).toBe(100);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe('frame stats', () => {
  it('60 fps steady meets the budget', () => {
    const s = createFrameStats();
    for (let i = 0; i < 100; i++) s.push(16.6);
    const r = s.snapshot();
    expect(r.fps).toBeCloseTo(60.2, 0);
    expect(r.p95Ms).toBeLessThanOrEqual(BUDGET.p95Ms);
    expect(r.longFrames).toBe(0);
  });
  it('p95 sees spikes and long frames are counted', () => {
    const s = createFrameStats();
    for (let i = 0; i < 90; i++) s.push(16);
    for (let i = 0; i < 10; i++) s.push(LONG_FRAME_MS + 10);
    const r = s.snapshot();
    expect(r.p95Ms).toBe(60);
    expect(r.p50Ms).toBe(16);
    expect(r.longFrames).toBe(10);
  });
  it('keeps only the last N frames; ignores bad numbers', () => {
    const s = createFrameStats(10);
    for (let i = 0; i < 10; i++) s.push(100);
    for (let i = 0; i < 10; i++) s.push(10);
    s.push(NaN); s.push(-1);
    const r = s.snapshot();
    expect(r.frames).toBe(10);
    expect(r.maxMs).toBe(10);
  });
  it('empty snapshot is zeros', () => { expect(createFrameStats().snapshot().fps).toBe(0); });
});

describe('op counter', () => {
  it('counts per actor and rolling ops/sec', () => {
    const c = createOpCounter(1000);
    c.record({ t: 'shape.created', actor: 'a1', at: 0, ids: ['x', 'y', 'z'] });
    c.record({ t: 'shape.updated', actor: 'a2', at: 500, ids: ['x'] });
    c.record({ t: 'selection.changed', actor: 'a2', at: 500 });
    expect(c.perActor()).toEqual({ a1: 3, a2: 1 });
    expect(c.total()).toBe(4);
    expect(c.opsPerSec(600)).toBe(4);
    expect(c.opsPerSec(1200)).toBe(1);   // the first batch fell out of the window
  });
});

describe('sampler', () => {
  it('records scheduler frame times and bus events, and stops cleanly', () => {
    const src = createFakeFrameSource();
    const sched = createScheduler(src);
    const bus = createEventBus(() => 0);
    const s = startSampler(bus, sched);
    for (let i = 0; i < 5; i++) src.step(16);
    bus.emit({ t: 'shape.created', actor: 'bot', ids: ['a', 'b'] });
    expect(s.stats.snapshot().frames).toBe(5);
    expect(s.ops.perActor()).toEqual({ bot: 2 });
    s.stop();
    expect(src.pending()).toBe(0);
    bus.emit({ t: 'shape.created', actor: 'bot', ids: ['c'] });
    expect(s.ops.total()).toBe(2);
  });
});

describe('debug toggle', () => {
  it('parses ?debug and ?hud=1 in search or hash', () => {
    expect(urlWantsDebug('?debug')).toBe(true);
    expect(urlWantsDebug('#/playground?debug')).toBe(true);
    expect(urlWantsDebug('#/playground?a=1&hud=1')).toBe(true);
    expect(urlWantsDebug('?debug=0')).toBe(false);
    expect(urlWantsDebug('')).toBe(false);
  });
  it('runtime override wins and toggles', () => {
    setDebug(true); expect(debugOn()).toBe(true);
    toggleDebug(); expect(debugOn()).toBe(false);
  });
});
