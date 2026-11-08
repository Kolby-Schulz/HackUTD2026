// claim_service / release_service (issue #19): one mapper and one coordinator per database.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, mod, all, type Harness, type Who } from './helpers';

const claim = (t: Harness, who: Who, machine: string, holder: string, name = 'coordinator') =>
  t.as(who, (ctx) => mod.claim_service(ctx, { name, machine, holder }));
const release = (t: Harness, who: Who, holder: string, name = 'coordinator') => t.as(who, (ctx) => mod.release_service(ctx, { name, holder }));

describe('service lock', () => {
  let t: Harness;
  beforeEach(() => (t = makeHarness()));

  it('lets one process hold it and refuses everyone else while it heartbeats', () => {
    claim(t, 'coordinator', 'laptop-1', 'p1');
    t.advance(20);
    claim(t, 'coordinator', 'laptop-1', 'p1'); // heartbeat
    t.advance(20);
    expect(() => claim(t, 'outsider', 'laptop-2', 'p2')).toThrow(/already running on laptop-1/);
    // A second process with the same identity on the same laptop is refused too.
    expect(() => claim(t, 'coordinator', 'laptop-1', 'p3')).toThrow(/already running on laptop-1/);
    expect(all(t.db.service.iter())).toMatchObject([{ name: 'coordinator', machine: 'laptop-1', holder: 'p1' }]);
  });

  it('can be taken over once the heartbeat is stale', () => {
    claim(t, 'coordinator', 'laptop-1', 'p1');
    t.advance(31);
    claim(t, 'outsider', 'laptop-2', 'p2');
    expect(t.db.service.name.find('coordinator')).toMatchObject({ machine: 'laptop-2', holder: 'p2' });
  });

  it('only the holder releases it; names are independent', () => {
    claim(t, 'coordinator', 'laptop-1', 'p1');
    claim(t, 'mapper', 'laptop-2', 'm1', 'mapper');
    release(t, 'outsider', 'p1');
    release(t, 'coordinator', 'other');
    expect(t.db.service.name.find('coordinator')).toBeTruthy();
    release(t, 'coordinator', 'p1');
    expect(t.db.service.name.find('coordinator')).toBeFalsy();
    expect(t.db.service.name.find('mapper')).toMatchObject({ machine: 'laptop-2' });
    claim(t, 'outsider', 'laptop-2', 'p2'); // free again
  });
});
