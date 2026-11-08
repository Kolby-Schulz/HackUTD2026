import { describe, expect, it } from 'vitest';
import { MAX_PASTE_CHARS, normalizePaste } from './TextEditor';

describe('normalizePaste', () => {
  it('normalises newlines', () => expect(normalizePaste('a\r\nb\rc').text).toBe('a\nb\nc'));
  it('truncates huge pastes', () => {
    const r = normalizePaste('x'.repeat(MAX_PASTE_CHARS + 5));
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(MAX_PASTE_CHARS);
  });
});
