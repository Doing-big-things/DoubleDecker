import type { ProductDraft } from '../catalog/products';
import type { Cart } from '../orders/cart';
import type { Shop } from './app';
import type { Router } from './router';

/** The HTTP surface of the shop. A thin adapter: every route calls one operation. */
export function registerRoutes(router: Router, shop: Shop): void {
  router.add('GET /products', () => shop.catalog.list());
  router.add('GET /products/:sku', (req) => ({
    ...shop.catalog.get(req.params.sku),
    available: shop.inventory.available(req.params.sku),
  }));
  router.add('POST /products', (req) => shop.catalog.publish(req.body as ProductDraft));
  router.add('POST /stock/:sku', (req) => {
    shop.inventory.receive(req.params.sku, (req.body as { units: number }).units);
    return { available: shop.inventory.available(req.params.sku) };
  });
  router.add('POST /orders', (req) => {
    const { customer, cart } = req.body as { customer: string; cart: Cart };
    return shop.orders.placeOrder(customer, cart);
  });
  router.add('GET /orders/:id', (req) => shop.orders.getOrder(req.params.id));
  router.add('DELETE /orders/:id', (req) => shop.orders.cancelOrder(req.params.id));
}
