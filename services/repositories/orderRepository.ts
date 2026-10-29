import { supabase } from '../supabase/client';
import { liveFeed } from '../realtime/liveFeed';
import { toCatalogueError } from '../supabase/errors';
import { getDeliveryProofPhotoUrl } from '../storage/deliveryProof';
import { orderItemImages } from '../imageSources';
import type { Address, Order, OrderItem, OrderStatus, PaymentInfo } from '../../types/models';

// DB order_status has two members the frontend spells differently:
// 'approaching' -> 'arriving' (display copy predates the schema).
// Everything else is a direct 1:1 name match.
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

interface OrderItemRow {
  id: string;
  product_id: string;
  product_variant_id: string;
  product_name_snapshot: string;
  variant_snapshot: string;
  image_snapshot: string | null;
  quantity: number;
  unit_price: number;
  mrp: number;
  /** Embedded so a line whose snapshot is empty (the product had no photo when it was ordered) still shows the product's current photo. */
  products: { image: string | null } | null;
}

interface PaymentRow {
  method: PaymentInfo['method'];
  status: PaymentInfo['status'];
  payment_reference: string | null;
}

interface DeliveryAddressSnapshot {
  label: Address['label'];
  recipient_name: string;
  phone: string;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  state: string;
  postal_code: string;
  latitude: number;
  longitude: number;
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  placed_at: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  store_id: string;
  estimated_delivery_minutes: number | null;
  delivery_address: DeliveryAddressSnapshot;
  order_items: OrderItemRow[];
  payments: PaymentRow[];
}

const ORDER_SELECT =
  'id, order_number, status, placed_at, subtotal, delivery_fee, total, store_id, estimated_delivery_minutes, delivery_address, ' +
  'order_items(id, product_id, product_variant_id, product_name_snapshot, variant_snapshot, image_snapshot, quantity, unit_price, mrp, products(image)), ' +
  'payments(method, status, payment_reference)';

function toOrder(row: OrderRow): Order {
  const items: OrderItem[] = row.order_items.map((i) => ({
    id: i.id,
    productId: i.product_id,
    variantId: i.product_variant_id,
    name: i.product_name_snapshot,
    variantLabel: i.variant_snapshot,
    ...orderItemImages(i.image_snapshot, i.products?.image),
    quantity: i.quantity,
    price: Number(i.unit_price),
    mrp: Number(i.mrp),
  }));
  const mrpTotal = items.reduce((sum, i) => sum + i.mrp * i.quantity, 0);
  const subtotal = Number(row.subtotal);
  const payment = row.payments?.[0];
  const addr = row.delivery_address;
  const eta = row.estimated_delivery_minutes ?? 35;

  return {
    id: row.id,
    orderNumber: row.order_number,
    placedAt: row.placed_at,
    status: STATUS_MAP[row.status] ?? 'placed',
    items,
    itemTotal: subtotal,
    discount: mrpTotal - subtotal,
    deliveryFee: Number(row.delivery_fee),
    total: Number(row.total),
    savings: mrpTotal - subtotal,
    address: {
      id: row.id,
      label: addr.label,
      line1: addr.address_line_1,
      line2: addr.address_line_2 ?? undefined,
      city: addr.city,
      state: addr.state,
      pincode: addr.postal_code,
      lat: addr.latitude,
      lng: addr.longitude,
      isDefault: false,
      receiverName: addr.recipient_name,
      receiverPhone: addr.phone,
    },
    storeId: row.store_id,
    payment: payment
      ? { method: payment.method, status: payment.status, transactionId: payment.payment_reference ?? undefined }
      : { method: 'cod', status: 'pending' },
    etaMinutesMin: Math.max(0, eta - 10),
    etaMinutesMax: eta,
  };
}

export const orderRepository = {
  /**
   * Realtime for the customer Orders list (pre-production hardening,
   * part 14) — previously this screen only refetched on focus, so a
   * status change (store accepts, rider assigned, delivered) sat stale
   * in the list until the customer left and returned to the tab. The
   * dedicated /track/[orderId] screen already had its own realtime;
   * this is the same "go refetch" signal for the list view. Filtered
   * by user_id for routing convenience only — RLS (orders_owner_read)
   * is what actually scopes this to the signed-in customer.
   */
  subscribeToMyOrders(userId: string, onChange: () => void): () => void {
    // The store is signed-in-lifetime and has no screen hook, so it also asks to be resynced on foreground.
    return liveFeed.watch([{ table: 'orders', filter: `user_id=eq.${userId}` }], onChange, { resyncOnForeground: true, catchUpOnConnect: true });
  },

  /**
   * One representative product image per order, batched (Notification
   * Center's real order thumbnails) — a single query for every orderId
   * currently on screen rather than N per-row fetches. RLS
   * (order_items_owner_read, joined through orders_owner_read) already
   * scopes this to the signed-in customer's own orders; a notification
   * for an order that isn't theirs simply returns nothing for it.
   */
  async getOrderThumbnails(orderIds: string[]): Promise<Record<string, string>> {
    if (orderIds.length === 0) return {};
    const { data, error } = await supabase
      .from('order_items')
      .select('order_id, image_snapshot, products(image)')
      .in('order_id', orderIds);
    if (error) return {}; // enrichment only — never block the notification list on this
    const map: Record<string, string> = {};
    for (const row of (data ?? []) as unknown as { order_id: string; image_snapshot: string | null; products: { image: string | null } | null }[]) {
      const image = row.image_snapshot || row.products?.image;
      if (!map[row.order_id] && image) map[row.order_id] = image;
    }
    return map;
  },

  /** Full order history, newest first. RLS (orders_owner_read) already scopes this to the signed-in customer. */
  async list(): Promise<Order[]> {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .order('placed_at', { ascending: false });
    if (error) throw toCatalogueError(error);
    return (data as unknown as OrderRow[]).map(toOrder);
  },

  async getById(orderId: string): Promise<Order | null> {
    const { data, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', orderId).maybeSingle();
    if (error) throw toCatalogueError(error);
    return data ? toOrder(data as unknown as OrderRow) : null;
  },

  /**
   * The rider's mandatory photo + location proof for this order's
   * completed delivery. Photo resolved to a short-lived signed URL —
   * delivery-proofs is a private bucket, so nothing is cached here
   * across calls. Returns null for any order with no completed
   * delivery_assignments row yet (not delivered, or delivered before
   * this feature existed).
   */
  async getDeliveryProof(orderId: string): Promise<{ photoUrl: string; latitude: number | null; longitude: number | null } | null> {
    const { data, error } = await supabase
      .from('delivery_assignments')
      .select('delivery_proof_photo_url, delivery_proof_latitude, delivery_proof_longitude')
      .eq('order_id', orderId)
      .eq('status', 'completed')
      .maybeSingle();
    if (error || !data?.delivery_proof_photo_url) return null;
    const photoUrl = await getDeliveryProofPhotoUrl(data.delivery_proof_photo_url);
    if (!photoUrl) return null;
    return { photoUrl, latitude: data.delivery_proof_latitude, longitude: data.delivery_proof_longitude };
  },

  /** Owner-initiated cancellation — server enforces which statuses are still cancellable (update_order_status(), Phase 01). p_reason is one of the fixed customer-facing options (see app/order/[id].tsx), stored as-is for the store/admin to see, never required. */
  async cancel(orderId: string, reason?: string): Promise<void> {
    const { error } = await supabase.rpc('update_order_status', { p_order_id: orderId, p_new_status: 'cancelled', p_reason: reason ?? null });
    if (error) throw toCatalogueError(error);
  },

  /**
   * The narrow undo for a gateway order whose payment never completed
   * (cancelled/failed at the Razorpay sheet) — cancels the order AND
   * restores its items to cart_items, so the customer's cart isn't
   * silently emptied by an order they never actually paid for. Never
   * call this for a COD order or one with a settled payment outcome;
   * use cancel() for a real, already-placed order instead.
   */
  async restoreCartAfterFailedPayment(orderId: string): Promise<void> {
    const { error } = await supabase.rpc('restore_cart_after_failed_payment', { p_order_id: orderId });
    if (error) throw toCatalogueError(error);
  },
};
