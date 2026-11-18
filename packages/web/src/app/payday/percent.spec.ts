import { parsePercent, plainPercent } from './percent';

describe('parsePercent', () => {
  it.each([
    ['20', 2_000],
    ['12.5', 1_250],
    ['0.05', 5],
    ['100', 10_000],
    ['100.00', 10_000],
    [' 7 % ', 700],
    ['0', 0],
  ])('reads %s as %i basis points', (text, expected) => {
    expect(parsePercent(text)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '100.01', '101', '12.345', '1,5', '1e2', '.5', '5.'])(
    'refuses %j',
    (text) => {
      expect(parsePercent(text)).toBeNull();
    },
  );
});

describe('plainPercent', () => {
  it('writes whole percentages without decimals and trims a trailing zero', () => {
    expect(plainPercent(2_000)).toBe('20');
    expect(plainPercent(1_250)).toBe('12.5');
    expect(plainPercent(5)).toBe('0.05');
    expect(plainPercent(10_000)).toBe('100');
  });

  it('round-trips through parsePercent', () => {
    for (const bp of [0, 1, 5, 10, 99, 100, 1_250, 3_333, 9_999, 10_000]) {
      expect(parsePercent(plainPercent(bp))).toBe(bp);
    }
  });
});
