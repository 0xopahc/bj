import { describe, expect, it } from 'vitest';
import { dollarsToCents, formatSignedUsd, formatUsd } from '../src/shared/money.ts';

describe('money', () => {
  it('formats whole dollars and cents', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(10_000_000)).toBe('$100,000.00');
    expect(formatUsd(-250)).toBe('-$2.50');
    expect(formatSignedUsd(150)).toBe('+$1.50');
    expect(formatSignedUsd(-150)).toBe('-$1.50');
  });

  it('parses operator dollar input', () => {
    expect(dollarsToCents('25')).toBe(2500);
    expect(dollarsToCents('-10.5')).toBe(-1050);
    expect(dollarsToCents('10.50')).toBe(1050);
    expect(dollarsToCents('1.234')).toBeNull();
    expect(dollarsToCents('abc')).toBeNull();
  });
});
