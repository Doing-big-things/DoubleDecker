import { beforeEach, describe, expect, it } from 'vitest';
import { createShop, type Shop } from '../http/app';
import { resetIds } from '../shared/ids';
import { addItem, emptyCart } from './cart';

describe('Orders', () => {
  let shop: Shop;

  beforeEach(() => {
    resetIds();
    shop = createShop();
    shop.catalog.publish({ sku: 'mug', name: 'Mug', priceCents: 1200 });
    shop.catalog.publish({ sku: 'sofa', name: 'Sofa', priceCents: 120_000 });
    shop.inventory.receive('mug', 5);
  });

  it('places an order for a valid cart', () => {
    const order = shop.orders.placeOrder('ada', addItem(emptyCart(), 'mug', 2));
    expect(order.status).toBe('confirmed');
    expect(order.total.cents).toBe(2400);
  });

  it('rejects an empty cart', () => {
    expect(() => shop.orders.placeOrder('ada', emptyCart())).toThrow('at least one item');
  });

  it('does not save an order when the payment is declined', () => {
    expect(() => shop.orders.placeOrder('ada', addItem(emptyCart(), 'sofa', 1))).toThrow('declined');
    expect(shop.orders.listOrders('ada')).toEqual([]);
  });

  it('looks up one order', () => {
    const order = shop.orders.placeOrder('ada', addItem(emptyCart(), 'mug', 1));
    expect(shop.orders.getOrder(order.id)).toEqual(order);
  });

  it('fails for an unknown order', () => {
    expect(() => shop.orders.getOrder('ord_missing')).toThrow('was not found');
  });

  it('cancels an order and refunds it once', () => {
    const order = shop.orders.placeOrder('ada', addItem(emptyCart(), 'mug', 1));
    expect(shop.orders.cancelOrder(order.id).status).toBe('cancelled');
    expect(() => shop.orders.cancelOrder(order.id)).toThrow('already cancelled');
  });

  it("lists a customer's orders, newest first", () => {
    const first = shop.orders.placeOrder('ada', addItem(emptyCart(), 'mug', 1));
    const second = shop.orders.placeOrder('ada', addItem(emptyCart(), 'mug', 1));
    shop.orders.placeOrder('grace', addItem(emptyCart(), 'mug', 1));
    expect(shop.orders.listOrders('ada').map((o) => o.id)).toEqual([second.id, first.id]);
  });
});
