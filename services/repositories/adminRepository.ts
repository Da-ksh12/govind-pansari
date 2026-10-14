import { supabase, uniqueChannel } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';

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
  | 'users.view' | 'users.manage'
  | 'audit_logs.view';

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

  getOrders: (filters: { status?: string; storeId?: string; riderId?: string; search?: string; dateFrom?: string; dateTo?: string; cursor?: string; limit?: number }) =>
    callRpc<AdminOrderRow[]>('get_admin_orders', {
      p_status: filters.status ?? null, p_store_id: filters.storeId ?? null, p_rider_id: filters.riderId ?? null,
      p_search: filters.search ?? null, p_date_from: filters.dateFrom ?? null, p_date_to: filters.dateTo ?? null,
      p_cursor: filters.cursor ?? null, p_limit: filters.limit ?? 20,
    }),
  getOrderDetail: (orderId: string) => callRpc<any>('get_admin_order_detail', { p_order_id: orderId }),
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
    const { error } = await supabase.from('stores').update(patch).eq('id', storeId);
    if (error) throw toCatalogueError(error);
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
  async setRiderActive(riderId: string, isActive: boolean) {
    const { error } = await supabase.from('riders').update({ is_active: isActive }).eq('id', riderId);
    if (error) throw toCatalogueError(error);
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
        'orders(order_number, total, order_items(image_snapshot), profiles(full_name)), ' +
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
        'order_id, orders(order_number, total, status, placed_at, profiles(id, full_name, phone), order_items(id, product_name_snapshot, variant_snapshot, image_snapshot, quantity, unit_price)), ' +
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
        'profiles(full_name), stores(name), ' +
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
    const channel = uniqueChannel('admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'riders' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, onChange)
      .subscribe();
    return () => supabase.removeChannel(channel);
  },
  subscribeToAdminOrders(onChange: () => void): () => void {
    const channel = uniqueChannel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments' }, onChange)
      .subscribe();
    return () => supabase.removeChannel(channel);
  },
  subscribeToAdminDeliveries(onChange: () => void): () => void {
    const channel = uniqueChannel('admin-deliveries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'riders' }, onChange)
      .subscribe();
    return () => supabase.removeChannel(channel);
  },
  subscribeToAdminRiders(onChange: () => void): () => void {
    const channel = uniqueChannel('admin-riders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'riders' }, onChange)
      .subscribe();
    return () => supabase.removeChannel(channel);
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
  async setCategoryActive(categoryId: string, isActive: boolean) {
    const { error } = await supabase.from('categories').update({ is_active: isActive }).eq('id', categoryId);
    if (error) throw toCatalogueError(error);
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
    const channel = uniqueChannel('admin-catalogue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_variants' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, onChange)
      .subscribe();
    return () => supabase.removeChannel(channel);
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
    const channel = uniqueChannel('admin-inventory')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, onChange)
      .subscribe();
    return () => supabase.removeChannel(channel);
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
