import { invalid } from '../shared/errors';
import type { LineItem, Sku } from '../shared/types';

/** What a customer intends to buy. */
export interface Cart {
  items: LineItem[];
}

export function emptyCart(): Cart {
  return { items: [] };
}

/** Add an item, merging it with a line that is already there. */
export function addItem(cart: Cart, sku: Sku, quantity: number): Cart {
  if (!Number.isInteger(quantity) || quantity <= 0)
    throw invalid('A quantity must be a positive whole number');
  const existing = cart.items.find((i) => i.sku === sku);
  if (!existing) return { items: [...cart.items, { sku, quantity }] };
  return { items: cart.items.map((i) => (i.sku === sku ? { sku, quantity: i.quantity + quantity } : i)) };
}

/** Remove an item from the cart. */
export function removeItem(cart: Cart, sku: Sku): Cart {
  return { items: cart.items.filter((i) => i.sku !== sku) };
}
