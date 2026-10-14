import { supabase, uniqueChannel } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import type { OrderStatus } from '../../types/models';

// DB order_status has one member the frontend spells differently
// ('approaching' -> 'arriving', display copy predates the schema) —
// same translation orderRepository.ts applies. This RPC returns the
// raw DB value directly, so it needs the same map or a customer
// mid-delivery (exactly when this screen is actually open) gets an
// untranslated status no component recognizes.
const STATUS_MAP: Record<string, OrderStatus> = {
  placed: 'placed',
  confirmed: 'confirmed',
  preparing: 'preparing',
  picking: 'picking',
  packing: 'packing',
  packed: 'packed',
  rider_assigned: 'rider_assigned',
  out_for_delivery: 'out_for_delivery',
  approaching: 'arriving',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

export interface LiveLocation {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  recordedAt: string;
}

export interface DeliveryTracking {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  deliveryId: string | null;
  deliveryStatus: string | null;
  riderName: string | null;
  vehicleType: string | null;
  storeName: string | null;
  storeLatitude: number | null;
  storeLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  currentLocation: LiveLocation | null;
  assignedAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
}

function mapTracking(d: any): DeliveryTracking {
  return {
    orderId: d.orderId,
    orderNumber: d.orderNumber,
    orderStatus: STATUS_MAP[d.orderStatus] ?? 'placed',
    deliveryId: d.deliveryId ?? null,
    deliveryStatus: d.deliveryStatus ?? null,
    riderName: d.riderName ?? null,
    vehicleType: d.vehicleType ?? null,
    storeName: d.storeName ?? null,
    storeLatitude: d.storeLatitude ?? null,
    storeLongitude: d.storeLongitude ?? null,
    destinationLatitude: d.destinationLatitude ?? null,
    destinationLongitude: d.destinationLongitude ?? null,
    currentLocation: d.currentLocation
      ? {
          latitude: d.currentLocation.latitude,
          longitude: d.currentLocation.longitude,
          heading: d.currentLocation.heading ?? null,
          speed: d.currentLocation.speed ?? null,
          accuracy: d.currentLocation.accuracy ?? null,
          recordedAt: d.currentLocation.recordedAt,
        }
      : null,
    assignedAt: d.assignedAt ?? null,
    outForDeliveryAt: d.outForDeliveryAt ?? null,
    deliveredAt: d.deliveredAt ?? null,
  };
}

export const trackingRepository = {
  async getTracking(orderId: string): Promise<DeliveryTracking> {
    const { data, error } = await supabase.rpc('get_delivery_tracking', { p_order_id: orderId });
    if (error) throw toCatalogueError(error);
    return mapTracking(data);
  },

  /**
   * Live location pings for one delivery. The channel name embeds
   * delivery_id for the client's own routing/dedup purposes only — it
   * is not the security boundary (section 58). RLS on `rider_locations`
   * (verified live: phase09-live-tracking.test.mjs tests 12-13) is what
   * actually decides whether this subscriber receives anything at all;
   * an unauthorized client filtering for someone else's delivery_id
   * gets no events, guessable channel name notwithstanding.
   */
  subscribeToLocation(deliveryId: string, onUpdate: (location: LiveLocation) => void): () => void {
    const channel = uniqueChannel(`rider-location-${deliveryId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rider_locations', filter: `delivery_id=eq.${deliveryId}` },
        (payload) => {
          const row = payload.new as any;
          if (row.is_outlier) return; // section 10: never surface a flagged jump to the customer
          onUpdate({
            latitude: row.latitude,
            longitude: row.longitude,
            heading: row.heading ?? null,
            speed: row.speed ?? null,
            accuracy: row.accuracy ?? null,
            recordedAt: row.recorded_at,
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  /** Delivery status changes (accepted / at_store / picked_up / in_transit / completed / failed) — lets the screen react without polling. */
  subscribeToDeliveryStatus(deliveryId: string, onUpdate: (status: string) => void): () => void {
    const channel = uniqueChannel(`delivery-status-${deliveryId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'delivery_assignments', filter: `id=eq.${deliveryId}` },
        (payload) => onUpdate((payload.new as any).status),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Section 14 follow-up: mark_order_approaching() ("I've Reached
   * Destination") only ever writes orders.status, never
   * delivery_assignments — so subscribeToDeliveryStatus above never
   * fires for it. Without this, the customer would only find out via
   * the screen's 25s safety-net timer, not "immediately" as required.
   * orders_owner_read RLS already grants the owning customer SELECT on
   * their own order row, so this UPDATE feed reaches them the same way
   * subscribeToDeliveryStatus does.
   */
  subscribeToOrderStatus(orderId: string, onUpdate: (status: string) => void): () => void {
    const channel = uniqueChannel(`order-status-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => onUpdate((payload.new as any).status),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },
};
