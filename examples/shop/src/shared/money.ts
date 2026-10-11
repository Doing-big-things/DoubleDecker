/** An amount of money in whole cents. */
export interface Money {
  cents: number;
  currency: 'USD';
}

/** Make an amount from a whole number of cents. */
export function money(cents: number): Money {
  if (!Number.isInteger(cents)) throw new Error('Money is counted in whole cents');
  return { cents, currency: 'USD' };
}

/** Add two amounts. */
export function add(a: Money, b: Money): Money {
  return money(a.cents + b.cents);
}

/** Multiply an amount, rounding half up. */
export function multiply(a: Money, factor: number): Money {
  return money(Math.round(a.cents * factor));
}

/** Print an amount as dollars and cents. */
export function formatMoney(a: Money): string {
  return `$${(a.cents / 100).toFixed(2)}`;
}
