import type { Sku } from '../shared/types';

export interface StockLevel {
  sku: Sku;
  units: number;
}

/** The contract every stock backend implements. */
export interface StockStore {
  /** Read the stock level for a product. */
  read(sku: Sku): StockLevel;
  /** Replace the stock level for a product. */
  write(sku: Sku, units: number): void;
}
