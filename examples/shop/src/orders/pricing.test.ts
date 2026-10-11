import { beforeEach, describe, expect, it } from 'vitest';
import { Catalog } from '../catalog';
import { ProductStore } from '../catalog/product-store';
import { addItem, emptyCart } from './cart';
import { lineTotal, totalOf } from './pricing';

describe('pricing', () => {
  let catalog: Catalog;

  beforeEach(() => {
    catalog = new Catalog(new ProductStore());
    catalog.publish({ sku: 'mug', name: 'Mug', priceCents: 1200 });
    catalog.publish({ sku: 'tee', name: 'T-shirt', priceCents: 2500 });
  });

  it('multiplies price by quantity', () => {
    expect(lineTotal({ sku: 'mug', quantity: 3 }, catalog).cents).toBe(3600);
  });

  it('adds every line', () => {
    const cart = addItem(addItem(emptyCart(), 'mug', 2), 'tee', 1);
    expect(totalOf(cart, catalog).cents).toBe(4900);
  });

  it('totals an empty cart to zero', () => {
    expect(totalOf(emptyCart(), catalog).cents).toBe(0);
  });
});
