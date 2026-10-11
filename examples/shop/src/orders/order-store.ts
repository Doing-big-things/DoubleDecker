import type { Money } from '../shared/money';
import type { CustomerId, LineItem, OrderId } from '../shared/types';

export interface Order {
  id: OrderId;
  customer: CustomerId;
  items: LineItem[];
  total: Money;
  paymentId: string;
  status: 'confirmed' | 'cancelled';
}

/** Keeps orders in memory. */
export class OrderStore {
  private orders = new Map<OrderId, Order>();

  save(order: Order): void {
    this.orders.set(order.id, order);
  }

  find(id: OrderId): Order | undefined {
    return this.orders.get(id);
  }

  byCustomer(customer: CustomerId): Order[] {
    return [...this.orders.values()].filter((o) => o.customer === customer).sort((a, b) => b.id.localeCompare(a.id));
  }
}
