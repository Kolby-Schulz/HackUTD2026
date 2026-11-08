import { describe, expect, it } from 'vitest';
import { evalNumber, formatNumber } from './numexpr';

describe('evalNumber', () => {
  it('handles + - * / and parentheses with precedence', () => {
    expect(evalNumber('100+20')).toBe(120);
    expect(evalNumber('120*2')).toBe(240);
    expect(evalNumber('100/2+8')).toBe(58);
    expect(evalNumber('(10+5)/3')).toBe(5);
    expect(evalNumber('2+3*4')).toBe(14);
    expect(evalNumber('2*(3+4)*2')).toBe(28);
    expect(evalNumber('((1+1))')).toBe(2);
    expect(evalNumber('3 - -2')).toBe(5);
  });
  it('strips units and reads percent relative to the current value', () => {
    expect(evalNumber('24px')).toBe(24);
    expect(evalNumber('45deg')).toBe(45);
    expect(evalNumber('10px + 5px')).toBe(15);
    expect(evalNumber('50%', 200)).toBe(100);
    expect(evalNumber('50%', 0)).toBe(0);
  });
  it('treats a leading sign as relative', () => {
    expect(evalNumber('+10', 200)).toBe(210);
    expect(evalNumber('-10', 200)).toBe(190);
    expect(evalNumber('+10', 5)).toBe(15);
  });
  it('accepts a locale comma and dots', () => {
    expect(evalNumber('1,5')).toBe(1.5);
    expect(evalNumber('.5')).toBe(0.5);
    expect(evalNumber('1,000.5')).toBe(1000.5);
  });
  it('rounds to 2 decimals and clamps', () => {
    expect(evalNumber('10/3')).toBe(3.33);
    expect(evalNumber('1e9')).toBeNull();
    expect(evalNumber('999999*999999')).toBe(1e6);
    expect(evalNumber('-999999*999999')).toBe(-1e6);
    expect(evalNumber('150', 0, { max: 100 })).toBe(100);
    expect(evalNumber('-5', 0, { min: 0 })).toBe(0);
  });
  it('rejects garbage', () => {
    for (const bad of ['', '  ', 'abc', '1/0', '(1', '1)', '1+', '*2', '1..2', 'w/2', '1 2', 'alert(1)', '2**3', '%', '1+*2']) {
      expect(evalNumber(bad, 10), bad).toBeNull();
    }
    expect(evalNumber('('.repeat(500) + '1' + ')'.repeat(500))).toBeNull();
    expect(evalNumber('1+'.repeat(200) + '1')).toBeNull(); // over the length cap
  });
  it('never returns -0', () => {
    expect(Object.is(evalNumber('-0'), 0)).toBe(true);
  });
});

describe('formatNumber', () => {
  it('trims trailing zeros', () => {
    expect(formatNumber(12)).toBe('12');
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(1.23456)).toBe('1.23');
    expect(formatNumber(-0.001)).toBe('0');
  });
});
