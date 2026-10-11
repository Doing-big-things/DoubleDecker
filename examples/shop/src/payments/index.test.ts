import { beforeEach, describe, expect, it } from 'vitest';
import { money } from '../shared/money';
import { Payments } from './index';
import { StubGateway } from './stub-gateway';

describe('Payments', () => {
  let gateway: StubGateway;
  let payments: Payments;

  beforeEach(() => {
    gateway = new StubGateway();
    payments = new Payments(gateway);
  });

  it('captures an authorized charge', () => {
    const payment = payments.charge('ada', money(2400), 'ord_1');
    expect(payment.status).toBe('captured');
    expect(gateway.captured).toHaveLength(1);
  });

  it('fails cleanly when declined', () => {
    expect(() => payments.charge('ada', money(100_000), 'ord_1')).toThrow('declined');
    expect(gateway.captured).toHaveLength(0);
  });

  it('refuses a zero amount', () => {
    expect(() => payments.charge('ada', money(0), 'ord_1')).toThrow('positive amount');
  });

  it('refunds a payment only once', () => {
    const payment = payments.charge('ada', money(2400), 'ord_1');
    expect(payments.refund(payment.id).status).toBe('refunded');
    expect(() => payments.refund(payment.id)).toThrow('already refunded');
  });

  it('fails to refund an unknown payment', () => {
    expect(() => payments.refund('pay_missing')).toThrow('was not found');
  });
});
