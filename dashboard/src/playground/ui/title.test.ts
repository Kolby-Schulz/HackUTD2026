import { describe, expect, it } from 'vitest';
import { composeTitle } from './title';

describe('composeTitle', () => {
  it('adds the unread count in front of the file name', () => {
    expect(composeTitle('Landing page', 0)).toBe('Landing page · Playground');
    expect(composeTitle('Landing page', 3)).toBe('(3) Landing page · Playground');
  });
});
