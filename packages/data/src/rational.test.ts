import { describe, expect, test } from 'vitest';
import { add, div, mul, parseRational, rat, toNumber, toString } from './rational';

describe('parseRational', () => {
  test.each([
    ['3', '3'],
    ['-7.5', '-15/2'],
    ['0.75', '3/4'],
    ['1/3', '1/3'],
    ['10/3', '10/3'],
    ['-30', '-30'],
    ['1 1/3', '4/3'],
    ['-1 1/3', '-4/3'],
    ['1321929/1000000', '1321929/1000000'],
    [' 2.40 ', '12/5'],
  ])('%s → %s', (text, expected) => {
    expect(toString(parseRational(text)!)).toBe(expected);
  });

  test.each(['', 'abc', '1/0', '1.2.3', '1 1/0', '3x', '--1', '1 /3'])('rejects %j', (text) => {
    expect(parseRational(text)).toBeUndefined();
  });

  test('stays exact where floats would not', () => {
    const third = rat(1, 3);
    expect(toString(add(add(third, third), third))).toBe('1');
    expect(toString(mul(div(rat(60), parseRational('10/3')!), rat(1)))).toBe('18');
    expect(toNumber(rat(1, 3))).toBeCloseTo(1 / 3, 15);
  });
});
