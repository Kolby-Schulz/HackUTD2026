import { describe, expect, it } from 'vitest';
import { exportFileName } from './share';

describe('exportFileName', () => {
  it('uses the layer name and @Nx suffix', () => {
    expect(exportFileName(['Hero'], 2)).toBe('Hero@2x.png');
    expect(exportFileName(['Hero'], 1)).toBe('Hero.png');
  });
  it('counts several layers and strips path characters', () => {
    expect(exportFileName(['a', 'b'], 3)).toBe('2 layers@3x.png');
    expect(exportFileName(['a/b:c'], 1)).toBe('a-b-c.png');
  });
});
