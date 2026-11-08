// Rule 2, duplicate implementation (spec sections 8 and 14), inside publish_plan and
// report_change('created').
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, seedCodeMap, plan, reportChange, mod, all, FEES, type Harness } from './helpers';

const A_DATE = 'src/utils/date.ts#formatDate';
const B_DATE = 'src/checkout/receipt.ts#format_date';
const B_DISPLAY = 'src/checkout/receipt.ts#toDisplayDate';

const duplicates = (t: Harness) => all(t.db.conflict.iter()).filter((c) => c.kind === 'duplicate');
const instructionsFor = (t: Harness, id: string) => all(t.db.instruction.agent_id.filter(id));

describe('Rule 2 in publish_plan: against existing symbols', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    for (const id of ['agent-a', 'agent-b', 'coordinator']) register(t, id);
  });

  it('flags a planned create whose normalized name matches an existing symbol, and says reuse it', () => {
    // Arrange: calculateFee exists; B plans computeFee ("fee" after dropping verbs).
    const items = [{ symbol_id: 'src/checkout/fees.ts#computeFee', intent: 'create' }];

    // Act
    plan(t, 'agent-b', items);

    // Assert
    const [c] = duplicates(t);
    expect(c).toMatchObject({ kind: 'duplicate', symbol_id: FEES, agent_a: 'agent-b', agent_b: 'agent-b', status: 'open' });
    expect(c.details).toContain("same normalized name 'fee'");
    expect(instructionsFor(t, 'agent-b')).toEqual([
      expect.objectContaining({ text: `${FEES} already does this; reuse it.`, conflict_id: c.id }),
    ]);
  });

  it('flags planning to create a symbol id that already exists', () => {
    // Arrange
    const items = [{ symbol_id: FEES, intent: 'create' }];

    // Act
    plan(t, 'agent-b', items);

    // Assert
    expect(duplicates(t)).toHaveLength(1);
    expect(duplicates(t)[0].details).toContain('it already exists');
  });

  it('names the agent that created the existing symbol as agent_a', () => {
    // Arrange: A already created formatDate this run.
    reportChange(t, 'agent-a', A_DATE, 'created', 'formats Nov 7, 2026', 'formatDate(d: Date): string');

    // Act
    plan(t, 'agent-b', [{ symbol_id: B_DATE, intent: 'create' }]);

    // Assert
    expect(duplicates(t)).toEqual([expect.objectContaining({ symbol_id: A_DATE, agent_a: 'agent-a', agent_b: 'agent-b' })]);
  });

  it('opens nothing for a genuinely new helper', () => {
    // Arrange
    const items = [{ symbol_id: 'src/checkout/receipt.ts#renderReceipt', intent: 'create' }];

    // Act
    plan(t, 'agent-b', items);

    // Assert
    expect(duplicates(t)).toHaveLength(0);
    expect(instructionsFor(t, 'agent-b')).toHaveLength(0);
  });

  it.each(['modify', 'depend'])('ignores %s intents', (intent) => {
    // Arrange
    const items = [{ symbol_id: FEES, intent }];

    // Act
    plan(t, 'agent-b', items);

    // Assert
    expect(duplicates(t)).toHaveLength(0);
  });

  it("never flags a symbol the agent created itself (republishing its plan)", () => {
    // Arrange
    plan(t, 'agent-a', [{ symbol_id: A_DATE, intent: 'create' }]);
    reportChange(t, 'agent-a', A_DATE, 'created', 'x', 'formatDate(d: Date): string');

    // Act
    plan(t, 'agent-a', [{ symbol_id: A_DATE, intent: 'create' }], 1n, 'v2');

    // Assert
    expect(duplicates(t)).toHaveLength(0);
  });

  it('dedupes: republishing the same plan adds no conflict or instruction', () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: 'src/checkout/fees.ts#computeFee', intent: 'create' }]);

    // Act
    plan(t, 'agent-b', [{ symbol_id: 'src/checkout/fees.ts#computeFee', intent: 'create' }], 1n, 'v2');

    // Assert
    expect(duplicates(t)).toHaveLength(1);
    expect(instructionsFor(t, 'agent-b')).toHaveLength(1);
  });

  it('a rejected plan leaves no duplicate conflict behind', () => {
    // Arrange
    const items = [
      { symbol_id: 'src/checkout/fees.ts#computeFee', intent: 'create' },
      { symbol_id: 'src/nope.ts#ghost', intent: 'modify' },
    ];

    // Act
    const act = () => plan(t, 'agent-b', items);

    // Assert
    expect(act).toThrow(/unknown symbol/);
    expect(duplicates(t)).toHaveLength(0);
    expect(instructionsFor(t, 'agent-b')).toHaveLength(0);
  });
});

describe("Rule 2 in publish_plan: against other agents' planned creates", () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    for (const id of ['agent-a', 'agent-b', 'agent-c', 'coordinator']) register(t, id);
    plan(t, 'agent-a', [{ symbol_id: A_DATE, intent: 'create' }]);
  });

  it("opens a duplicate between B and A's planned helper, without an instruction yet", () => {
    // Arrange
    const items = [{ symbol_id: B_DATE, intent: 'create' }];

    // Act
    plan(t, 'agent-b', items);

    // Assert
    expect(duplicates(t)).toEqual([
      expect.objectContaining({ symbol_id: A_DATE, agent_a: 'agent-a', agent_b: 'agent-b', status: 'open' }),
    ]);
    expect(duplicates(t)[0].details).toContain("same normalized name 'formatdate'");
    expect(instructionsFor(t, 'agent-b')).toHaveLength(0); // the coordinator decides who keeps it
  });

  it('flags two agents planning the exact same new symbol id', () => {
    // Arrange
    const items = [{ symbol_id: A_DATE, intent: 'create' }];

    // Act
    plan(t, 'agent-b', items);

    // Assert
    expect(duplicates(t)).toHaveLength(1);
    expect(duplicates(t)[0].details).toContain('the same symbol');
  });

  it("ignores an agent's own other planned creates", () => {
    // Arrange
    const items = [
      { symbol_id: A_DATE, intent: 'create' },
      { symbol_id: 'src/utils/date2.ts#getFormatDate', intent: 'create' },
    ];

    // Act
    plan(t, 'agent-a', items);

    // Assert
    expect(duplicates(t)).toHaveLength(0);
  });

  it("ignores another agent's replaced (inactive) plan", () => {
    // Arrange
    plan(t, 'agent-a', [{ symbol_id: FEES, intent: 'modify' }]); // A dropped formatDate

    // Act
    plan(t, 'agent-b', [{ symbol_id: B_DATE, intent: 'create' }]);

    // Assert
    expect(duplicates(t)).toHaveLength(0);
  });

  it('can only match names at plan time: different names with the same purpose are not flagged yet', () => {
    // Arrange: toDisplayDate vs formatDate share only the token "date"; types are unknown in a plan.
    const items = [{ symbol_id: B_DISPLAY, intent: 'create' }];

    // Act
    plan(t, 'agent-b', items);

    // Assert
    expect(duplicates(t)).toHaveLength(0);
  });

  it('flags each matching agent separately', () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: B_DATE, intent: 'create' }]);

    // Act
    plan(t, 'agent-c', [{ symbol_id: 'src/c.ts#makeFormatDate', intent: 'create' }]);

    // Assert
    expect(duplicates(t).map((c) => `${c.agent_a}->${c.agent_b}`).sort()).toEqual(
      ['agent-a->agent-b', 'agent-a->agent-c', 'agent-b->agent-c'].sort(),
    );
  });
});

describe("Rule 2 in report_change('created'): signatures known", () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    for (const id of ['agent-a', 'agent-b']) register(t, id);
    reportChange(t, 'agent-a', A_DATE, 'created', 'formats Nov 7, 2026', 'formatDate(d: Date): string');
  });

  it('flags a same-type helper with a shared name token and tells the creator to reuse', () => {
    // Arrange
    const sig = 'toDisplayDate(value: Date): string';

    // Act
    reportChange(t, 'agent-b', B_DISPLAY, 'created', 'receipt date', sig);

    // Assert
    const [c] = duplicates(t);
    expect(c).toMatchObject({ symbol_id: A_DATE, agent_a: 'agent-a', agent_b: 'agent-b' });
    expect(c.details).toContain("shared name 'date'");
    expect(instructionsFor(t, 'agent-b').map((i) => i.text)).toEqual([`${A_DATE} already does this; reuse it.`]);
  });

  it('does not flag a same-name-token helper with different types', () => {
    // Arrange
    const sig = 'parseDisplayDate(s: string): Date';

    // Act
    reportChange(t, 'agent-b', 'src/checkout/receipt.ts#parseDisplayDate', 'created', 'x', sig);

    // Assert
    expect(duplicates(t)).toHaveLength(0);
  });

  it('does not flag the very symbol being created', () => {
    // Arrange: A reports the same creation again (e.g. the hook fired twice).

    // Act
    reportChange(t, 'agent-a', A_DATE, 'created', 'again', 'formatDate(d: Date): string');

    // Assert
    expect(duplicates(t)).toHaveLength(0);
  });
});

describe('spec section 14: duplicate helper, with Contract', () => {
  it("B's planned formatter matches A's; coordinator tells B to reuse A's", () => {
    // Arrange
    const t = makeHarness();
    seedCodeMap(t);
    for (const id of ['agent-a', 'agent-b', 'coordinator']) register(t, id);
    plan(t, 'agent-a', [
      { symbol_id: FEES, intent: 'modify' },
      { symbol_id: A_DATE, intent: 'create' },
    ]);

    // Act 1: B plans its own date formatter.
    plan(t, 'agent-b', [{ symbol_id: B_DATE, intent: 'create' }]);
    const [c] = duplicates(t);

    // Act 2: coordinator decides A owns the formatter.
    t.as('coordinator', (ctx) =>
      mod.resolve_conflict(ctx, {
        conflict_id: c.id,
        owner_agent: 'agent-a',
        instructions_a: 'Create formatDate in src/utils/date.ts; B will import it.',
        instructions_b: `Do not write ${B_DATE}; import formatDate from src/utils/date.ts.`,
        reason: 'One date formatter; check-dupes fails on two.',
      }),
    );

    // Assert
    expect(c).toMatchObject({ symbol_id: A_DATE, agent_a: 'agent-a', agent_b: 'agent-b' });
    expect(t.db.conflict.id.find(c.id)!.status).toBe('resolved');
    expect(instructionsFor(t, 'agent-b').map((i) => i.text)).toEqual([
      `Do not write ${B_DATE}; import formatDate from src/utils/date.ts.`,
    ]);
  });
});
