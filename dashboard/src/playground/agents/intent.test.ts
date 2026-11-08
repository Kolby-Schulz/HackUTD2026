import { describe, expect, it } from 'vitest';
import { HELP, editCommands, parseEdit, pickTemplate } from './intent';
import { mkShape } from './fakes.test';

const rect = mkShape('r', { name: 'Box', x: 100, y: 100, w: 100, h: 80, radius: 8 });
const text = mkShape('t', { kind: 'text', name: 'Title', w: 200, h: 30, fontSize: 20, fills: [] });

describe('pickTemplate', () => {
  it('matches keywords like the old engine', () => {
    expect(pickTemplate('build a profile card')?.name).toBe('Profile card');
    expect(pickTemplate('a mobile app screen')?.name).toBe('Mobile · Tasks');
    expect(pickTemplate('revenue widget please')?.name).toBe('Stat widget');
    expect(pickTemplate('a landing page')?.name).toBe('Hero section');
    expect(pickTemplate('hello there')).toBeUndefined();
  });
});

describe('parseEdit', () => {
  it('delete', () => {
    expect(parseEdit('please delete this', rect)).toEqual({ remove: true, patch: {}, summary: ['removed Box'] });
    expect(editCommands('r', parseEdit('remove it', rect)!)).toEqual([{ t: 'shape.delete', ids: ['r'] }]);
  });
  it('colours: names and hex, fill vs text colour', () => {
    expect(parseEdit('make it blue', rect)).toEqual({ patch: { fills: [{ type: 'solid', color: '#3b82f6' }] }, summary: ['fill is now blue'] });
    expect(parseEdit('use #ff0000', rect)!.summary).toEqual(['fill is now #ff0000']);
    expect(parseEdit('make it purple', text)).toEqual({ patch: { color: '#a855f7' }, summary: ['text color is now purple'] });
  });
  it('bigger grows around the centre; text scales the font', () => {
    const e = parseEdit('bigger', rect)!;
    expect(e.patch).toMatchObject({ w: 125, h: 100, x: 87.5, y: 90 });
    expect(parseEdit('smaller', text)!.patch).toMatchObject({ fontSize: 16, w: 160, h: 24 });
  });
  it('corners, bold and quoted text', () => {
    expect(parseEdit('rounder', rect)!.patch.radius).toBe(20);
    expect(parseEdit('make it a pill', rect)!.patch.radius).toBe(40);
    expect(parseEdit('sharp', rect)!.patch.radius).toBe(0);
    expect(parseEdit('rounder', text)).toBeNull();
    expect(parseEdit('bold', text)!.patch).toEqual({ fontWeight: 700 });
    expect(parseEdit('say "Hello world"', text)!.patch).toEqual({ text: 'Hello world', name: 'Hello world' });
    expect(parseEdit('call it "Hero"', rect)!.patch).toEqual({ name: 'Hero' });
  });
  it('unknown text yields null and there is a HELP string', () => {
    expect(parseEdit('dance', rect)).toBeNull();
    expect(HELP).toContain('scripted demo agent');
  });
  it('update command', () => {
    expect(editCommands('r', parseEdit('bold "x"', text)!)).toEqual([{ t: 'shape.update', ids: ['r'], patch: { fontWeight: 700, text: 'x', name: 'x' } }]);
  });
});
