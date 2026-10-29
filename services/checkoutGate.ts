/**
 * The single decision "can this order be placed right now, and if not, why?"
 * for the Checkout screen. The button's enabled state, the explanation shown
 * next to it and the progress stepper all read this one result, so identical
 * inputs can never produce different outcomes (QA TC-03), and every disabled
 * state says what the customer has to do about it (QA TC-04, TC-23).
 *
 * Free of React Native so it can be unit-tested. The same rules are enforced
 * on the server by create_order_from_cart() — this is guidance, never the only
 * check.
 */

export type SummaryState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; meetsMinimumOrder: boolean; amountToMinimumOrder: number; minimumOrderValue: number }
  | { status: 'failed'; message: string };

export interface PlaceOrderInput {
  hasAddress: boolean;
  /** null until the customer has actually chosen one — there is no silent default. */
  paymentMethod: string | null;
  summary: SummaryState;
  placing: boolean;
}

export type PlaceOrderBlock =
  | 'placing'
  | 'no_address'
  | 'summary_loading'
  | 'summary_failed'
  | 'below_minimum'
  | 'payment_not_selected';

export interface PlaceOrderGate {
  canPlace: boolean;
  block: PlaceOrderBlock | null;
  /** What to tell the customer; null when nothing needs saying (ready, or busy placing). */
  message: string | null;
}

/** ₹1,299 or ₹1,299.50 — Indian digit grouping, no trailing .00. */
export function formatRupees(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const [whole, fraction] = rounded.toFixed(2).split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return `₹${grouped}${fraction === '00' ? '' : `.${fraction}`}`;
}

export function evaluatePlaceOrder(input: PlaceOrderInput): PlaceOrderGate {
  if (input.placing) return { canPlace: false, block: 'placing', message: null };
  if (!input.hasAddress) return { canPlace: false, block: 'no_address', message: 'Add a delivery address to continue.' };

  const { summary } = input;
  if (summary.status === 'none' || summary.status === 'loading') {
    return { canPlace: false, block: 'summary_loading', message: 'Updating your total…' };
  }
  if (summary.status === 'failed') return { canPlace: false, block: 'summary_failed', message: summary.message };

  if (!summary.meetsMinimumOrder) {
    return {
      canPlace: false,
      block: 'below_minimum',
      message: `Add ${formatRupees(summary.amountToMinimumOrder)} more in items to place this order. The minimum is ${formatRupees(summary.minimumOrderValue)} before delivery.`,
    };
  }
  if (!input.paymentMethod) {
    return { canPlace: false, block: 'payment_not_selected', message: 'Choose a payment method to continue.' };
  }
  return { canPlace: true, block: null, message: null };
}

/** A stable fingerprint of the cart lines the server summary was computed for. */
export function cartSignature(lines: { cartItemId: string; quantity: number }[]): string {
  return lines
    .map((l) => `${l.cartItemId}:${l.quantity}`)
    .sort()
    .join('|');
}

export interface PaymentStepInput {
  deliveryDone: boolean;
  paymentMethod: string | null;
  gatewayPaymentConfirmed: boolean;
  gatewayPaymentFailed: boolean;
  placing: boolean;
}

export type PaymentStepState = 'unselected' | 'selected' | 'processing' | 'failed' | 'verified';

/**
 * What the Payment step of the progress indicator shows. The green tick
 * ('verified') is reserved for a payment that is actually settled: Cash on
 * Delivery once chosen (nothing to confirm online), or an online payment whose
 * gateway confirmation was verified. Merely having a default or a selected
 * online method is not completion (QA TC-23).
 */
export function paymentStepState(input: PaymentStepInput): PaymentStepState {
  if (!input.paymentMethod) return 'unselected';
  if (input.gatewayPaymentFailed) return 'failed';
  if (input.paymentMethod === 'cod') return input.deliveryDone ? 'verified' : 'selected';
  if (input.gatewayPaymentConfirmed) return 'verified';
  if (input.placing) return 'processing';
  return 'selected';
}
