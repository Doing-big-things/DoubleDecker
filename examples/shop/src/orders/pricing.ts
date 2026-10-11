import type { Catalog } from '../catalog';
import { priceOf } from '../catalog/products';
import { type Money, add, money, multiply } from '../shared/money';
import type { LineItem } from '../shared/types';
import type { Cart } from './cart';

/** Price one line of a cart. */
export function lineTotal(item: LineItem, catalog: Catalog): Money {
  return multiply(priceOf(catalog.get(item.sku)), item.quantity);
}

/** Total a cart at today's prices. */
export function totalOf(cart: Cart, catalog: Catalog): Money {
  return cart.items.reduce((sum, item) => add(sum, lineTotal(item, catalog)), money(0));
}
