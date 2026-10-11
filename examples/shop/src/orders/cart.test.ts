import { describe, expect, it } from 'vitest';
import { addItem, emptyCart, removeItem } from './cart';

describe('cart', () => {
  it('adds a new line', () => {
    expect(addItem(emptyCart(), 'mug', 2).items).toEqual([{ sku: 'mug', quantity: 2 }]);
  });

  it('merges a repeated item', () => {
    const cart = addItem(addItem(emptyCart(), 'mug', 2), 'mug', 3);
    expect(cart.items).toEqual([{ sku: 'mug', quantity: 5 }]);
  });

  it('rejects a quantity of zero', () => {
    expect(() => addItem(emptyCart(), 'mug', 0)).toThrow('positive whole number');
  });

  it('removes a line', () => {
    expect(removeItem(addItem(emptyCart(), 'mug', 1), 'mug').items).toEqual([]);
  });
});
