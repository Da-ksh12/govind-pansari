import { PIPELINE_STAGES, type OrdersListView } from './dashboardMetrics';

/**
 * Filters for the admin Orders list. Pipeline stages come straight from
 * PIPELINE_STAGES so a stage's list holds exactly the statuses that stage
 * counted on the dashboard; "Active", "Needs Rider" and "Delivery Issues"
 * are server-side views (get_admin_orders p_view) matching the cards that
 * link to them.
 */
export interface OrderFilter {
  key: string;
  label: string;
  statuses?: string[];
  view?: OrdersListView;
}

export const ORDER_FILTERS: OrderFilter[] = [
  { key: 'all', label: 'All Orders' },
  { key: 'active', label: 'Active', view: 'active' },
  ...PIPELINE_STAGES.map((s) => ({ key: s.key, label: s.label, statuses: s.statuses })),
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { key: 'needs_rider', label: 'Needs Rider', view: 'needs_rider' as const },
  { key: 'stuck', label: 'Delivery Issues', view: 'stuck_delivery' as const },
];

export interface OrdersRouteParams {
  view?: string;
  stage?: string;
  status?: string;
}

/** Resolves the Orders screen's route params (from a dashboard card, a pipeline stage or an older ?status= link) to a filter key. */
export function filterKeyFromParams(params: OrdersRouteParams): string {
  if (params.view) {
    const byView = ORDER_FILTERS.find((f) => f.view === params.view);
    if (byView) return byView.key;
  }
  if (params.stage) {
    const byStage = ORDER_FILTERS.find((f) => f.key === params.stage);
    if (byStage) return byStage.key;
  }
  if (params.status) {
    const exact = ORDER_FILTERS.find((f) => f.statuses?.length === 1 && f.statuses[0] === params.status);
    if (exact) return exact.key;
    const containing = ORDER_FILTERS.find((f) => f.statuses?.includes(params.status as string));
    if (containing) return containing.key;
  }
  return 'all';
}

export interface OrdersQuery {
  status?: string;
  statuses?: string[];
  view?: OrdersListView;
}

/**
 * Maps a filter to the RPC arguments. A single status uses the original
 * p_status argument (so it keeps working against a server that predates
 * p_statuses/p_view); only multi-status stages and views need the newer ones.
 */
export function queryForFilter(filter: OrderFilter): OrdersQuery {
  if (filter.view) return { view: filter.view };
  if (!filter.statuses || filter.statuses.length === 0) return {};
  if (filter.statuses.length === 1) return { status: filter.statuses[0] };
  return { statuses: filter.statuses };
}

/**
 * Client mirror of the server's order_awaits_online_payment(): the order isn't
 * paid and its latest payment attempt is a prepaid method (anything but COD).
 * An order with no payment row isn't treated as waiting — same as the SQL.
 */
export function awaitsOnlinePayment(
  orderPaymentStatus: string,
  payments: { method: string; created_at: string }[] | null | undefined,
): boolean {
  if (orderPaymentStatus === 'paid' || !payments || payments.length === 0) return false;
  const latest = payments.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  return latest.method !== 'cod';
}
