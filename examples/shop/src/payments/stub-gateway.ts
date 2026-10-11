import { nextId } from '../shared/ids';
import type { Money } from '../shared/money';
import type { CustomerId } from '../shared/types';
import type { Authorization, PaymentGateway } from './gateway';

/** A fake provider that approves everything under 1,000 dollars. */
export class StubGateway implements PaymentGateway {
  readonly captured: string[] = [];
  readonly refunded: string[] = [];

  authorize(_customer: CustomerId, amount: Money): Authorization | null {
    if (amount.cents >= 100_000) return null;
    return { id: nextId('auth'), amount };
  }

  capture(authorization: Authorization): void {
    this.captured.push(authorization.id);
  }

  refund(authorization: Authorization): void {
    this.refunded.push(authorization.id);
  }
}
