import { conflict, invalid, notFound } from '../shared/errors';
import { nextId } from '../shared/ids';
import type { Money } from '../shared/money';
import type { CustomerId, OrderId } from '../shared/types';
import type { Authorization, PaymentGateway } from './gateway';

export interface Payment {
  id: string;
  orderId: OrderId;
  amount: Money;
  status: 'captured' | 'refunded';
}

/** Charges and refunds customers. */
export class Payments {
  private gateway: PaymentGateway;
  private payments = new Map<string, { payment: Payment; authorization: Authorization }>();

  constructor(gateway: PaymentGateway) {
    this.gateway = gateway;
  }

  /** Charge a customer for an order. */
  charge(customer: CustomerId, amount: Money, orderId: OrderId): Payment {
    if (amount.cents <= 0) throw invalid('A charge needs a positive amount');
    const authorization = this.gateway.authorize(customer, amount);
    if (!authorization) throw conflict('The payment was declined');
    this.gateway.capture(authorization);
    const payment: Payment = { id: nextId('pay'), orderId, amount, status: 'captured' };
    this.payments.set(payment.id, { payment, authorization });
    return payment;
  }

  /** Give the money for a payment back. */
  refund(paymentId: string): Payment {
    const entry = this.payments.get(paymentId);
    if (!entry) throw notFound(`Payment ${paymentId}`);
    if (entry.payment.status === 'refunded') throw conflict('The payment was already refunded');
    this.gateway.refund(entry.authorization);
    entry.payment = { ...entry.payment, status: 'refunded' };
    return entry.payment;
  }
}
