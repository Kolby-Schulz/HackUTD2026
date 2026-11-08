import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VirtualList, computeWindow, scrollTopFor } from './VirtualList';

describe('computeWindow', () => {
  it('mounts the viewport plus overscan', () => {
    expect(computeWindow(5000, 28, 0, 560, 10)).toEqual({ start: 0, end: 30 });
    expect(computeWindow(5000, 28, 28 * 1000, 560, 10)).toEqual({ start: 990, end: 1030 });
  });
  it('clamps at the end and handles empty', () => {
    expect(computeWindow(50, 28, 28 * 49, 560, 10).end).toBe(50);
    expect(computeWindow(0, 28, 0, 560)).toEqual({ start: 0, end: 0 });
  });
});

describe('scrollTopFor', () => {
  it('returns null when already visible, else the minimal scroll', () => {
    expect(scrollTopFor(3, 28, 0, 280, 100)).toBeNull();
    expect(scrollTopFor(50, 28, 0, 280, 100)).toBe(50 * 28 + 28 - 280);
    expect(scrollTopFor(2, 28, 28 * 20, 280, 100)).toBe(56);
  });
  it('supports start/center and clamps to the end', () => {
    expect(scrollTopFor(40, 28, 0, 280, 100, 'start')).toBe(1120);
    expect(scrollTopFor(99, 28, 0, 280, 100, 'start')).toBe(100 * 28 - 280);
    expect(scrollTopFor(40, 28, 0, 280, 100, 'center')).toBe(40 * 28 - (280 - 28) / 2);
  });
});

describe('VirtualList', () => {
  const items = Array.from({ length: 5000 }, (_, i) => i);
  const render = (extra = {}) => renderToStaticMarkup(createElement(VirtualList<number>, {
    items, getKey: (n) => String(n), renderRow: (n) => createElement('span', { className: 'r' }, `row ${n}`),
    initialHeight: 560, ...extra,
  }));

  it('renders only the visible window for 5,000 rows', () => {
    const html = render();
    const rows = html.match(/class="r"/g) ?? [];
    expect(rows.length).toBe(30);
    expect(rows.length).toBeLessThan(80);
    expect(html).toContain('row 0');
    expect(html).not.toContain('row 4999');
    expect(html).toContain(`height:${5000 * 28}px`);
  });

  it('keeps pinned rows mounted', () => {
    const html = render({ pinnedIndexes: [4000] });
    expect(html).toContain('row 4000');
    expect(html.match(/class="r"/g)?.length).toBe(31);
  });
});
