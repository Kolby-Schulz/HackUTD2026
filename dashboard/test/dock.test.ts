// Drag-and-drop rules for editor tabs: only offer drops that would change something.
import { describe, expect, it } from 'vitest';
import { dropTargets, tabDropUseful } from '../src/Dock.tsx';
import { people, type Tables } from '../src/model.ts';

describe('dock drops', () => {
  it('offers no move or split when a tab is dragged onto its own one-tab group', () => {
    expect(dropTargets({ views: ['chat'] }, 'chat')).toEqual({ move: false, split: false });
  });
  it('offers split but not "move here" on the group the tab is already in', () => {
    expect(dropTargets({ views: ['map', 'control'] }, 'control')).toEqual({ move: false, split: true });
  });
  it('offers both on another group', () => {
    expect(dropTargets({ views: ['map'] }, 'chat')).toEqual({ move: true, split: true });
  });
  it('ignores dropping a tab back on its own slot in the strip', () => {
    const g = { views: ['map', 'control', 'changes'] as const };
    // control sits at index 1: dropping before it (1) or after it (2) leaves it where it is
    expect(tabDropUseful({ views: [...g.views] }, 'control', 1)).toBe(false);
    expect(tabDropUseful({ views: [...g.views] }, 'control', 2)).toBe(false);
    expect(tabDropUseful({ views: [...g.views] }, 'control', 0)).toBe(true);
    expect(tabDropUseful({ views: [...g.views] }, 'control', 3)).toBe(true);
    expect(tabDropUseful({ views: ['map'] }, 'chat', 0)).toBe(true);
  });
});

describe('agent letters', () => {
  it('takes the letter after the "agent" prefix, however it is written', () => {
    const agent = (id: string, name: string) => ({ id, name }) as unknown as Tables['agents'][number];
    const p = people([agent('agent-a', 'agent-a'), agent('agent-b', 'agent-b'), agent('x', 'Agent C'), agent('j', 'agent_judge'), agent('k', 'Kim')]);
    expect(['agent-a', 'agent-b', 'x', 'j', 'k'].map((id) => p.get(id)!.letter)).toEqual(['A', 'B', 'C', 'J', 'K']);
  });
});
