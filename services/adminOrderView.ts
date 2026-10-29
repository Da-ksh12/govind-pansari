// How an order is presented in the admin app: the card, the detail screen, the payment wording and the allowed actions.
// Everything here only FORMATS stored data — it never invents an image, a name, a status or a total. No React Native imports,
// so tests/unit covers it.

const IST = 'Asia/Kolkata';

/** "28 Oct 2026, 12:05 AM" in Indian time, whatever the phone's own time zone is. */
export function formatOrderDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\bam\b/i, 'AM').replace(/\bpm\b/i, 'PM');
}

/** Indian rupees as stored: "₹1,000", "₹449.50" — whole amounts without decimals, fractional ones always with two. */
export function formatMoney(amount: number | string | null | undefined): string {
  const value = Number(amount);
  if (amount === null || amount === undefined || !Number.isFinite(value)) return '₹—';
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "+91 79831 61732" for a 10-digit or 91-prefixed number; anything else is shown as stored. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 10 ? digits : null;
  return national ? `+91 ${national.slice(0, 5)} ${national.slice(5)}` : phone;
}

/** The raw digits for tel: links. */
export const phoneDigits = (phone: string | null | undefined): string => (phone ?? '').replace(/[^\d+]/g, '');

export interface OrderPreviewLine {
  name: string;
  variant: string | null;
  image: string | null;
  quantity: number;
  /** Line total — the main product of an order is its biggest line. */
  total: number;
}

export interface OrderPreview {
  main: OrderPreviewLine | null;
  /** Other lines besides the main one. */
  moreLines: number;
  lines: number;
}

/** The main product (largest line), how many other lines the order has — from real order lines only. */
export function summarizeOrderLines(lines: OrderPreviewLine[]): OrderPreview {
  if (lines.length === 0) return { main: null, moreLines: 0, lines: 0 };
  const main = lines.reduce((best, line) => (line.total > best.total ? line : best), lines[0]!);
  return { main, moreLines: lines.length - 1, lines: lines.length };
}

/** "Premium Dry Fruit Mix · 500 g" — the headline of a card. */
export function mainLineTitle(line: OrderPreviewLine): string {
  return line.variant ? `${line.name} · ${line.variant}` : line.name;
}

export function moreItemsText(moreLines: number): string {
  if (moreLines <= 0) return '';
  return `+ ${moreLines} more item${moreLines === 1 ? '' : 's'}`;
}

export const itemCountText = (count: number): string => `${count} item${count === 1 ? '' : 's'}`;

export type PaymentTone = 'good' | 'pending' | 'bad' | 'neutral';

const METHOD_LABEL: Record<string, string> = { cod: 'Cash on delivery', upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', razorpay: 'Online (Razorpay)' };

/**
 * Payment as it is stored. "Paid" is only ever shown for a payment the server marked paid (online payments are marked paid
 * only after Razorpay's signature is verified server-side); cash on delivery stays pending until the rider collects it.
 */
export function describePayment(method: string | null | undefined, status: string | null | undefined, awaitingPayment?: boolean): { method: string; status: string; tone: PaymentTone } {
  const methodLabel = method ? METHOD_LABEL[method.toLowerCase()] ?? method.replace(/_/g, ' ') : 'Not recorded';
  if (awaitingPayment) return { method: methodLabel, status: 'Awaiting online payment', tone: 'pending' };
  switch ((status ?? '').toLowerCase()) {
    case 'paid':
      return { method: methodLabel, status: 'Paid (verified)', tone: 'good' };
    case 'pending':
      return { method: methodLabel, status: method?.toLowerCase() === 'cod' ? 'To be collected on delivery' : 'Pending', tone: 'pending' };
    case 'failed':
      return { method: methodLabel, status: 'Failed', tone: 'bad' };
    case 'refunded':
      return { method: methodLabel, status: 'Refunded', tone: 'neutral' };
    case 'partially_refunded':
      return { method: methodLabel, status: 'Partly refunded', tone: 'neutral' };
    default:
      return { method: methodLabel, status: status ? status.replace(/_/g, ' ') : 'Not recorded', tone: 'neutral' };
  }
}

export interface StoredMoney {
  subtotal: number | string | null;
  discount: number | string | null;
  delivery_fee: number | string | null;
  tax: number | string | null;
  total: number | string | null;
}

const num = (value: number | string | null | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export interface PriceLine {
  label: string;
  amount: number;
  kind: 'plain' | 'discount' | 'delivery' | 'total';
}

/** The price breakdown exactly as stored on the order — every line is a stored column; nothing is recomputed. */
export function priceBreakdown(order: StoredMoney): PriceLine[] {
  return [
    { label: 'Subtotal', amount: num(order.subtotal), kind: 'plain' },
    { label: 'Discount', amount: num(order.discount), kind: 'discount' },
    { label: 'Delivery charge', amount: num(order.delivery_fee), kind: 'delivery' },
    { label: 'Tax', amount: num(order.tax), kind: 'plain' },
    { label: 'Total', amount: num(order.total), kind: 'total' },
  ];
}

/** True when the stored lines do not add up to the stored total (shown as a quiet note, never "fixed"). */
export function breakdownMismatch(order: StoredMoney): boolean {
  const expected = num(order.subtotal) - num(order.discount) + num(order.delivery_fee) + num(order.tax);
  return Math.abs(expected - num(order.total)) > 0.01;
}

const STATUS_LABEL: Record<string, string> = {
  placed: 'Order placed',
  confirmed: 'Accepted by store',
  preparing: 'Being prepared',
  picking: 'Items being picked',
  packing: 'Being packed',
  packed: 'Ready for pickup',
  rider_assigned: 'Rider assigned',
  out_for_delivery: 'Out for delivery',
  approaching: 'Rider is nearby',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
const DELIVERY_EVENT_LABEL: Record<string, string> = {
  delivery_assigned: 'Rider chosen',
  delivery_accepted: 'Rider accepted',
  delivery_declined: 'Rider declined',
  delivery_expired: "Rider didn't respond in time",
  delivery_cancelled: 'Rider assignment cancelled',
  delivery_arrived_at_store: 'Rider reached the store',
  delivery_picked_up: 'Rider picked up the order',
  delivery_started: 'Delivery started',
  delivery_completed: 'Delivery completed',
  delivery_failed: 'Delivery failed',
};

export interface TimelineEntry {
  at: string;
  kind: string;
  label: string;
}

/** A readable label for one stored history entry (unknown codes are shown as their own words, not hidden). */
export function timelineLabel(entry: TimelineEntry): string {
  const raw = (entry.label ?? '').toString();
  if (entry.kind === 'delivery') return DELIVERY_EVENT_LABEL[raw] ?? raw.replace(/^delivery_/, '').replace(/_/g, ' ');
  return STATUS_LABEL[raw] ?? raw.replace(/_/g, ' ');
}

/** Oldest first, with immediately repeated identical entries collapsed. */
export function cleanTimeline(entries: TimelineEntry[]): (TimelineEntry & { text: string })[] {
  const sorted = [...entries].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const out: (TimelineEntry & { text: string })[] = [];
  for (const entry of sorted) {
    const text = timelineLabel(entry);
    const previous = out[out.length - 1];
    if (previous && previous.text === text && Math.abs(new Date(previous.at).getTime() - new Date(entry.at).getTime()) < 1000) continue;
    out.push({ ...entry, text });
  }
  return out;
}

export interface OrderActionRights {
  canCancel: boolean;
  canAssignRider: boolean;
  canTrack: boolean;
}

/** Which actions to offer for this order, this status and this admin. The server enforces the same rules; this only hides what would be refused. */
export function allowedOrderActions(
  order: { status: string },
  hasActiveDelivery: boolean,
  can: (permission: 'orders.cancel' | 'deliveries.assign' | 'deliveries.view') => boolean,
): OrderActionRights {
  const finished = order.status === 'delivered' || order.status === 'cancelled';
  return {
    canCancel: !finished && can('orders.cancel'),
    canAssignRider: order.status === 'packed' && !hasActiveDelivery && can('deliveries.assign'),
    canTrack: hasActiveDelivery && ['rider_assigned', 'out_for_delivery', 'approaching'].includes(order.status) && can('deliveries.view'),
  };
}

export interface StoredAddress {
  recipient_name?: string | null;
  phone?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  landmark?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  label?: string | null;
  /** The customer's note for the rider (added with the structured address; absent on older orders). */
  delivery_instructions?: string | null;
}

/** The address lines as stored, skipping empty parts. */
export function addressLines(address: StoredAddress | null | undefined): string[] {
  if (!address) return [];
  const cityLine = [address.city, address.state].filter(Boolean).join(', ');
  return [
    address.address_line_1,
    address.address_line_2,
    address.landmark ? `Near ${address.landmark}` : null,
    [cityLine, address.postal_code].filter(Boolean).join(' - '),
    address.delivery_instructions ? `Instructions: ${address.delivery_instructions}` : null,
  ]
    .map((line) => (line ?? '').toString().trim())
    .filter(Boolean);
}
