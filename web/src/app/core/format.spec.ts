import { fmt, formatCoins } from './format';

describe('formatting', () => {
  it('formats coins compactly', () => {
    expect(formatCoins(12)).toBe('12');
    expect(formatCoins(0.5)).toMatch(/0[.,]5/);
    expect(formatCoins(12_345)).toMatch(/12[.,]3\d?K/);
    expect(formatCoins(Infinity)).toBe('∞');
  });

  it('keeps numbers and units together with non-breaking spaces', () => {
    expect(fmt.duration(3_725)).toBe('1 h 2 min');
    expect(fmt.duration(42)).toBe('42 s');
    expect(fmt.km(1_483)).toContain(' km');
    expect(fmt.kg(25_400)).toContain(' t');
  });
});
