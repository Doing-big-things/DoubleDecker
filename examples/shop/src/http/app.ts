import { Catalog } from '../catalog';
import { ProductStore } from '../catalog/product-store';
import { Inventory } from '../inventory';
import { MemoryStockStore } from '../inventory/memory-stock-store';
import { Orders } from '../orders';
import { OrderStore } from '../orders/order-store';
import { Payments } from '../payments';
import { StubGateway } from '../payments/stub-gateway';
import { Router } from './router';
import { registerRoutes } from './routes';

export interface Shop {
  catalog: Catalog;
  inventory: Inventory;
  payments: Payments;
  orders: Orders;
  router: Router;
}

/** Wire the whole shop together, with in-memory storage. */
export function createShop(): Shop {
  const catalog = new Catalog(new ProductStore());
  const inventory = new Inventory(new MemoryStockStore());
  const payments = new Payments(new StubGateway());
  const orders = new Orders({ catalog, payments, store: new OrderStore() });
  const router = new Router();
  const shop: Shop = { catalog, inventory, payments, orders, router };
  registerRoutes(router, shop);
  return shop;
}
