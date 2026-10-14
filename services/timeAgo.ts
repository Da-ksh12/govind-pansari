/** Minutes since an ISO timestamp — used for order-age display and the
 * new-order urgency indicator (section 32). Thresholds live here, not
 * hardcoded into a screen, so both the order list and detail can share
 * the exact same "is this order waiting too long" judgment. */
export function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

export function formatOrderAge(iso: string): string {
  const mins = minutesSince(iso);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type OrderUrgency = 'normal' | 'attention' | 'urgent';

/** Only meaningful for orders still waiting on a staff action (new/processing/picking/packing) — a delivered or cancelled order isn't "waiting". */
export function orderUrgency(iso: string): OrderUrgency {
  const mins = minutesSince(iso);
  if (mins >= 20) return 'urgent';
  if (mins >= 10) return 'attention';
  return 'normal';
}
