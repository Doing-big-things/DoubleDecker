import { describe, expect, it } from 'vitest';
import { add, formatMoney, money, multiply } from './money';

describe('money', () => {
  it('rejects fractions of a cent', () => {
    expect(() => money(10.5)).toThrow();
  });

  it('adds cents', () => {
    expect(add(money(150), money(275)).cents).toBe(425);
  });

  it('rounds half up when multiplying', () => {
    expect(multiply(money(333), 1.5).cents).toBe(500);
  });

  it('prints dollars and cents', () => {
    expect(formatMoney(money(1999))).toBe('$19.99');
  });
});
