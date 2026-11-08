import { describe, expect, it } from 'vitest';
import { avatarStack, toneOf } from './PresenceList';

describe('PresenceList helpers', () => {
  it('maps agent states to tones', () => {
    expect(toneOf('drawing')).toBe('working');
    expect(toneOf('waiting_user')).toBe('waiting');
    expect(toneOf('error')).toBe('blocked');
    expect(toneOf('paused')).toBe('off');
    expect(toneOf(undefined)).toBe('idle');
  });
  it('stacks humans first and counts the overflow', () => {
    const all = [...Array.from({ length: 6 }, () => ({ kind: 'agent' })), { kind: 'human' }];
    const { shown, more } = avatarStack(all);
    expect(shown[0]!.kind).toBe('human');
    expect(shown).toHaveLength(5);
    expect(more).toBe(2);
  });
});
