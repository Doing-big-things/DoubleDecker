import { describe, expect, it } from 'vitest';
import { notFound } from '../shared/errors';
import { createShop } from './app';
import { Router } from './router';

describe('Router', () => {
  it('runs the matching handler with its path parameters', () => {
    const router = new Router();
    router.add('GET /things/:id', (req) => ({ id: req.params.id }));
    expect(router.dispatch('GET', '/things/42', undefined)).toEqual({ status: 200, body: { id: '42' } });
  });

  it('answers 404 for an unknown path', () => {
    expect(new Router().dispatch('GET', '/nowhere', undefined).status).toBe(404);
  });

  it('rejects a duplicate route', () => {
    const router = new Router();
    router.add('GET /things', () => []);
    expect(() => router.add('GET /things', () => [])).toThrow('already registered');
  });

  it('maps a domain error to its status code', () => {
    const router = new Router();
    router.add('GET /things/:id', () => {
      throw notFound('Thing');
    });
    expect(router.dispatch('GET', '/things/1', undefined).status).toBe(404);
  });
});

describe('the shop over HTTP', () => {
  it('publishes a product, stocks it, and sells it', () => {
    const { router } = createShop();
    router.dispatch('POST', '/products', { sku: 'mug', name: 'Mug', priceCents: 1200 });
    router.dispatch('POST', '/stock/mug', { units: 4 });
    expect(router.dispatch('GET', '/products/mug', undefined).body).toMatchObject({ sku: 'mug', available: 4 });
    const placed = router.dispatch('POST', '/orders', { customer: 'ada', cart: { items: [{ sku: 'mug', quantity: 1 }] } });
    expect(placed.status).toBe(200);
  });

  it('answers 422 for an empty cart', () => {
    const { router } = createShop();
    expect(router.dispatch('POST', '/orders', { customer: 'ada', cart: { items: [] } }).status).toBe(422);
  });
});
