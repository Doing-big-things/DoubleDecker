import { ShopError, invalid } from '../shared/errors';
import type { LineItem, OrderId, Sku } from '../shared/types';
import type { StockStore } from './stock-store';

/** Stock held for one order. */
export interface Reservation {
  orderId: OrderId;
  items: LineItem[];
}

/** Raised when an order asks for more than is in stock. */
export class StockUnavailable extends ShopError {
  readonly unavailable: Sku[];

  constructor(unavailable: Sku[]) {
    super('conflict', `Not enough stock for ${unavailable.join(', ')}`);
    this.unavailable = unavailable;
  }
}

/** Tracks how many units of each product are in stock. */
export class Inventory {
  private store: StockStore;
  private reservations = new Map<string, Reservation>();

  constructor(store: StockStore) {
    this.store = store;
  }

  /** Report how many units can be sold. */
  available(sku: Sku): number {
    return this.store.read(sku).units;
  }

  /** Add a delivery to stock. */
  receive(sku: Sku, units: number): void {
    if (!Number.isInteger(units) || units <= 0) throw invalid('A delivery needs a positive number of units');
    this.store.write(sku, this.available(sku) + units);
  }

  /** Adjust stock by hand, never below zero. */
  adjust(sku: Sku, delta: number): void {
    const next = this.available(sku) + delta;
    if (next < 0) throw invalid(`Stock for ${sku} cannot go below zero`);
    this.store.write(sku, next);
  }

  /** Reserve stock for an order. */
  reserve(orderId: OrderId, items: LineItem[], idempotencyKey: string): Reservation {
    const earlier = this.reservations.get(idempotencyKey);
    if (earlier) return earlier;
    for (const item of items) {
      const left = this.available(item.sku) - item.quantity;
      if (left < 0) throw new StockUnavailable([item.sku]);
      this.store.write(item.sku, left);
    }
    const reservation: Reservation = { orderId, items };
    this.reservations.set(idempotencyKey, reservation);
    return reservation;
  }

  /** Give reserved stock back. */
  release(idempotencyKey: string): void {
    const reservation = this.reservations.get(idempotencyKey);
    if (!reservation) return;
    for (const item of reservation.items) this.store.write(item.sku, this.available(item.sku) + item.quantity);
    this.reservations.delete(idempotencyKey);
  }
}
