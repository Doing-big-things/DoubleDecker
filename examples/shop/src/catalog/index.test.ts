import { beforeEach, describe, expect, it } from 'vitest';
import { Catalog } from './index';
import { ProductStore } from './product-store';

describe('Catalog', () => {
  let catalog: Catalog;

  beforeEach(() => {
    catalog = new Catalog(new ProductStore());
    catalog.publish({ sku: 'mug', name: 'Mug', priceCents: 1200 });
    catalog.publish({ sku: 'tee', name: 'T-shirt', priceCents: 2500 });
  });

  it('lists products in a stable order', () => {
    expect(catalog.list().map((p) => p.sku)).toEqual(['mug', 'tee']);
  });

  it('looks up one product', () => {
    expect(catalog.get('mug').name).toBe('Mug');
  });

  it('fails for an unknown product', () => {
    expect(() => catalog.get('nope')).toThrow('was not found');
  });

  it('rejects an invalid draft', () => {
    expect(() => catalog.publish({ sku: 'x', name: '', priceCents: 0 })).toThrow('needs a name');
  });

  it('hides a discontinued product from the list but keeps it for old orders', () => {
    catalog.discontinue('mug');
    expect(catalog.list().map((p) => p.sku)).toEqual(['tee']);
    expect(catalog.get('mug').discontinued).toBe(true);
  });
});
