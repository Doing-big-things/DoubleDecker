import { beforeEach, describe, expect, it } from 'vitest';
import { Inventory } from './index';
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
});
