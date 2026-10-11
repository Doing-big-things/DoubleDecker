/** A stock-keeping unit: the identifier of something the shop sells. */
export type Sku = string;
export type OrderId = string;
export type CustomerId = string;

/** One line of a cart or an order. */
export interface LineItem {
  sku: Sku;
  quantity: number;
}
