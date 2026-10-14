import type { NotificationEventType } from '../repositories/notificationRepository';

const ORDER_DETAIL_EVENTS = new Set<NotificationEventType>([
  'order_placed', 'order_confirmed', 'order_preparing', 'order_packed', 'order_delivered', 'order_cancelled',
]);
const LIVE_TRACKING_EVENTS = new Set<NotificationEventType>([
  'rider_assigned', 'rider_at_store', 'order_picked_up', 'order_out_for_delivery', 'delivery_arriving', 'delivery_failed',
]);
const RIDER_DELIVERY_EVENTS = new Set<NotificationEventType>([
  'delivery_assigned', 'delivery_reminder', 'delivery_reassigned', 'delivery_exception',
]);

/**
 * Centralized tap-to-navigate mapping (section 12/31) — the backend
 * only ever hands back minimal metadata (orderId/deliveryId, section
 * 43), never a route string; this is the one place event type ->
 * screen is decided, not scattered across every place a notification
 * might be tapped (in-app list, foreground banner, background push).
 */
export function navigateForNotification(eventType: NotificationEventType, data: Record<string, string>): string | null {
  if (ORDER_DETAIL_EVENTS.has(eventType) && data.orderId) return `/order/${data.orderId}`;
  if (LIVE_TRACKING_EVENTS.has(eventType) && data.orderId) return `/track/${data.orderId}`;
  if (RIDER_DELIVERY_EVENTS.has(eventType) && data.deliveryId) return `/rider/delivery/${data.deliveryId}`;
  if (eventType === 'store_new_order' && data.orderId) return `/store/orders/${data.orderId}`;
  if (eventType.startsWith('admin_') && data.orderId) return `/admin/orders/${data.orderId}`;
  return null;
}
