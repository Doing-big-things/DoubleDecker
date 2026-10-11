import type { Catalog } from '../catalog';
import type { Payments } from '../payments';
import { conflict, invalid, notFound } from '../shared/errors';
import { nextId } from '../shared/ids';
import type { CustomerId, OrderId } from '../shared/types';
import type { Cart } from './cart';
import type { Order, OrderStore } from './order-store';
import { totalOf } from './pricing';

export interface OrdersDeps {
  catalog: Catalog;
  payments: Payments;
  store: OrderStore;
}

/** Places, tracks and cancels customer orders. */
export class Orders {
  private deps: OrdersDeps;

  constructor(deps: OrdersDeps) {
    this.deps = deps;
  }

  /** Place an order from a cart. */
  placeOrder(customer: CustomerId, cart: Cart): Order {
    if (cart.items.length === 0) throw invalid('An order needs at least one item');
    const id = nextId('ord');
    const total = totalOf(cart, this.deps.catalog);
    const payment = this.deps.payments.charge(customer, total, id);
    const order: Order = {
      id,
      customer,
      items: cart.items,
      total,
      paymentId: payment.id,
      status: 'confirmed',
    };
    this.deps.store.save(order);
    return order;
  }

  /** Look up one order. */
  getOrder(id: OrderId): Order {
    const order = this.deps.store.find(id);
    if (!order) throw notFound(`Order ${id}`);
    return order;
  }

  /** Cancel an order and refund the customer. */
  cancelOrder(id: OrderId): Order {
    const order = this.getOrder(id);
    if (order.status === 'cancelled') throw conflict('The order was already cancelled');
    this.deps.payments.refund(order.paymentId);
    const cancelled: Order = { ...order, status: 'cancelled' };
    this.deps.store.save(cancelled);
    return cancelled;
  }

  /** List a customer's orders, newest first. */
  listOrders(customer: CustomerId): Order[] {
    return this.deps.store.byCustomer(customer);
  }
}
