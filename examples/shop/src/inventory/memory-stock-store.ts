import type { Sku } from '../shared/types';
import type { StockLevel, StockStore } from './stock-store';

/** Keeps stock in memory, for tests and demos. */
export class MemoryStockStore implements StockStore {
  private levels = new Map<Sku, number>();

  read(sku: Sku): StockLevel {
    return { sku, units: this.levels.get(sku) ?? 0 };
  }

  write(sku: Sku, units: number): void {
    this.levels.set(sku, units);
  }
}
