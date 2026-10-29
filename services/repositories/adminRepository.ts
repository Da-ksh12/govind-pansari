import { supabase } from '../supabase/client';
import { liveFeed } from '../realtime/liveFeed';
import { rankInventoryAttention } from '../inventoryAttention';
import { toCatalogueError } from '../supabase/errors';
import type { OrdersListView } from '../dashboardMetrics';
import { escapeLikePattern, normalizeSku } from '../productValidation';
import { summarizeOrderLines, type OrderPreview, type OrderPreviewLine } from '../adminOrderView';
import { describeRiderEditError, type RiderPatch } from '../riderEdit';
import { describeAdminWriteError } from '../adminErrors';
import type { OfferCategory, PromotionTargetType } from '../promotionEdit';
import type { ZonePatch } from '../zoneEdit';

/** One ordered line as stored on the order (names, prices and photo are the snapshot taken when the order was placed). */
export interface AdminOrderLine {
  id: string;
  name: string;
  variant: string | null;
  sku: string | null;
  image: string | null;
  quantity: number;
  unitPrice: number;
  mrp: number;
  discount: number;
  total: number;
}

export interface AdminOrderPayment {
  method: string | null;
  status: string | null;
  provider: string | null;
  amount: number;
  createdAt: string;
}

/** PostgREST embed for an order's customer — orders has two FKs to profiles (user_id, cancelled_by), so the relationship must be named. */
export const ORDER_CUSTOMER_EMBED = 'profiles!orders_user_id_fkey';

export type AdminRoleType = 'super_admin' | 'admin' | 'operations_manager' | 'inventory_manager' | 'delivery_manager' | 'support_agent';
export type AdminPermission =
  | 'dashboard.view'
  | 'orders.view' | 'orders.manage' | 'orders.cancel' | 'orders.refund'
  | 'products.view' | 'products.create' | 'products.edit' | 'products.delete'
  | 'categories.manage'
  | 'inventory.view' | 'inventory.manage' | 'inventory.adjust'
  | 'stores.view' | 'stores.manage'
  | 'riders.view' | 'riders.manage'
  | 'deliveries.view' | 'deliveries.assign' | 'deliveries.reassign'
  | 'customers.view' | 'customers.manage'
  | 'notifications.view' | 'notifications.send'
  | 'analytics.view'
  | 'settings.view' | 'settings.manage'
  | 'promotions.manage' | 'zones.manage'
  | 'users.view' | 'users.manage'
  | 'audit_logs.view';

/** A home-screen banner as the admin list returns it (including hidden and scheduled ones). */
export interface AdminBannerRow {
  id: string;
  title: string;
  subtitle: string | null;
  eyebrow: string | null;
  imageUrl: string;
  ctaLabel: string | null;
  theme: 'dark' | 'light';
  targetType: PromotionTargetType | 'collection';
  targetId: string | null;
  targetUrl: string | null;
  /** The name of the category / product it opens, when it opens one. */
  targetName: string | null;
  startAt: string | null;
  endAt: string | null;
  sortOrder: number;
  isActive: boolean;
}
export interface AdminOfferRow {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  ctaLabel: string | null;
  category: OfferCategory;
  targetType: PromotionTargetType | 'collection';
  targetId: string | null;
  targetName: string | null;
  startAt: string | null;
  endAt: string | null;
  sortOrder: number;
  isActive: boolean;
}
export interface AdminZoneRow {
  id: string;
  name: string;
  deliveryFee: number;
  minimumOrderValue: number;
  freeDeliveryThreshold: number | null;
  estimatedMinutes: number;
  isActive: boolean;
  stores: { id: string; name: string; isActive: boolean }[];
}
/** What a banner / offer save sends (see services/promotionEdit.ts); null dates mean "now" for the start and "no end" for the end. */
export interface PromotionSave {
  title: string;
  subtitle: string | null;
  imageUrl: string;
  ctaLabel: string | null;
  startAt: string | null;
  endAt: string | null;
  sortOrder: number;
  targetType: PromotionTargetType;
  targetId: string | null;
  isActive: boolean;
}

export interface AdminContext {
  adminRole: AdminRoleType;
  isSuperAdmin: boolean;
  permissions: AdminPermission[];
}

export interface AdminDashboard {
  today: { orders: number; revenue: number; itemsSold: number; averageOrderValue: number; activeDeliveries: number; completedDeliveries: number; failedDeliveries: number; newCustomers: number };
  yesterday: { orders: number; revenue: number; itemsSold: number; averageOrderValue: number; newCustomers: number };
  operations: {
    pendingOrders: number; ordersPreparing: number; ordersReady: number; unassignedDeliveries: number; activeRiders: number; delayedDeliveries: number;
    /** Every non-terminal order not awaiting online payment — the single Active Orders figure. Optional only so an older server (before the consistent-definitions migration) still type-checks; see dashboardMetrics.activeOrderCount. */
    activeOrders?: number;
    /** Active orders waiting on online-payment verification (not counted as active/pending/revenue). */
    awaitingPayment?: number;
    /** Orders marked rider-assigned / on the way whose delivery assignment has failed or been cancelled — they need a manager's resolution. */
    stuckDeliveries?: number;
    deliveredToday?: number;
    /** Current number of active orders per raw status, regardless of placement date — powers the Live Order Pipeline. */
    byStatus?: Record<string, number>;
    /** null (not 0) when no order has reached this milestone today yet — render an honest "not available yet", never a fabricated zero. */
    avgFulfillmentMinutes: number | null;
    avgDeliveryMinutes: number | null;
    /** Real per-order_status counts for TODAY's orders only, keyed by the raw DB status string (e.g. 'placed', 'packed', 'out_for_delivery') — powers the Live Order Pipeline. Absent keys mean zero, not missing data. */
    todayByStatus: Record<string, number>;
  };
  inventory: { lowStock: number; outOfStock: number; alerts: number };
  customers: { newThisWeek: number; returning: number };
}

export interface AdminStorePerformance {
  store_id: string; store_name: string; is_active: boolean; is_accepting_orders: boolean;
  today_orders: number; today_revenue: number; active_orders: number; active_deliveries: number;
  low_stock: number; out_of_stock: number;
  avg_fulfillment_minutes: number | null; avg_delivery_minutes: number | null;
}

export interface AdminRiderLocation {
  rider_id: string; full_name: string; phone: string; vehicle_type: string;
  current_latitude: number; current_longitude: number; last_location_at: string;
  is_active: boolean; is_available: boolean;
  active_delivery_id: string | null; active_delivery_status: string | null;
  active_order_id: string | null; active_order_number: string | null; active_store_name: string | null;
}

export interface AdminAnalytics {
  periodDays: number;
  totals: { revenue: number; orders: number; cancelledOrders: number; averageOrderValue: number; newCustomers: number };
  revenueByDay: { day: string; revenue: number; orders: number }[];
  topProducts: { product_id: string; name: string; quantity_sold: number; revenue: number }[];
  categoryBreakdown: { category_name: string; revenue: number; quantity_sold: number }[];
  statusBreakdown: Record<string, number>;
}

export interface AdminOrderRow {
  id: string; order_number: string; status: string; total: number; placed_at: string; item_count: number;
  customer_name: string; customer_phone: string; store_name: string;
  active_delivery_id: string | null; rider_id: string | null; rider_name: string | null;
  /** True while this is a prepaid order whose payment has not been verified — shown only in the unfiltered list. Absent on a server that predates the consistent-definitions migration. */
  awaiting_payment?: boolean;
}

export interface AdminCustomerRow {
  id: string; full_name: string; phone: string; email: string | null; avatar_url: string | null; is_active: boolean; created_at: string;
  order_count: number; total_spend: number; last_order_at: string | null; active_order_id: string | null;
}

export interface AdminInventoryRow {
  id: string; store_id: string; store_name: string; variant_id: string; sku: string; product_name: string; product_image: string | null;
  weight_value: number; weight_unit: string; quantity: number; reserved_quantity: number; available_quantity: number;
  reorder_level: number; is_available: boolean; stock_status: 'in_stock' | 'low_stock' | 'out_of_stock';
}

export interface AuditLogRow {
  id: string; action: string; resource_type: string; resource_id: string | null; metadata: Record<string, unknown>; created_at: string; actor_name: string | null;
}

export interface AdminStaffRow {
  id: string; full_name: string; phone: string; role: string; admin_role: AdminRoleType | null; is_active: boolean;
  store_assignments: { storeId: string; storeName: string; role: string }[] | null;
}

export interface AdminStaffInviteRow {
  id: string; email: string; full_name: string; role: 'store_manager' | 'staff' | 'rider';
  store_id: string | null; store_name: string | null; applied_at: string | null; created_at: string;
}

export interface AdminProductInput {
  name: string;
  slug?: string;
  category_id: string | null;
  description?: string | null;
  short_description?: string | null;
  brand?: string;
  image?: string | null;
  gallery?: string[];
  tags?: string[];
  is_featured?: boolean;
  is_bestseller?: boolean;
}

export interface AdminVariantInput {
  sku: string;
  weight_value: number;
  weight_unit: 'g' | 'kg';
  price: number;
  mrp: number;
}

export interface AdminInventoryInput {
  variant_index: number;
  store_id: string;
  quantity: number;
  reorder_level?: number;
  is_available?: boolean;
}

export interface AdminProductDetail {
  id: string; name: string; slug: string; description: string | null; short_description: string | null;
  brand: string; image: string | null; gallery: string[]; tags: string[]; is_active: boolean;
  is_featured: boolean; is_bestseller: boolean; category_id: string | null;
  product_variants: { id: string; sku: string; weight_value: number; weight_unit: string; price: number; mrp: number; is_active: boolean }[];
}

export interface AdminCategoryInput {
  name: string;
  slug: string;
  description?: string | null;
  image_url?: string | null;
  parent_id?: string | null;
  sort_order?: number;
}

async function callRpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw toCatalogueError(error);
  return data as T;
}

export const adminRepository = {
  getContext: () => callRpc<AdminContext | null>('current_admin_context'),
  getDashboard: () => callRpc<AdminDashboard>('get_admin_dashboard'),
  getStorePerformance: () => callRpc<AdminStorePerformance[]>('get_admin_store_performance'),

  getOrders: (filters: { status?: string; statuses?: string[]; view?: OrdersListView; storeId?: string; riderId?: string; search?: string; dateFrom?: string; dateTo?: string; cursor?: string; limit?: number }) =>
    callRpc<AdminOrderRow[]>('get_admin_orders', {
      p_status: filters.status ?? null, p_store_id: filters.storeId ?? null, p_rider_id: filters.riderId ?? null,
      p_search: filters.search ?? null, p_date_from: filters.dateFrom ?? null, p_date_to: filters.dateTo ?? null,
      p_cursor: filters.cursor ?? null, p_limit: filters.limit ?? 20,
      // Only sent when set, so a plain "All" request is byte-identical to the pre-migration call.
      ...(filters.view ? { p_view: filters.view } : {}),
      ...(filters.statuses && filters.statuses.length > 0 ? { p_statuses: filters.statuses } : {}),
    }),
  /** Packed orders with no live delivery assignment — the list behind "Assign Rider". */
  getOrdersNeedingRider: (limit = 50) => callRpc<AdminOrderRow[]>('get_admin_orders', { p_view: 'needs_rider', p_limit: limit }),
  getOrderDetail: (orderId: string) => callRpc<any>('get_admin_order_detail', { p_order_id: orderId }),

  /**
   * The real order lines behind a page of order cards — main product, photo, how many other items. Read straight from
   * order_items (an admin with orders.view may read them); an order with no lines simply gets no preview.
   */
  async getOrderPreviews(orderIds: string[]): Promise<Record<string, OrderPreview>> {
    if (orderIds.length === 0) return {};
    const { data, error } = await supabase
      .from('order_items')
      .select('order_id, product_name_snapshot, variant_snapshot, image_snapshot, quantity, total')
      .in('order_id', orderIds);
    if (error) throw toCatalogueError(error);
    const byOrder: Record<string, OrderPreviewLine[]> = {};
    for (const row of (data ?? []) as any[]) {
      (byOrder[row.order_id] ??= []).push({
        name: row.product_name_snapshot,
        variant: row.variant_snapshot ?? null,
        image: row.image_snapshot ?? null,
        quantity: Number(row.quantity),
        total: Number(row.total),
      });
    }
    return Object.fromEntries(Object.entries(byOrder).map(([id, lines]) => [id, summarizeOrderLines(lines)]));
  },

  /** Every line of one order with its stored photo, quantity and prices. */
  async getOrderLines(orderId: string): Promise<AdminOrderLine[]> {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, product_name_snapshot, variant_snapshot, sku_snapshot, image_snapshot, quantity, unit_price, mrp, discount, total')
      .eq('order_id', orderId);
    if (error) throw toCatalogueError(error);
    return ((data ?? []) as any[])
      .map((r) => ({
        id: r.id, name: r.product_name_snapshot, variant: r.variant_snapshot ?? null, sku: r.sku_snapshot ?? null, image: r.image_snapshot ?? null,
        quantity: Number(r.quantity), unitPrice: Number(r.unit_price), mrp: Number(r.mrp), discount: Number(r.discount), total: Number(r.total),
      }))
      .sort((a, b) => b.total - a.total);
  },

  /** The latest payment record for an order (method and status only — never gateway ids or provider responses). */
  async getOrderPayment(orderId: string): Promise<AdminOrderPayment | null> {
    const { data, error } = await supabase
      .from('payments')
      .select('method, status, provider, amount, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return null;
    const r = data as any;
    return { method: r.method ?? null, status: r.status ?? null, provider: r.provider ?? null, amount: Number(r.amount), createdAt: r.created_at };
  },
  cancelOrder: async (orderId: string) => {
    const { error } = await supabase.rpc('update_order_status', { p_order_id: orderId, p_new_status: 'cancelled' });
    if (error) throw toCatalogueError(error);
  },

  getCustomers: (search?: string, cursor?: string, limit = 20) =>
    callRpc<AdminCustomerRow[]>('get_admin_customers', { p_search: search ?? null, p_cursor: cursor ?? null, p_limit: limit }),
  async getCustomerDetail(customerId: string) {
    const { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', customerId).maybeSingle();
    if (profileError) throw toCatalogueError(profileError);
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, order_number, status, total, placed_at')
      .eq('user_id', customerId)
      .order('placed_at', { ascending: false })
      .limit(20);
    if (ordersError) throw toCatalogueError(ordersError);
    return { profile, orders: orders ?? [] };
  },
  setCustomerActive: async (customerId: string, isActive: boolean) => {
    const { error } = await supabase.rpc('set_customer_active', { p_customer_id: customerId, p_is_active: isActive });
    if (error) throw toCatalogueError(error);
  },

  getInventory: (filters: { storeId?: string; lowStockOnly?: boolean; search?: string; cursor?: string; limit?: number }) =>
    callRpc<AdminInventoryRow[]>('get_admin_inventory', {
      p_store_id: filters.storeId ?? null, p_low_stock_only: filters.lowStockOnly ?? false,
      p_search: filters.search ?? null, p_cursor: filters.cursor ?? null, p_limit: filters.limit ?? 30,
    }),
  /**
   * The rows that need restocking, most urgent first (low stock — fewest left first — then out of stock): the dashboard's
   * Inventory Health list. Uses get_admin_inventory_attention(); until that migration is applied it ranks the same rows
   * on the device from the older query instead of showing an arbitrary sample.
   */
  async getInventoryAttention(limit = 5, storeId?: string): Promise<AdminInventoryRow[]> {
    const { data, error } = await supabase.rpc('get_admin_inventory_attention', { p_store_id: storeId ?? null, p_limit: limit });
    if (!error) return data as AdminInventoryRow[];
    const notDeployed = error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
    if (!notDeployed) throw toCatalogueError(error);
    const rows = await callRpc<AdminInventoryRow[]>('get_admin_inventory', {
      p_store_id: storeId ?? null, p_low_stock_only: true, p_search: null, p_cursor: null, p_limit: 100,
    });
    return rankInventoryAttention(rows).slice(0, limit);
  },
  getInventoryStats: (storeId?: string) =>
    callRpc<{ totalSkus: number; lowStock: number; outOfStock: number; totalValue: number }>('get_admin_inventory_stats', {
      p_store_id: storeId ?? null,
    }),
  adjustInventory: (storeId: string, variantId: string, quantityChange: number, movementType: string, reason?: string) =>
    callRpc<{ quantityBefore: number; quantityAfter: number }>('adjust_inventory', {
      p_store_id: storeId, p_product_variant_id: variantId, p_quantity_change: quantityChange, p_movement_type: movementType, p_reason: reason ?? null,
    }),

  getAuditLogs: (cursor?: string, limit = 30, resourceType?: string) =>
    callRpc<AuditLogRow[]>('get_audit_logs', { p_cursor: cursor ?? null, p_limit: limit, p_resource_type: resourceType ?? null }),

  getStaffList: () => callRpc<AdminStaffRow[]>('get_admin_staff_list'),
  assignStoreStaffRole: (phone: string, storeId: string, role: 'store_manager' | 'staff') =>
    callRpc<unknown>('assign_store_staff_role', { p_phone: phone, p_store_id: storeId, p_role: role }),
  deactivateStoreStaff: (storeStaffId: string) => callRpc<void>('deactivate_store_staff', { p_store_staff_id: storeStaffId }),
  assignAdminRole: (phone: string, adminRole: AdminRoleType) => callRpc<unknown>('assign_admin_role', { p_phone: phone, p_admin_role: adminRole }),

  /**
   * Email-invite a rider/store manager who hasn't signed up yet (part of
   * the admin-invites-staff-by-email follow-up). create_staff_invite
   * validates permission + writes the pending invite; the actual email
   * send is a separate, thin Edge Function call since GoTrue's admin
   * invite endpoint requires the service role key, which never reaches
   * the client — see supabase/functions/invite-staff-member.
   */
  async createStaffInvite(input: {
    email: string; fullName: string; role: 'store_manager' | 'staff' | 'rider';
    storeId?: string; vehicleType?: string; vehicleNumber?: string;
  }) {
    return callRpc<{ success: true; inviteId: string }>('create_staff_invite', {
      p_email: input.email, p_full_name: input.fullName, p_role: input.role,
      p_store_id: input.storeId ?? null, p_vehicle_type: input.vehicleType ?? null, p_vehicle_number: input.vehicleNumber ?? null,
    });
  },
  async sendStaffInviteEmail(inviteId: string, redirectTo?: string) {
    const { data, error } = await supabase.functions.invoke('invite-staff-member', {
      body: { invite_id: inviteId, redirect_to: redirectTo },
    });
    if (error) throw new Error(error.message || "Couldn't send the invite email.");
    return data as { success: true };
  },
  getStaffInvites: () => callRpc<AdminStaffInviteRow[]>('get_staff_invites'),

  updateSettings: (patch: Record<string, unknown>) => callRpc<unknown>('update_app_settings', { p_patch: patch }),
  setFeatureFlag: (key: string, enabled: boolean) => callRpc<void>('set_feature_flag', { p_key: key, p_enabled: enabled }),

  // Direct table access — RLS (has_permission-gated, migration 044) already scopes these correctly.
  async getSettings() {
    const { data, error } = await supabase.from('app_settings').select('*').eq('id', true).maybeSingle();
    if (error) throw toCatalogueError(error);
    return data;
  },
  async getFeatureFlags() {
    const { data, error } = await supabase.from('feature_flags').select('*').order('key');
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  async getStores() {
    const { data, error } = await supabase.from('stores').select('*').order('name');
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  async getStore(storeId: string) {
    const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).maybeSingle();
    if (error) throw toCatalogueError(error);
    return data;
  },
  async updateStore(storeId: string, patch: Record<string, unknown>) {
    // `.select('id')` returns the rows actually changed: row-level security turns a not-allowed update into "0 rows, no error", which
    // would otherwise read as a successful save.
    const { data, error } = await supabase.from('stores').update(patch).eq('id', storeId).select('id');
    if (error) throw toCatalogueError(error);
    if (!data || data.length === 0) throw new Error("You don't have permission to edit this store.");
  },
  /** Batch-resolves one representative product thumbnail per order id — used to give order/delivery notifications a real image instead of a bare icon (redesign section 29-31), without an N+1 query per notification row. */
  async getOrderThumbnails(orderIds: string[]): Promise<Record<string, string | null>> {
    if (orderIds.length === 0) return {};
    const { data, error } = await supabase
      .from('order_items')
      .select('order_id, image_snapshot')
      .in('order_id', Array.from(new Set(orderIds)));
    if (error) throw toCatalogueError(error);
    const map: Record<string, string | null> = {};
    for (const row of data ?? []) {
      if (!map[row.order_id] && row.image_snapshot) map[row.order_id] = row.image_snapshot;
    }
    for (const id of orderIds) if (!(id in map)) map[id] = null;
    return map;
  },
  /** Real staff roster for one store's Profile screen (redesign section 32). */
  async getStoreStaff(storeId: string) {
    const { data, error } = await supabase
      .from('store_staff')
      .select('id, role, is_active, profiles(full_name, phone, avatar_url)')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('role');
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  async getRiders() {
    const { data, error } = await supabase.from('riders').select('*, profiles(full_name, phone, avatar_url), stores(name)').order('created_at', { ascending: false });
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  async getRider(riderId: string) {
    const { data, error } = await supabase
      .from('riders')
      .select('*, profiles(full_name, phone, email, avatar_url, created_at), stores(id, name)')
      .eq('id', riderId)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    return data;
  },
  /** Today's + lifetime delivery stats for one rider — real aggregates, never fabricated (redesign section 16). */
  async getRiderStats(riderId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [todayRes, lifetimeRes, failedRes] = await Promise.all([
      supabase.from('delivery_assignments').select('id', { count: 'exact', head: true }).eq('rider_id', riderId).eq('status', 'completed').gte('completed_at', today.toISOString()),
      supabase.from('delivery_assignments').select('id', { count: 'exact', head: true }).eq('rider_id', riderId).eq('status', 'completed'),
      supabase.from('delivery_assignments').select('id', { count: 'exact', head: true }).eq('rider_id', riderId).eq('status', 'failed'),
    ]);
    const completed = lifetimeRes.count ?? 0;
    const failed = failedRes.count ?? 0;
    const attempted = completed + failed;
    return {
      deliveredToday: todayRes.count ?? 0,
      deliveredLifetime: completed,
      failedLifetime: failed,
      successRate: attempted > 0 ? Math.round((completed / attempted) * 1000) / 10 : null,
    };
  },
  /** Recent delivery history for one rider, with proof-photo presence flagged — real rows, most recent first (redesign section 18). */
  async getRiderHistory(riderId: string, limit = 30) {
    const { data, error } = await supabase
      .from('delivery_assignments')
      .select('id, status, assigned_at, completed_at, failed_at, cash_collected, delivery_proof_photo_url, order_id, orders(order_number, total)')
      .eq('rider_id', riderId)
      .in('status', ['completed', 'failed', 'cancelled'])
      .order('assigned_at', { ascending: false })
      .limit(limit);
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  // ---- Home banners and offers (promotions.manage) ----------------------------------------------------------------------------
  async getPromotions(): Promise<{ banners: AdminBannerRow[]; offers: AdminOfferRow[] }> {
    const { data, error } = await supabase.rpc('admin_get_promotions');
    if (error) throw new Error(describeAdminWriteError(error, 'banners and offers'));
    const d = (data ?? {}) as { banners?: AdminBannerRow[]; offers?: AdminOfferRow[] };
    return { banners: d.banners ?? [], offers: d.offers ?? [] };
  },
  async saveBanner(id: string | null, v: PromotionSave & { eyebrow: string | null; theme: 'dark' | 'light'; targetUrl: string | null }): Promise<string> {
    const { data, error } = await supabase.rpc('admin_save_banner', {
      p_id: id, p_title: v.title, p_subtitle: v.subtitle, p_eyebrow: v.eyebrow, p_image_url: v.imageUrl, p_cta_label: v.ctaLabel, p_theme: v.theme,
      p_target_type: v.targetType, p_target_id: v.targetId, p_target_url: v.targetUrl, p_start_at: v.startAt, p_end_at: v.endAt, p_sort_order: v.sortOrder, p_is_active: v.isActive,
    });
    if (error) throw new Error(describeAdminWriteError(error, 'the banner'));
    return data as string;
  },
  async saveOffer(id: string | null, v: PromotionSave & { category: OfferCategory }): Promise<string> {
    const { data, error } = await supabase.rpc('admin_save_offer', {
      p_id: id, p_title: v.title, p_subtitle: v.subtitle, p_image_url: v.imageUrl, p_cta_label: v.ctaLabel, p_category: v.category,
      p_target_type: v.targetType, p_target_id: v.targetId, p_start_at: v.startAt, p_end_at: v.endAt, p_sort_order: v.sortOrder, p_is_active: v.isActive,
    });
    if (error) throw new Error(describeAdminWriteError(error, 'the offer'));
    return data as string;
  },
  async setPromotionActive(kind: 'banner' | 'offer', id: string, active: boolean) {
    const { error } = await supabase.rpc('admin_set_promotion_active', { p_kind: kind, p_id: id, p_active: active });
    if (error) throw new Error(describeAdminWriteError(error, `the ${kind}`));
  },
  async deletePromotion(kind: 'banner' | 'offer', id: string) {
    const { error } = await supabase.rpc('admin_delete_promotion', { p_kind: kind, p_id: id });
    if (error) throw new Error(describeAdminWriteError(error, `the ${kind}`));
  },
  // ---- Delivery pricing zones (zones.manage) -----------------------------------------------------------------------------------
  async getZones(): Promise<AdminZoneRow[]> {
    const { data, error } = await supabase.rpc('admin_get_zones');
    if (error) throw new Error(describeAdminWriteError(error, 'delivery areas'));
    return (data ?? []) as AdminZoneRow[];
  },
  async updateZone(zoneId: string, patch: ZonePatch & { isActive?: boolean }) {
    const { error } = await supabase.rpc('admin_update_zone', {
      p_zone_id: zoneId, p_name: patch.name ?? null, p_delivery_fee: patch.deliveryFee ?? null, p_minimum_order_value: patch.minimumOrderValue ?? null,
      p_free_delivery_threshold: patch.freeDeliveryThreshold ?? null, p_no_free_delivery: patch.noFreeDelivery ?? false,
      p_estimated_minutes: patch.estimatedMinutes ?? null, p_is_active: patch.isActive ?? null,
    });
    if (error) throw new Error(describeAdminWriteError(error, 'the delivery area'));
  },
  /**
   * Edits a rider through admin_update_rider — direct UPDATE on `riders` is revoked from app users by design, so the old
   * `from('riders').update(...)` here failed for every admin (including the super admin). Only the keys present are changed.
   */
  async updateRider(riderId: string, patch: RiderPatch) {
    const { error } = await supabase.rpc('admin_update_rider', {
      p_rider_id: riderId,
      p_full_name: patch.fullName ?? null,
      p_vehicle_type: patch.vehicleType ?? null,
      p_vehicle_number: patch.vehicleNumber ?? null,
      p_primary_store_id: patch.primaryStoreId ?? null,
      p_max_active_deliveries: patch.maxActiveDeliveries ?? null,
      p_is_active: patch.isActive ?? null,
    });
    if (error) throw new Error(describeRiderEditError(error));
  },
  async setRiderActive(riderId: string, isActive: boolean) {
    const { error } = await supabase.rpc('admin_update_rider', { p_rider_id: riderId, p_is_active: isActive });
    if (error) throw new Error(describeRiderEditError(error));
  },
  async setRiderAvatar(riderId: string, avatarUrl: string | null) {
    const { error } = await supabase.rpc('admin_set_rider_avatar', { p_rider_id: riderId, p_avatar_url: avatarUrl });
    if (error) throw toCatalogueError(error);
  },
  async getActiveDeliveries() {
    const { data, error } = await supabase
      .from('delivery_assignments')
      .select('id, status, assigned_at, order_id, orders(order_number, total), riders(id, vehicle_type, profiles(full_name, avatar_url)), stores(name)')
      .not('status', 'in', '(completed,cancelled,declined,expired,failed)')
      .order('assigned_at', { ascending: false });
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  /** Every delivery, any status, for the Deliveries management screen (redesign section 26) — richer than getActiveDeliveries (which deliberately excludes terminal states for the live dispatch view). */
  async getDeliveries(filters: { statuses?: string[]; search?: string; limit?: number } = {}) {
    let query = supabase
      .from('delivery_assignments')
      .select(
        'id, status, assigned_at, completed_at, failed_at, delivery_proof_photo_url, order_id, ' +
        // orders has TWO foreign keys to profiles (user_id and cancelled_by,
        // added in 20260826000098), so a bare profiles(...) embed is ambiguous
        // and PostgREST rejects the whole query (PGRST201). Name the customer
        // relationship explicitly.
        `orders(order_number, total, order_items(image_snapshot), ${ORDER_CUSTOMER_EMBED}(full_name)), ` +
        'riders(id, vehicle_type, profiles(full_name, avatar_url)), stores(name)',
      )
      .order('assigned_at', { ascending: false })
      .limit(filters.limit ?? 60);
    if (filters.statuses && filters.statuses.length > 0) query = query.in('status', filters.statuses);
    if (filters.search) query = query.filter('orders.order_number', 'ilike', `%${filters.search}%`);
    const { data, error } = await query;
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  /** Full delivery profile — real timeline timestamps (delivery_assignments has one column per real stage transition), for the Delivery Profile detail screen (redesign section 21-23). */
  async getDeliveryDetail(assignmentId: string) {
    const { data, error } = await supabase
      .from('delivery_assignments')
      .select(
        'id, status, assigned_at, accepted_at, arrived_at_store_at, picked_up_at, out_for_delivery_at, completed_at, failed_at, failure_reason, ' +
        'cash_collected, delivery_proof_photo_url, delivery_proof_latitude, delivery_proof_longitude, ' +
        `order_id, orders(order_number, total, status, placed_at, ${ORDER_CUSTOMER_EMBED}(id, full_name, phone), order_items(id, product_name_snapshot, variant_snapshot, image_snapshot, quantity, unit_price)), ` +
        'riders(id, vehicle_type, vehicle_number, profiles(full_name, phone, avatar_url)), stores(id, name, address_line)',
      )
      .eq('id', assignmentId)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    return data;
  },
  /** Recent orders with per-order product-image snapshots, for the Dashboard's visual "Recent Orders" strip (redesign section 9) — real rows, real thumbnails, never a placeholder. */
  async getRecentOrdersWithThumbnails(limit = 8) {
    const { data, error } = await supabase
      .from('orders')
      .select(
        'id, order_number, status, total, placed_at, ' +
        `${ORDER_CUSTOMER_EMBED}(full_name), stores(name), ` +
        'order_items(image_snapshot, product_name_snapshot), ' +
        'delivery_assignments(status, riders(profiles(full_name)))',
      )
      .order('placed_at', { ascending: false })
      .limit(limit);
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  /**
   * Realtime for the Admin Dashboard/Orders/Deliveries screens
   * (pre-production hardening, priority 1) — admin sees every store, so
   * unlike storeOpsRepository.subscribeToStoreActivity these are
   * unfiltered, but each is scoped to only the tables that screen
   * actually displays (priority 1: "prefer targeted subscriptions"),
   * not one firehose reused everywhere. Same "something changed, go
   * refetch" signal as Phase 09/store-ops — the caller's own existing
   * load() does the actual refetch, no second data source here.
   */
  subscribeToAdminDashboard(onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'orders' }, { table: 'delivery_assignments' }, { table: 'riders' }, { table: 'inventory' }], onChange);
  },
  subscribeToAdminOrders(onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'orders' }, { table: 'delivery_assignments' }], onChange);
  },
  /**
   * One order's detail screen: only that order's row and its delivery assignments (rider assigned / reassigned / picked up …).
   * Payment and cancellation also surface here because both write `orders.status` / `orders.payment_status`.
   * `catchUpOnConnect`: a detail screen is small and exactness matters more than one extra fetch.
   */
  subscribeToAdminOrder(orderId: string, onChange: () => void): () => void {
    return liveFeed.watch(
      [
        { table: 'orders', filter: `id=eq.${orderId}` },
        { table: 'delivery_assignments', filter: `order_id=eq.${orderId}` },
      ],
      onChange,
      { catchUpOnConnect: true },
    );
  },
  /** One delivery assignment's detail screen (status, rider, proof). */
  subscribeToAdminDelivery(assignmentId: string, onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'delivery_assignments', filter: `id=eq.${assignmentId}` }], onChange, { catchUpOnConnect: true });
  },
  subscribeToAdminDeliveries(onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'delivery_assignments' }, { table: 'riders' }], onChange);
  },
  subscribeToAdminRiders(onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'riders' }], onChange);
  },
  getActiveRiderLocations: () => callRpc<AdminRiderLocation[]>('get_active_rider_locations'),
  getAnalytics: (days = 30) => callRpc<AdminAnalytics>('get_admin_analytics', { p_days: days }),
  // Pagination (part 34): a growing catalogue shouldn't load unbounded
  // rows — cursor is the last-seen row's created_at, same shape as
  // getOrders' cursor below.
  async getProducts(opts: { search?: string; cursor?: string; limit?: number } = {}) {
    let query = supabase
      .from('products')
      .select('*, categories(name), product_variants(id, sku, price, mrp, is_active)')
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 30);
    if (opts.search) query = query.ilike('name', `%${opts.search}%`);
    if (opts.cursor) query = query.lt('created_at', opts.cursor);
    const { data, error } = await query;
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  /** Real counts for the Products list header stat cards — head:true count queries, never derived from a paginated page's row count (which would misreport the true total). */
  async getProductStats() {
    const [total, active, categories] = await Promise.all([
      supabase.from('products').select('id', { count: 'exact', head: true }),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('categories').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ]);
    return { total: total.count ?? 0, active: active.count ?? 0, categories: categories.count ?? 0 };
  },
  async getProduct(productId: string): Promise<AdminProductDetail | null> {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_variants(*)')
      .eq('id', productId)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    return data as AdminProductDetail | null;
  },
  async setProductActive(productId: string, isActive: boolean) {
    const { error } = await supabase.from('products').update({ is_active: isActive }).eq('id', productId);
    if (error) throw toCatalogueError(error);
  },
  /** Transactional create — product + every variant + opening store inventory in one call (part 28); rolls back entirely on a bad SKU/price. */
  async createProduct(product: AdminProductInput, variants: AdminVariantInput[], inventory: AdminInventoryInput[] = []) {
    return callRpc<{ success: true; productId: string; variantIds: string[] }>('admin_create_product_full', {
      p_product: product,
      p_variants: variants,
      p_inventory: inventory,
    });
  },
  /**
   * Which of these SKUs already belong to another variant (case-insensitive,
   * the same rule the database applies), so a clash is reported on the
   * Variants step rather than only when Publish fails. Advisory: the RPCs
   * re-check inside their own transaction.
   */
  async findTakenSkus(variants: { sku: string; id?: string }[]): Promise<string[]> {
    const taken: string[] = [];
    await Promise.all(
      variants.map(async (v) => {
        const sku = v.sku.trim();
        if (!sku) return;
        let query = supabase.from('product_variants').select('id, sku').ilike('sku', escapeLikePattern(sku)).limit(1);
        if (v.id) query = query.neq('id', v.id);
        const { data, error } = await query;
        if (error) throw toCatalogueError(error);
        if (data && data.length > 0) taken.push(normalizeSku(sku));
      }),
    );
    return taken;
  },
  async updateProduct(productId: string, product: AdminProductInput) {
    await callRpc('admin_update_product', { p_product_id: productId, p_product: product });
  },
  /** p_variant_id null = create a new variant on an existing product. */
  async upsertVariant(variantId: string | null, productId: string, variant: AdminVariantInput) {
    return callRpc<{ success: true; variantId: string }>('admin_upsert_variant', {
      p_variant_id: variantId,
      p_product_id: productId,
      p_sku: variant.sku,
      p_weight_value: variant.weight_value,
      p_weight_unit: variant.weight_unit,
      p_price: variant.price,
      p_mrp: variant.mrp,
    });
  },
  async setVariantActive(variantId: string, isActive: boolean) {
    await callRpc('admin_set_variant_active', { p_variant_id: variantId, p_is_active: isActive });
  },
  /** Creates the (store, variant) inventory row if it doesn't exist yet, or safely updates it if it does — closes the gap where adjust_inventory/record_inventory_adjustment both require an existing row. */
  async initializeInventory(storeId: string, variantId: string, quantity: number, reorderLevel = 5, isAvailable = true) {
    await callRpc('admin_initialize_inventory', {
      p_store_id: storeId,
      p_variant_id: variantId,
      p_quantity: quantity,
      p_reorder_level: reorderLevel,
      p_is_available: isAvailable,
    });
  },
  async getInventoryForVariants(variantIds: string[]) {
    if (variantIds.length === 0) return [];
    const { data, error } = await supabase
      .from('inventory')
      .select('store_id, product_variant_id, quantity, reorder_level, is_available')
      .in('product_variant_id', variantIds);
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  async getCategories() {
    const { data, error } = await supabase.from('categories').select('*').order('sort_order');
    if (error) throw toCatalogueError(error);
    return data ?? [];
  },
  /** Through admin_set_category_active so the change is in the audit log (a bare table write left no trace of who hid a category). */
  async setCategoryActive(categoryId: string, isActive: boolean) {
    const { error } = await supabase.rpc('admin_set_category_active', { p_category_id: categoryId, p_active: isActive });
    if (error) throw new Error(describeAdminWriteError(error, 'the category'));
  },
  async createCategory(input: AdminCategoryInput) {
    return callRpc<{ success: true; categoryId: string }>('admin_create_category', {
      p_name: input.name, p_slug: input.slug, p_description: input.description ?? null,
      p_image_url: input.image_url ?? null, p_parent_id: input.parent_id ?? null, p_sort_order: input.sort_order ?? 0,
    });
  },
  async updateCategory(categoryId: string, input: AdminCategoryInput) {
    await callRpc('admin_update_category', {
      p_category_id: categoryId, p_name: input.name, p_description: input.description ?? null,
      p_image_url: input.image_url ?? null, p_parent_id: input.parent_id ?? null, p_sort_order: input.sort_order ?? 0,
    });
  },
  /**
   * Realtime for the Products/Categories admin screens (parts 11/12) —
   * live-reflects another admin's catalogue edit without a manual
   * refresh. Same "something changed, go refetch" signal as
   * subscribeToAdminDashboard.
   */
  subscribeToAdminCatalogue(onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'products' }, { table: 'product_variants' }, { table: 'categories' }], onChange);
  },
  /**
   * Realtime for the Admin Inventory screen (final pre-launch hardening
   * audit) — every other admin list screen (Dashboard/Orders/
   * Deliveries/Riders/Products/Categories) already has a
   * subscribeToAdmin* channel; the inventory table already has one
   * wired up via subscribeToAdminDashboard (for the stat cards), but
   * the actual Inventory list screen itself — the one an admin uses to
   * adjust stock — only refetched on focus, so a second admin's
   * concurrent adjustment (or stock consumed by a live order) stayed
   * invisible until the first admin left and came back.
   */
  subscribeToAdminInventory(onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'inventory' }], onChange);
  },

  // -------------------------------------------------------------------
  // QA / Demo Control Panel (Final Dispatch pass, settings.manage-gated
  // both here and, authoritatively, server-side — see
  // 20260826000095_qa_demo_control_panel.sql). Deliberately reuses
  // storeOpsRepository (getEligibleRidersForDispatch/startDispatchRound)
  // and riderOpsRepository.acceptDeliveryOffer for everything that
  // already has a real customer/store/rider equivalent — the functions
  // below only cover the handful of actions with no real-user
  // equivalent to call through (seeding a demo order, fast-forwarding
  // an expiry, flipping a rider's state on another rider's behalf).
  // -------------------------------------------------------------------

  /** Demo customer accounts only (the seeded @govindpansari.dev pool) — never lists a real customer as a pickable target for a QA-created order. */
  async getDemoCustomers(): Promise<{ id: string; name: string; phone: string | null }[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone')
      .eq('role', 'customer')
      .ilike('email', '%@govindpansari.dev')
      .order('full_name');
    if (error) throw toCatalogueError(error);
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.full_name ?? 'Demo Customer', phone: r.phone }));
  },

  /** Every open delivery_assignments row right now — used to mark which riders are currently BUSY (a real assignment, never a stored flag) in the QA panel's rider list. */
  async getBusyRiderIds(): Promise<Set<string>> {
    const { data, error } = await supabase
      .from('delivery_assignments')
      .select('rider_id')
      .not('status', 'in', '(completed,cancelled,declined,expired,failed)');
    if (error) throw toCatalogueError(error);
    return new Set((data ?? []).map((r: any) => r.rider_id));
  },

  /** Recent QA-seeded demo orders only (idempotency_key tag), newest first — never a real customer's order. */
  async getDemoOrders(limit = 15) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, status, total, store_id, placed_at, stores(name)')
      .like('idempotency_key', 'qa-demo-%')
      .order('placed_at', { ascending: false })
      .limit(limit);
    if (error) throw toCatalogueError(error);
    return (data ?? []).map((r: any) => ({
      id: r.id, orderNumber: r.order_number, status: r.status, total: Number(r.total),
      storeId: r.store_id, storeName: r.stores?.name ?? '—', placedAt: r.placed_at,
    }));
  },

  async qaCreateDemoOrder(customerId: string, storeId: string): Promise<{ success: boolean; orderId?: string; orderNumber?: string; message?: string }> {
    const { data, error } = await supabase.rpc('qa_create_demo_order', { p_customer_id: customerId, p_store_id: storeId, p_variant_id: null, p_quantity: 1 });
    if (error) throw toCatalogueError(error);
    return data;
  },

  /** The open round's offers with real ids (storeOpsRepository's DispatchRoundInfo intentionally omits offer ids — customer/store screens never act on one directly; the QA panel needs them to drive Simulate Accept). */
  async getDispatchOffersForRound(roundId: string): Promise<{ offerId: string; riderId: string; riderName: string; status: string; distanceMeters: number | null }[]> {
    const { data, error } = await supabase
      .from('delivery_offers')
      .select('id, rider_id, status, distance_meters, riders(profiles(full_name))')
      .eq('dispatch_round_id', roundId);
    if (error) throw toCatalogueError(error);
    return (data ?? []).map((o: any) => ({
      offerId: o.id, riderId: o.rider_id, riderName: o.riders?.profiles?.full_name ?? 'Rider',
      status: o.status, distanceMeters: o.distance_meters != null ? Number(o.distance_meters) : null,
    }));
  },

  async qaExpireDispatchRound(roundId: string): Promise<void> {
    const { error } = await supabase.rpc('qa_expire_dispatch_round', { p_round_id: roundId });
    if (error) throw toCatalogueError(error);
  },

  async qaSetRiderAvailability(riderId: string, available: boolean): Promise<void> {
    const { error } = await supabase.rpc('qa_set_rider_availability', { p_rider_id: riderId, p_available: available });
    if (error) throw toCatalogueError(error);
  },

  async qaMakeRiderBusy(riderId: string, customerId: string): Promise<{ success: boolean; orderId?: string; message?: string }> {
    const { data, error } = await supabase.rpc('qa_make_rider_busy', { p_rider_id: riderId, p_customer_id: customerId });
    if (error) throw toCatalogueError(error);
    return data;
  },

  async qaClearRiderBusy(riderId: string): Promise<void> {
    const { error } = await supabase.rpc('qa_clear_rider_busy', { p_rider_id: riderId });
    if (error) throw toCatalogueError(error);
  },

  async qaResetDemoState(): Promise<{ success: boolean; cancelledOrders: number }> {
    const { data, error } = await supabase.rpc('qa_reset_demo_state');
    if (error) throw toCatalogueError(error);
    return data;
  },
};
