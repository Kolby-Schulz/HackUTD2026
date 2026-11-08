import { describe, it, expect } from 'vitest';
import { DEFAULT_CODING_STEP_TOKENS, earlyStopEstimate, resumeInstructions, type TokenLogLine } from '../src/resume.ts';

const line = (o: Partial<TokenLogLine>): TokenLogLine => ({ agentId: 'agent-a', mode: 'without_contract', purpose: 'code', completion_tokens: 0, ...o });
const instr = (id: bigint, text: string, conflictId?: bigint) => ({ id, agentId: 'agent-b', text, acknowledged: false, ...(conflictId !== undefined ? { conflictId } : {}) });

describe('earlyStopEstimate', () => {
  it('averages full baseline coding steps and subtracts what was already generated', () => {
    // Arrange
    const log = [
      line({ completion_tokens: 3000 }),
      line({ completion_tokens: 5000 }),
      line({ completion_tokens: 99_999, estimated: true }), // a stopped run, not a full step
      line({ completion_tokens: 99_999, mode: 'with_contract' }),
      line({ completion_tokens: 99_999, purpose: 'merge_fix' }),
    ];

    // Act
    const r = earlyStopEstimate(log, 1000);

    // Assert
    expect(r).toEqual({ tokens: 3000, fromBaseline: true });
  });

  it('falls back to the default without a baseline, and never goes negative', () => {
    // Act
    const none = earlyStopEstimate([], 0);
    const over = earlyStopEstimate([line({ completion_tokens: 100 })], 500);

    // Assert
    expect(none).toEqual({ tokens: DEFAULT_CODING_STEP_TOKENS, fromBaseline: false });
    expect(over.tokens).toBe(0);
  });
});

describe('resumeInstructions', () => {
  it("keeps only the decision for a conflict, not the earlier 'pause' notice", () => {
    // Arrange
    const pending = [
      instr(1n, 'fees.ts#calculateFee was changed by agent-a. Pause and wait for the coordinator.', 9n),
      instr(2n, 'Reuse formatDate.'),
      instr(3n, 'Do not round again in checkout.', 9n),
    ];

    // Act
    const r = resumeInstructions(pending);

    // Assert
    expect(r.map((i) => i.text)).toEqual(['Reuse formatDate.', 'Do not round again in checkout.']);
  });
});
