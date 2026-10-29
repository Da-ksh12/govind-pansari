/**
 * Shared, framework-free definitions for the admin dashboard so the cards,
 * the Live Order Pipeline and the Orders list can never disagree about
 * what "active" or a pipeline stage means (QA TC-07 / TC-15). The SQL side
 * of the same definitions lives in is_active_order_status() and
 * get_admin_dashboard() (supabase/migrations/20260827000003-04).
 */

/** Every order status that is not terminal. Mirrors is_active_order_status() in SQL. */
export const ACTIVE_ORDER_STATUSES = [
  'placed',
  'confirmed',
  'preparing',
  'picking',
  'packing',
  'packed',
  'rider_assigned',
  'out_for_delivery',
  'approaching',
] as const;

export function isActiveOrderStatus(status: string): boolean {
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(status);
}

export interface PipelineStage {
  key: string;
  label: string;
  statuses: string[];
}

/**
 * Each active status belongs to exactly one stage, so the stage counts add
 * up to the Active Orders figure. "Delivered" is the one terminal stage
 * shown, and it counts today's deliveries only.
 */
export const PIPELINE_STAGES: PipelineStage[] = [
  { key: 'new', label: 'New', statuses: ['placed'] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['confirmed'] },
  { key: 'preparing', label: 'Preparing', statuses: ['preparing', 'picking', 'packing'] },
  { key: 'ready', label: 'Ready', statuses: ['packed'] },
  { key: 'rider', label: 'Rider Assigned', statuses: ['rider_assigned'] },
  { key: 'onway', label: 'On the Way', statuses: ['out_for_delivery', 'approaching'] },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'] },
];

export interface DashboardOperations {
  pendingOrders: number;
  ordersPreparing: number;
  ordersReady: number;
  activeOrders?: number;
  awaitingPayment?: number;
  stuckDeliveries?: number;
  deliveredToday?: number;
  byStatus?: Record<string, number>;
  todayByStatus?: Record<string, number>;
}

/**
 * The one Active Orders number. A server that has the consistent-definitions
 * migration returns it directly; an older server falls back to the buckets
 * it does return.
 */
export function activeOrderCount(ops: DashboardOperations): number {
  if (typeof ops.activeOrders === 'number') return ops.activeOrders;
  return ops.pendingOrders + ops.ordersPreparing + ops.ordersReady;
}

/**
 * Orders in each pipeline stage right now. Uses the current-state counts
 * (byStatus, every active order regardless of the day it was placed); falls
 * back to today-only counts only for an older server.
 */
export function pipelineCounts(ops: DashboardOperations): Record<string, number> {
  const current = ops.byStatus ?? ops.todayByStatus ?? {};
  const counts: Record<string, number> = {};
  for (const stage of PIPELINE_STAGES) {
    if (stage.key === 'delivered') {
      counts[stage.key] = ops.deliveredToday ?? current.delivered ?? 0;
      continue;
    }
    counts[stage.key] = stage.statuses.reduce((sum, s) => sum + (current[s] ?? 0), 0);
  }
  return counts;
}

/** Where a dashboard card should send the user — the Orders list view that holds exactly the orders the card counted. */
export type OrdersListView = 'active' | 'needs_rider' | 'stuck_delivery';

export function ordersRouteForView(view: OrdersListView): string {
  return `/admin/orders?view=${view}`;
}

/** A pipeline stage's own list: the Orders screen resolves the stage key back to its statuses, so "Preparing" shows preparing + picking + packing, exactly what the stage counted. */
export function ordersRouteForStage(stageKey: string): string {
  return `/admin/orders?stage=${stageKey}`;
}

export function statusesForStage(stageKey: string): string[] | undefined {
  return PIPELINE_STAGES.find((s) => s.key === stageKey)?.statuses;
}
