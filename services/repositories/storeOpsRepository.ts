import { supabase } from '../supabase/client';
import { liveFeed } from '../realtime/liveFeed';
import { toCatalogueError } from '../supabase/errors';
import { getDeliveryProofPhotoUrl } from '../storage/deliveryProof';
import { awaitsOnlinePayment } from '../orderFilters';
import type { RiderAttempt, RiderStatus } from '../riderAssignment';
import type { OrderStatus } from '../../types/models';

export interface MyStoreAssignment {
  storeId: string;
  storeName: string;
  staffRole: 'store_manager' | 'staff';
}

export interface StoreDashboard {
  storeId: string;
  operationalStatus: 'open' | 'closed' | 'temporarily_unavailable';
  isActive: boolean;
  isAcceptingOrders: boolean;
  statusReason: string | null;
  todayRevenue: number;
  todayOrderCount: number;
  newOrders: number;
  processing: number;
  picking: number;
  packing: number;
  readyForPickup: number;
  lowStockCount: number;
  outOfStockCount: number;
  avgAcceptanceMinutes: number | null;
  avgPickingMinutes: number | null;
  avgPackingMinutes: number | null;
  avgFulfillmentMinutes: number | null;
  cancelledOrRejectedToday: number;
}

export interface StoreOrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  itemCount: number;
  total: number;
  paymentStatus: string;
  deliveryCity: string;
  deliveryLabel: string;
  hasException: boolean;
}

export type PickingStatus = 'pending' | 'picked' | 'unavailable';

export interface StoreOrderItem {
  id: string;
  productName: string;
  variantLabel: string;
  sku: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  pickingStatus: PickingStatus;
  categoryName: string | null;
}

export interface StoreOrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentStatus: string;
  paymentMethod: string;
  hasException: boolean;
  rejectionReason: string | null;
  rejectionNotes: string | null;
  internalNotes: string | null;
  recipientName: string;
  recipientPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  /** The customer's note for the rider, from the order's address snapshot. */
  deliveryInstructions: string | null;
  city: string;
  items: StoreOrderItem[];
}

export type OrderRejectionReason = 'store_unable_to_fulfill' | 'inventory_mismatch' | 'store_closed' | 'operational_issue';
export type InventoryAdjustmentReason = 'stock_count' | 'damaged' | 'expired' | 'lost' | 'found' | 'manual_correction';

export interface StoreInventoryRow {
  inventoryId: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderLevel: number;
  isAvailable: boolean;
}

export interface StaffMember {
  id: string;
  userId: string;
  name: string;
  role: 'store_manager' | 'staff';
  isActive: boolean;
}

/** One row of the manual "choose a rider" list (get_riders_for_assignment) — every active rider, with a status and whether they can take this order now. */
export interface AssignableRider {
  riderId: string;
  name: string;
  avatarUrl: string | null;
  vehicleType: string;
  vehicleNumber: string | null;
  sameStore: boolean;
  status: RiderStatus;
  activeDeliveries: number;
  capacity: number;
  canAssign: boolean;
  distanceMeters: number | null;
  locationAgeSeconds: number | null;
}

/** Final Dispatch pass — distance-aware eligibility preview for the "Send Rider" flow, distinct from the older getEligibleRiders (used by the manual-pick sheet, no distance). start_dispatch_round() calls the exact same backend function, so this preview is always exactly who actually gets offered. */
export interface DispatchEligibleRider {
  riderId: string;
  name: string;
  vehicleType: string;
  vehicleNumber: string | null;
  distanceMeters: number | null;
}

export type DispatchRoundStatus = 'open' | 'completed' | 'expired' | 'cancelled';

export interface DispatchOfferSummary {
  riderName: string;
  status: string;
  distanceMeters: number | null;
}

export type DispatchRoundMode = 'broadcast' | 'auto';

export interface DispatchRoundInfo {
  roundId: string;
  roundNumber: number;
  status: DispatchRoundStatus;
  mode: DispatchRoundMode;
  expiresAt: string;
  winnerRiderId: string | null;
  offers: DispatchOfferSummary[];
}

export type DeliveryStageStatus = 'assigned' | 'accepted' | 'at_store' | 'picked_up' | 'in_transit' | 'completed' | 'failed' | 'declined' | 'expired' | 'cancelled';

export interface OrderDeliveryStatus {
  assignmentId: string;
  riderName: string;
  status: DeliveryStageStatus;
  assignedAt: string;
  /** While status is 'assigned': when the rider's request lapses (assignment_expiry_minutes) — null once accepted. */
  expiresAt: string | null;
}

export interface CompletedDeliveryProof {
  riderName: string;
  completedAt: string;
  cashCollected: number | null;
  photoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface StoreProfile {
  id: string;
  name: string;
  code: string;
  addressLine: string;
  city: string;
  phone: string | null;
  openingTime: string;
  closingTime: string;
  isActive: boolean;
  isAcceptingOrders: boolean;
  statusReason: string | null;
}

export interface StoreActivityItem {
  at: string;
  kind: 'order' | 'delivery' | 'inventory';
  label: string;
  orderNumber: string | null;
  metadata: Record<string, unknown>;
}

const ORDER_DETAIL_SELECT =
  'id, order_number, status, placed_at, subtotal, delivery_fee, total, payment_status, has_exception, ' +
  'rejection_reason, rejection_notes, internal_notes, delivery_address, ' +
  'order_items(id, product_name_snapshot, variant_snapshot, sku_snapshot, image_snapshot, quantity, unit_price, total, picking_status, product_id, products(category_id, categories(name))), ' +
  'payments(method)';

function toOrderDetail(row: any): StoreOrderDetail {
  const addr = row.delivery_address ?? {};
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    placedAt: row.placed_at,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    total: Number(row.total),
    paymentStatus: row.payment_status,
    paymentMethod: row.payments?.[0]?.method ?? 'cod',
    hasException: row.has_exception,
    rejectionReason: row.rejection_reason,
    rejectionNotes: row.rejection_notes,
    internalNotes: row.internal_notes,
    recipientName: addr.recipient_name ?? '',
    recipientPhone: addr.phone ?? '',
    addressLine1: addr.address_line_1 ?? '',
    addressLine2: addr.address_line_2 ?? null,
    landmark: addr.landmark ?? null,
    deliveryInstructions: addr.delivery_instructions ?? null,
    city: addr.city ?? '',
    items: (row.order_items ?? []).map((i: any) => ({
      id: i.id,
      productName: i.product_name_snapshot,
      variantLabel: i.variant_snapshot,
      sku: i.sku_snapshot,
      image: i.image_snapshot,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price),
      total: Number(i.total),
      pickingStatus: i.picking_status,
      categoryName: i.products?.categories?.name ?? null,
    })),
  };
}

export const storeOpsRepository = {
  async getMyStores(): Promise<MyStoreAssignment[]> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    // Root cause of a real bug (a store manager occasionally showing as
    // "Store Staff"): this query used to rely entirely on RLS to scope
    // rows to the caller, but store_staff's SELECT policy is
    // deliberately broader than "my own rows" — store_staff_manager_
    // reads_colleagues (Phase 07, section 35) lets a manager also see
    // every OTHER staff member at their store, so a store with a
    // manager + a plain staff member returned BOTH rows here. The
    // caller (store/profile.tsx) then did `myStores.find(s => s.storeId
    // === activeStoreId)?.staffRole`, which picked whichever row came
    // back first — nondeterministically the colleague's role, not the
    // signed-in user's own. Filtering to this user's own rows is the
    // actual fix; the colleagues-visible policy stays exactly as-is for
    // listStaff(), which genuinely wants the whole team.
    const { data, error } = await supabase
      .from('store_staff')
      .select('role, is_active, stores(id, name)')
      .eq('is_active', true)
      .eq('user_id', user.id);
    if (error) throw toCatalogueError(error);
    return (data ?? [])
      .filter((r: any) => r.stores)
      .map((r: any) => ({ storeId: r.stores.id, storeName: r.stores.name, staffRole: r.role }));
  },

  async getDashboard(storeId: string): Promise<StoreDashboard> {
    const { data, error } = await supabase.rpc('get_store_dashboard', { p_store_id: storeId });
    if (error) throw toCatalogueError(error);
    const d = data as any;
    return {
      storeId: d.storeId,
      operationalStatus: d.operationalStatus,
      isActive: d.isActive,
      isAcceptingOrders: d.isAcceptingOrders,
      statusReason: d.statusReason ?? null,
      todayRevenue: Number(d.todayRevenue),
      todayOrderCount: d.todayOrderCount,
      newOrders: d.newOrders,
      processing: d.processing,
      picking: d.picking,
      packing: d.packing,
      readyForPickup: d.readyForPickup,
      lowStockCount: d.lowStockCount,
      outOfStockCount: d.outOfStockCount,
      avgAcceptanceMinutes: d.avgAcceptanceMinutes != null ? Number(d.avgAcceptanceMinutes) : null,
      avgPickingMinutes: d.avgPickingMinutes != null ? Number(d.avgPickingMinutes) : null,
      avgPackingMinutes: d.avgPackingMinutes != null ? Number(d.avgPackingMinutes) : null,
      avgFulfillmentMinutes: d.avgFulfillmentMinutes != null ? Number(d.avgFulfillmentMinutes) : null,
      cancelledOrRejectedToday: d.cancelledOrRejectedToday,
    };
  },

  /**
   * Order queue for one store, optionally filtered to a set of statuses — RLS (is_store_staff) already scopes this to the caller's own store.
   * Prepaid orders whose payment hasn't been verified are left out: the server refuses to accept them (order_awaits_online_payment), so listing
   * them as "New" would show staff an order they can't act on, and the dashboard counts (get_store_dashboard) already exclude them.
   */
  async listOrders(storeId: string, statuses?: OrderStatus[]): Promise<StoreOrderSummary[]> {
    let query = supabase
      .from('orders')
      .select('id, order_number, status, placed_at, total, payment_status, has_exception, delivery_address, order_items(id), payments(method, created_at)')
      .eq('store_id', storeId)
      .order('placed_at', { ascending: false })
      .limit(100);
    if (statuses && statuses.length > 0) query = query.in('status', statuses);
    const { data, error } = await query;
    if (error) throw toCatalogueError(error);
    return (data ?? []).filter((r: any) => !awaitsOnlinePayment(r.payment_status, r.payments)).map((r: any) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      placedAt: r.placed_at,
      itemCount: (r.order_items ?? []).length,
      total: Number(r.total),
      paymentStatus: r.payment_status,
      deliveryCity: r.delivery_address?.city ?? '',
      deliveryLabel: r.delivery_address?.label ?? 'home',
      hasException: r.has_exception,
    }));
  },

  async getOrderDetail(orderId: string): Promise<StoreOrderDetail | null> {
    const { data, error } = await supabase.from('orders').select(ORDER_DETAIL_SELECT).eq('id', orderId).maybeSingle();
    if (error) throw toCatalogueError(error);
    return data ? toOrderDetail(data) : null;
  },

  async acceptOrder(orderId: string) {
    const { error } = await supabase.rpc('accept_order', { p_order_id: orderId });
    if (error) throw toCatalogueError(error);
  },
  async rejectOrder(orderId: string, reason: OrderRejectionReason, notes?: string) {
    const { error } = await supabase.rpc('reject_order', { p_order_id: orderId, p_reason: reason, p_notes: notes ?? null });
    if (error) throw toCatalogueError(error);
  },
  async advanceOrder(orderId: string, newStatus: OrderStatus) {
    const { error } = await supabase.rpc('advance_order_fulfillment', { p_order_id: orderId, p_new_status: newStatus });
    if (error) throw toCatalogueError(error);
  },
  async markItemPicked(orderItemId: string, status: 'picked' | 'unavailable') {
    const { error } = await supabase.rpc('mark_order_item_picked', { p_order_item_id: orderItemId, p_status: status });
    if (error) throw toCatalogueError(error);
  },
  /** "We found it" — puts an unavailable item back to pending so it has to be genuinely picked; the order's exception clears only when no unavailable item is left. Manager/admin only (enforced by reopen_unavailable_item). */
  async reopenUnavailableItem(orderItemId: string, notes?: string) {
    const { error } = await supabase.rpc('reopen_unavailable_item', { p_order_item_id: orderItemId, p_notes: notes ?? null });
    if (error) throw toCatalogueError(error);
  },

  /** Cancels the order with a reason (releases the stock reservation and notifies the customer) — the other way to resolve an unavailable item. */
  async cancelOrder(orderId: string, reason: string) {
    const { error } = await supabase.rpc('update_order_status', { p_order_id: orderId, p_new_status: 'cancelled', p_reason: reason });
    if (error) throw toCatalogueError(error);
  },

  async resolveException(orderId: string, notes?: string) {
    const { error } = await supabase.rpc('resolve_order_exception', { p_order_id: orderId, p_notes: notes ?? null });
    if (error) throw toCatalogueError(error);
  },

  async listInventory(storeId: string, search?: string): Promise<StoreInventoryRow[]> {
    let query = supabase
      .from('inventory')
      .select('id, quantity, reserved_quantity, reorder_level, is_available, product_variants(id, weight_value, weight_unit, sku, products(name))')
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(200);
    const { data, error } = await query;
    if (error) throw toCatalogueError(error);
    let rows = (data ?? [])
      .filter((r: any) => r.product_variants)
      .map((r: any) => ({
        inventoryId: r.id,
        variantId: r.product_variants.id,
        productName: r.product_variants.products?.name ?? '',
        variantLabel: `${r.product_variants.weight_value} ${r.product_variants.weight_unit}`,
        sku: r.product_variants.sku,
        onHand: r.quantity,
        reserved: r.reserved_quantity,
        available: r.quantity - r.reserved_quantity,
        reorderLevel: r.reorder_level,
        isAvailable: r.is_available,
      }));
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.productName.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q));
    }
    return rows;
  },

  async recordAdjustment(
    storeId: string,
    variantId: string,
    newQuantity: number,
    reason: InventoryAdjustmentReason,
    notes?: string,
    orderId?: string,
  ) {
    const { data, error } = await supabase.rpc('record_inventory_adjustment', {
      p_store_id: storeId,
      p_variant_id: variantId,
      p_new_quantity: newQuantity,
      p_reason: reason,
      p_notes: notes ?? null,
      p_order_id: orderId ?? null,
    });
    if (error) throw toCatalogueError(error);
    return data as { success: boolean; oldQuantity: number; newQuantity: number; difference: number };
  },

  async setAcceptingOrders(storeId: string, accepting: boolean, reason?: string) {
    const { error } = await supabase.rpc('set_store_accepting_orders', { p_store_id: storeId, p_accepting: accepting, p_reason: reason ?? null });
    if (error) throw toCatalogueError(error);
  },

  async getActivity(storeId: string, cursor?: string, limit = 30): Promise<StoreActivityItem[]> {
    const { data, error } = await supabase.rpc('get_store_activity', { p_store_id: storeId, p_cursor: cursor ?? null, p_limit: limit });
    if (error) throw toCatalogueError(error);
    return ((data ?? []) as any[]).map((r) => ({ at: r.at, kind: r.kind, label: r.label, orderNumber: r.order_number, metadata: r.metadata }));
  },

  async getStoreProfile(storeId: string): Promise<StoreProfile | null> {
    const { data, error } = await supabase
      .from('stores')
      .select('id, name, code, address_line, city, phone, opening_time, closing_time, is_active, is_accepting_orders, status_reason')
      .eq('id', storeId)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return null;
    return {
      id: data.id,
      name: data.name,
      code: data.code,
      addressLine: data.address_line,
      city: data.city,
      phone: data.phone,
      openingTime: data.opening_time,
      closingTime: data.closing_time,
      isActive: data.is_active,
      isAcceptingOrders: data.is_accepting_orders,
      statusReason: data.status_reason,
    };
  },

  async listStaff(storeId: string): Promise<StaffMember[]> {
    const { data, error } = await supabase
      .from('store_staff')
      .select('id, user_id, role, is_active, profiles(full_name)')
      .eq('store_id', storeId)
      .order('role', { ascending: true });
    if (error) throw toCatalogueError(error);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      name: r.profiles?.full_name ?? 'Unnamed',
      role: r.role,
      isActive: r.is_active,
    }));
  },

  /** Every active rider with their status (free / delivering / offline ...) for the manual picker, best choices first. Riders are only ever assigned by a person choosing one — there is no automatic assignment. */
  async getRidersForAssignment(orderId: string): Promise<AssignableRider[]> {
    const { data, error } = await supabase.rpc('get_riders_for_assignment', { p_order_id: orderId });
    if (error) throw toCatalogueError(error);
    return (data ?? []).map((r: any) => ({
      riderId: r.riderId,
      name: r.name ?? 'Rider',
      avatarUrl: r.avatarUrl ?? null,
      vehicleType: r.vehicleType,
      vehicleNumber: r.vehicleNumber ?? null,
      sameStore: !!r.sameStore,
      status: r.status,
      activeDeliveries: r.activeDeliveries,
      capacity: r.capacity,
      canAssign: !!r.canAssign,
      distanceMeters: r.distanceMeters != null ? Number(r.distanceMeters) : null,
      locationAgeSeconds: r.locationAgeSeconds != null ? Number(r.locationAgeSeconds) : null,
    }));
  },

  /** Who was asked for this order and how each attempt ended, newest first — drives the "this rider did not accept, choose another" prompt. */
  async getOrderRiderAttempts(orderId: string): Promise<RiderAttempt[]> {
    const { data, error } = await supabase.rpc('get_order_rider_attempts', { p_order_id: orderId });
    if (error) throw toCatalogueError(error);
    return (data ?? []).map((a: any) => ({
      assignmentId: a.assignmentId,
      riderId: a.riderId,
      riderName: a.riderName ?? 'The rider',
      status: a.status,
      reason: a.reason ?? null,
      assignedAt: a.assignedAt,
      endedAt: a.endedAt ?? null,
    }));
  },

  async assignRider(orderId: string, riderId: string): Promise<string> {
    const { data, error } = await supabase.rpc('assign_rider', { p_order_id: orderId, p_rider_id: riderId });
    if (error) throw toCatalogueError(error);
    return data as string;
  },

  async cancelAssignment(assignmentId: string, reason?: string) {
    const { error } = await supabase.rpc('cancel_assignment', { p_assignment_id: assignmentId, p_reason: reason ?? null });
    if (error) throw toCatalogueError(error);
  },

  /** Real distance preview (section 5) before pressing Send Rider — who's actually eligible right now, nearest first. */
  async getEligibleRidersForDispatch(orderId: string): Promise<DispatchEligibleRider[]> {
    const { data, error } = await supabase.rpc('get_eligible_riders_for_dispatch', { p_order_id: orderId });
    if (error) throw toCatalogueError(error);
    return (data ?? []).map((r: any) => ({
      riderId: r.rider_id,
      name: r.full_name,
      vehicleType: r.vehicle_type,
      vehicleNumber: r.vehicle_number,
      distanceMeters: r.distance_meters != null ? Number(r.distance_meters) : null,
    }));
  },

  /** "Send Rider" (section 2) — fans a real offer out to every eligible rider; the first to accept wins, atomically (accept_delivery_offer). Returns NO_ELIGIBLE_RIDERS rather than creating an empty round when nobody currently qualifies. */
  async startDispatchRound(orderId: string): Promise<{ success: boolean; code?: string; message?: string; dispatchRoundId?: string; roundNumber?: number; offerCount?: number; expiresAt?: string }> {
    const { data, error } = await supabase.rpc('start_dispatch_round', { p_order_id: orderId });
    if (error) throw toCatalogueError(error);
    return data;
  },

  /** The latest dispatch round for this order (any status) plus its offers — drives the order screen's Searching…/Rider Assigned/No Rider Accepted state (section 11). Null once a manual/older assignment exists with no round behind it. */
  async getLatestDispatchRound(orderId: string): Promise<DispatchRoundInfo | null> {
    const { data: round, error } = await supabase
      .from('delivery_dispatch_rounds')
      .select('id, round_number, status, mode, expires_at, winner_rider_id')
      .eq('order_id', orderId)
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!round) return null;

    const { data: offers, error: offersError } = await supabase
      .from('delivery_offers')
      .select('status, distance_meters, riders(profiles(full_name))')
      .eq('dispatch_round_id', round.id);
    if (offersError) throw toCatalogueError(offersError);

    return {
      roundId: round.id,
      roundNumber: round.round_number,
      status: round.status,
      mode: round.mode,
      expiresAt: round.expires_at,
      winnerRiderId: round.winner_rider_id,
      offers: (offers ?? []).map((o: any) => ({
        riderName: o.riders?.profiles?.full_name ?? 'Rider',
        status: o.status,
        distanceMeters: o.distance_meters != null ? Number(o.distance_meters) : null,
      })),
    };
  },

  /** Realtime for the store order screen while a dispatch round is open (section 11) — "something about this round/its offers changed, go refetch", same pattern as every other realtime subscription in this repository. */
  subscribeToDispatchRound(roundId: string, onChange: () => void): () => void {
    return liveFeed.watch(
      [
        { table: 'delivery_dispatch_rounds', filter: `id=eq.${roundId}` },
        { table: 'delivery_offers', filter: `dispatch_round_id=eq.${roundId}` },
      ],
      onChange,
      { catchUpOnConnect: true },
    );
  },

  /**
   * Realtime for the order queue/dashboard (section 51/58) — new
   * orders, status changes, and delivery-assignment changes for this
   * store only. Deliberately a "something changed, go refetch" signal
   * rather than trying to patch every list/dashboard number from the
   * raw payload — the same reconnect-safe pattern Phase 09's tracking
   * screen already uses, and it means one subscription covers every
   * screen's own refresh logic without duplicating it here.
   */
  subscribeToStoreActivity(storeId: string, onChange: () => void): () => void {
    return liveFeed.watch(
      [
        { table: 'orders', filter: `store_id=eq.${storeId}` },
        { table: 'delivery_assignments', filter: `store_id=eq.${storeId}` },
      ],
      onChange,
    );
  },

  /** Realtime for the store's Inventory screen: stock changes at this store only (picking, restock, an admin adjustment). */
  subscribeToStoreInventory(storeId: string, onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'inventory', filter: `store_id=eq.${storeId}` }], onChange);
  },

  /** The active (non-terminal) delivery for this order, if any — null once the order has none (never assigned yet, or terminated). */
  async getOrderDeliveryStatus(orderId: string): Promise<OrderDeliveryStatus | null> {
    const { data, error } = await supabase
      .from('delivery_assignments')
      .select('id, status, assigned_at, expires_at, riders(profiles(full_name))')
      .eq('order_id', orderId)
      .not('status', 'in', '(completed,cancelled,declined,expired,failed)')
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return null;
    return {
      assignmentId: data.id,
      riderName: (data as any).riders?.profiles?.full_name ?? 'Rider',
      status: data.status as DeliveryStageStatus,
      assignedAt: data.assigned_at,
      expiresAt: data.status === 'assigned' ? (data as any).expires_at ?? null : null,
    };
  },

  /** Full proof-of-delivery for a completed order — the store manager view of the same mandatory photo+location proof (Zepto/Blinkit pattern) riders capture. Null until the delivery actually completes. */
  async getDeliveryProof(orderId: string): Promise<CompletedDeliveryProof | null> {
    const { data, error } = await supabase
      .from('delivery_assignments')
      .select('completed_at, cash_collected, delivery_proof_photo_url, delivery_proof_latitude, delivery_proof_longitude, riders(profiles(full_name))')
      .eq('order_id', orderId)
      .eq('status', 'completed')
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return null;
    const photoUrl = data.delivery_proof_photo_url ? await getDeliveryProofPhotoUrl(data.delivery_proof_photo_url) : null;
    return {
      riderName: (data as any).riders?.profiles?.full_name ?? 'Rider',
      completedAt: data.completed_at,
      cashCollected: data.cash_collected,
      photoUrl,
      latitude: data.delivery_proof_latitude,
      longitude: data.delivery_proof_longitude,
    };
  },
};
