import { invalid, notFound } from '../shared/errors';
import type { Sku } from '../shared/types';
import type { Product, ProductStore } from './product-store';
import { type ProductDraft, validateDraft } from './products';

/** What the shop sells. */
export class Catalog {
  private store: ProductStore;

  constructor(store: ProductStore) {
    this.store = store;
  }

  /** List the products on sale. */
  list(): Product[] {
    return this.store.all().filter((p) => !p.discontinued);
  }

  /** Look up one product. */
  get(sku: Sku): Product {
    const product = this.store.find(sku);
    if (!product) throw notFound(`Product ${sku}`);
    return product;
  }

  /** Publish a new product. */
  publish(draft: ProductDraft): Product {
    const checked = validateDraft(draft);
    if (!checked.ok) throw invalid(checked.problems.join('; '));
    this.store.save(checked.value);
    return checked.value;
  }

  /** Stop selling a product without deleting it. */
  discontinue(sku: Sku): void {
    this.store.save({ ...this.get(sku), discontinued: true });
  }
}
