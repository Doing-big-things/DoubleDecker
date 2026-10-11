import { invalid } from '../shared/errors';
import type { Sku } from '../shared/types';
import type { StockStore } from './stock-store';

/** Tracks how many units of each product are in stock. */
export class Inventory {
  private store: StockStore;

  constructor(store: StockStore) {
    this.store = store;
  }

  /** Report how many units can be sold. */
  available(sku: Sku): number {
    return this.store.read(sku).units;
  }

  /** Add a delivery to stock. */
  receive(sku: Sku, units: number): void {
    if (!Number.isInteger(units) || units <= 0) throw invalid('A delivery needs a positive number of units');
    this.store.write(sku, this.available(sku) + units);
  }

  /** Adjust stock by hand, never below zero. */
  adjust(sku: Sku, delta: number): void {
    const next = this.available(sku) + delta;
    if (next < 0) throw invalid(`Stock for ${sku} cannot go below zero`);
    this.store.write(sku, next);
  }
}
