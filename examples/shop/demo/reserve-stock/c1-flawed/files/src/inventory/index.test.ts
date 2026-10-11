import { beforeEach, describe, expect, it } from 'vitest';
import { Inventory, StockUnavailable } from './index';
import { MemoryStockStore } from './memory-stock-store';

describe('Inventory', () => {
  let inventory: Inventory;

  beforeEach(() => {
    inventory = new Inventory(new MemoryStockStore());
    inventory.receive('mug', 5);
  });

  it('reports zero for a product never stocked', () => {
    expect(inventory.available('tee')).toBe(0);
  });

  it('adds a delivery to stock', () => {
    inventory.receive('mug', 3);
    expect(inventory.available('mug')).toBe(8);
  });

  it('rejects a delivery of nothing', () => {
    expect(() => inventory.receive('mug', 0)).toThrow('positive number');
  });

  it('adjusts stock down', () => {
    inventory.adjust('mug', -2);
    expect(inventory.available('mug')).toBe(3);
  });

  it('never lets stock go below zero', () => {
    expect(() => inventory.adjust('mug', -6)).toThrow('below zero');
    expect(inventory.available('mug')).toBe(5);
  });

  it('reserves nothing when one item is short', () => {
    const items = [
      { sku: 'mug', quantity: 2 },
      { sku: 'tee', quantity: 1 },
    ];
    expect(() => inventory.reserve('ord_1', items, 'key-1')).toThrow(StockUnavailable);
    expect(inventory.available('mug')).toBe(5);
  });

  it('does not reserve twice for a repeated key', () => {
    inventory.reserve('ord_1', [{ sku: 'mug', quantity: 2 }], 'key-1');
    inventory.reserve('ord_1', [{ sku: 'mug', quantity: 2 }], 'key-1');
    expect(inventory.available('mug')).toBe(3);
  });

  it('reports which items are unavailable', () => {
    try {
      inventory.reserve('ord_1', [{ sku: 'tee', quantity: 1 }], 'key-1');
      throw new Error('expected the reservation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(StockUnavailable);
      expect((error as StockUnavailable).unavailable).toEqual(['tee']);
    }
  });

  it('gives reserved stock back when released', () => {
    inventory.reserve('ord_1', [{ sku: 'mug', quantity: 2 }], 'key-1');
    inventory.release('key-1');
    expect(inventory.available('mug')).toBe(5);
  });
});
