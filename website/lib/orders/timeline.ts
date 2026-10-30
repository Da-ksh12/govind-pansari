// Turns an order's real status into the customer-facing timeline. Pure and framework-free.
//
// The database has eleven order statuses; a customer reads six stages. Nothing here invents progress: a stage is "done" only when the order's
// actual status has reached it, and a cancelled order shows as cancelled, never as a timeline that is "almost there".

export type OrderStatus =
  | 'placed'
  | 'confirmed'
  | 'preparing'
  | 'picking'
  | 'packing'
  | 'packed'
  | 'rider_assigned'
  | 'out_for_delivery'
  | 'approaching'
  | 'delivered'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
export type PaymentMethod = 'cod' | 'upi' | 'card' | 'netbanking' | 'wallet';

export const STAGES = [
  { key: 'placed', label: 'Order placed', hint: 'We have your order.' },
  { key: 'confirmed', label: 'Confirmed', hint: 'The store has accepted it.' },
  { key: 'packing', label: 'Packing', hint: 'Your items are being picked and packed.' },
  { key: 'ready', label: 'Ready for dispatch', hint: 'Packed, waiting for the delivery partner.' },
  { key: 'out_for_delivery', label: 'Out for delivery', hint: 'On the way to you.' },
  { key: 'delivered', label: 'Delivered', hint: 'Enjoy.' },
] as const;
export type StageKey = (typeof STAGES)[number]['key'];

/** Which stage each real status belongs to (the index into STAGES). */
const STAGE_OF: Record<Exclude<OrderStatus, 'cancelled'>, number> = {
  placed: 0,
  confirmed: 1,
  preparing: 2,
  picking: 2,
  packing: 2,
  packed: 3,
  rider_assigned: 3,
  out_for_delivery: 4,
  approaching: 4,
  delivered: 5,
};

export interface TimelineStep {
  key: StageKey;
  label: string;
  hint: string;
  state: 'done' | 'current' | 'upcoming';
  /** When the order reached this stage, if the history says so. */
  at: string | null;
}

export interface StatusHistoryRow {
  new_status: OrderStatus;
  changed_at: string;
}

/** The first time the order entered any status of each stage, from the real status history. */
function stageTimes(history: readonly StatusHistoryRow[]): Map<number, string> {
  const times = new Map<number, string>();
  const ordered = [...history].sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());
  for (const row of ordered) {
    if (row.new_status === 'cancelled') continue;
    const stage = STAGE_OF[row.new_status];
    if (stage !== undefined && !times.has(stage)) times.set(stage, row.changed_at);
  }
  return times;
}

export function buildTimeline(status: OrderStatus, history: readonly StatusHistoryRow[] = [], placedAt: string | null = null): TimelineStep[] | null {
  if (status === 'cancelled') return null;
  const reached = STAGE_OF[status] ?? 0;
  const times = stageTimes(history);
  if (placedAt && !times.has(0)) times.set(0, placedAt);
  return STAGES.map((stage, index) => ({
    key: stage.key,
    label: stage.label,
    hint: stage.hint,
    // the final stage, once reached, is finished — not "in progress"
    state: index < reached || (index === reached && status === 'delivered') ? 'done' : index === reached ? 'current' : 'upcoming',
    at: index <= reached ? (times.get(index) ?? null) : null,
  }));
}

/** One honest sentence about where the order is. */
export function describeStatus(status: OrderStatus): string {
  switch (status) {
    case 'placed':
      return 'Your order has been placed and is waiting for the store to confirm it.';
    case 'confirmed':
      return 'The store has confirmed your order.';
    case 'preparing':
    case 'picking':
    case 'packing':
      return 'Your items are being picked and packed.';
    case 'packed':
      return 'Your order is packed and waiting for a delivery partner.';
    case 'rider_assigned':
      return 'A delivery partner has been assigned and is heading to the store.';
    case 'out_for_delivery':
      return 'Your order is on its way.';
    case 'approaching':
      return 'Your delivery partner is almost at your door.';
    case 'delivered':
      return 'Delivered.';
    case 'cancelled':
      return 'This order was cancelled.';
  }
}

export function paymentLabel(method: PaymentMethod | null | undefined, status: PaymentStatus | null | undefined): string {
  if (method === 'cod') return status === 'paid' ? 'Cash on delivery — paid' : 'Cash on delivery — pay when it arrives';
  const how = method === 'upi' ? 'UPI' : method === 'card' ? 'Card' : method === 'netbanking' ? 'Net banking' : method === 'wallet' ? 'Wallet' : 'Online';
  switch (status) {
    case 'paid':
      return `${how} — paid`;
    case 'authorized':
      return `${how} — payment authorised, confirming`;
    case 'failed':
      return `${how} — payment failed`;
    case 'refunded':
      return `${how} — refunded`;
    case 'partially_refunded':
      return `${how} — partly refunded`;
    default:
      return `${how} — waiting for payment`;
  }
}

/** A short label and colour family for an order's status chip. */
export function statusBadge(status: OrderStatus): { label: string; tone: 'waiting' | 'progress' | 'done' | 'cancelled' } {
  switch (status) {
    case 'placed':
      return { label: 'Placed', tone: 'waiting' };
    case 'confirmed':
      return { label: 'Confirmed', tone: 'progress' };
    case 'preparing':
    case 'picking':
    case 'packing':
      return { label: 'Packing', tone: 'progress' };
    case 'packed':
      return { label: 'Ready for dispatch', tone: 'progress' };
    case 'rider_assigned':
      return { label: 'Rider assigned', tone: 'progress' };
    case 'out_for_delivery':
      return { label: 'Out for delivery', tone: 'progress' };
    case 'approaching':
      return { label: 'Arriving now', tone: 'progress' };
    case 'delivered':
      return { label: 'Delivered', tone: 'done' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'cancelled' };
  }
}

/** A customer may cancel on their own only before packing starts (the terms say so); after that they contact support. */
export function canCustomerCancel(status: OrderStatus): boolean {
  return status === 'placed' || status === 'confirmed' || status === 'preparing';
}
