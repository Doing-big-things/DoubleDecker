import type { Money } from '../shared/money';
import type { Sku } from '../shared/types';

export interface Product {
  sku: Sku;
  name: string;
  price: Money;
  discontinued: boolean;
}

/** Keeps products in memory. */
export class ProductStore {
  private products = new Map<Sku, Product>();

  find(sku: Sku): Product | undefined {
    return this.products.get(sku);
  }

  save(product: Product): void {
    this.products.set(product.sku, product);
  }

  all(): Product[] {
    return [...this.products.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }
}
