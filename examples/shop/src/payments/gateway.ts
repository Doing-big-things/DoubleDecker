import type { Money } from '../shared/money';
import type { CustomerId } from '../shared/types';

export interface Authorization {
  id: string;
  amount: Money;
}

/** The contract every payment provider implements. */
export interface PaymentGateway {
  /** Ask the provider to hold an amount. */
  authorize(customer: CustomerId, amount: Money): Authorization | null;
  /** Take a held amount. */
  capture(authorization: Authorization): void;
  /** Send a captured amount back. */
  refund(authorization: Authorization): void;
}
