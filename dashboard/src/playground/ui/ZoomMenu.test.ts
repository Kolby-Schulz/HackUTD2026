import { describe, expect, it } from 'vitest';
import { parseZoomInput, zoomLabel } from './ZoomMenu';

describe('zoom input', () => {
  it('parses plain and percent values', () => {
    expect(parseZoomInput('250')).toBe(2.5);
    expect(parseZoomInput(' 150 % ')).toBe(1.5);
    expect(parseZoomInput('33.5%')).toBeCloseTo(0.335);
  });
  it('clamps to the camera range', () => {
    expect(parseZoomInput('999999')).toBe(256);
    expect(parseZoomInput('0.1')).toBe(0.02);
  });
  it('rejects junk and zero', () => {
    for (const s of ['', 'abc', '-5', '0', '12x', '%']) expect(parseZoomInput(s)).toBeNull();
  });
  it('labels', () => {
    expect(zoomLabel(2.5)).toBe('250%');
    expect(zoomLabel(0.004)).toBe('<1%');
  });
});
