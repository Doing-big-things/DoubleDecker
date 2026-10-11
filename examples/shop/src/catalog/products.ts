import { type Money, money } from '../shared/money';
import { fail, ok, type Result } from '../shared/result';
import type { Product } from './product-store';

export interface ProductDraft {
  sku: string;
  name: string;
  priceCents: number;
}

/** Check a product draft before it is published. */
export function validateDraft(draft: ProductDraft): Result<Product> {
  const problems: string[] = [];
  if (!draft.sku.trim()) problems.push('A product needs a sku');
  if (!draft.name.trim()) problems.push('A product needs a name');
  if (!Number.isInteger(draft.priceCents) || draft.priceCents <= 0)
    problems.push('A product needs a positive price');
  if (problems.length) return fail(problems);
  return ok({
    sku: draft.sku.trim(),
    name: draft.name.trim(),
    price: money(draft.priceCents),
    discontinued: false,
  });
}

/** The price a customer pays for one unit today. */
export function priceOf(product: Product): Money {
  return product.price;
}
