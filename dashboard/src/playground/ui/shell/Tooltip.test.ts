import { afterEach, describe, expect, it } from 'vitest';
import { registerAction } from '../../core/actions';
import { tipForAction } from './Tooltip';

let off = () => {};
afterEach(() => off());

describe('tipForAction', () => {
  it('reads label and shortcut from the registry', () => {
    off = registerAction({ id: 't.rect', title: 'Rectangle', group: 'Tools', keys: { all: ['r'] }, contexts: ['canvas'], run() {} });
    expect(tipForAction('t.rect', 'mac')).toEqual({ label: 'Rectangle', keys: ['R'], reason: undefined });
  });
  it('shows the reason when unavailable and null for unknown ids', () => {
    off = registerAction({ id: 't.no', title: 'Group', group: 'Edit', keys: { win: ['Mod+g'] }, contexts: ['canvas'], when: () => 'Select 2 layers', run() {} });
    expect(tipForAction('t.no', 'win')).toEqual({ label: 'Group', keys: ['Ctrl+G'], reason: 'Select 2 layers' });
    expect(tipForAction('nope')).toBeNull();
  });
});
