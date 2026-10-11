import { describe, expect, it } from 'vitest';
import { MemoryStockStore } from './memory-stock-store';

describe('MemoryStockStore', () => {
  it('reads zero for an unknown product', () => {
    expect(new MemoryStockStore().read('mug').units).toBe(0);
  });

  it('reads what was written', () => {
    const store = new MemoryStockStore();
    store.write('mug', 7);
    expect(store.read('mug')).toEqual({ sku: 'mug', units: 7 });
  });
});
