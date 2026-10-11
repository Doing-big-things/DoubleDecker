import { describe, expect, it } from 'vitest';
import { priceOf, validateDraft } from './products';

describe('validateDraft', () => {
  it('accepts a complete draft', () => {
    const result = validateDraft({ sku: ' mug ', name: 'Mug', priceCents: 1200 });
    expect(result.ok && result.value.sku).toBe('mug');
  });

  it('requires a positive price', () => {
    const result = validateDraft({ sku: 'mug', name: 'Mug', priceCents: -5 });
    expect(result.ok).toBe(false);
  });

  it('reports every problem at once', () => {
    const result = validateDraft({ sku: '', name: '', priceCents: 0 });
    expect(!result.ok && result.problems).toHaveLength(3);
  });
});

describe('priceOf', () => {
  it('returns the list price', () => {
    const result = validateDraft({ sku: 'mug', name: 'Mug', priceCents: 1200 });
    if (!result.ok) throw new Error('expected a valid draft');
    expect(priceOf(result.value).cents).toBe(1200);
  });
});
