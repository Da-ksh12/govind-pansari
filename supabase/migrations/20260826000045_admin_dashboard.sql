-- Admin Control Center, part 5: the dashboard (section 4/36/43) — one
-- function, one round trip, computed server-side so the client never
-- runs its own aggregate queries against orders/inventory/riders
-- directly (section 36/54).

create or replace function get_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today timestamptz := date_trunc('day', now());
  v_result jsonb;
begin
  if not has_permission('dashboard.view') then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'today', jsonb_build_object(
      'orders', (select count(*) from orders where placed_at >= v_today),
      'revenue', (select coalesce(sum(total), 0) from orders where placed_at >= v_today and status != 'cancelled'),
      'itemsSold', (select coalesce(sum(oi.quantity), 0) from order_items oi join orders o on o.id = oi.order_id where o.placed_at >= v_today and o.status != 'cancelled'),
      'averageOrderValue', (select coalesce(round(avg(total), 2), 0) from orders where placed_at >= v_today and status != 'cancelled'),
      'activeDeliveries', (select count(*) from delivery_assignments where not is_terminal_delivery_status(status)),
      'completedDeliveries', (select count(*) from delivery_assignments where status = 'completed' and completed_at >= v_today),
      'failedDeliveries', (select count(*) from delivery_assignments where status = 'failed' and failed_at >= v_today),
      'newCustomers', (select count(*) from profiles where role = 'customer' and created_at >= v_today)
    ),
    'operations', jsonb_build_object(
      'pendingOrders', (select count(*) from orders where status = 'placed'),
      'ordersPreparing', (select count(*) from orders where status in ('confirmed', 'preparing', 'picking', 'packing')),
      'ordersReady', (select count(*) from orders where status = 'packed'),
      'unassignedDeliveries', (
        select count(*) from orders o where o.status = 'packed'
          and not exists (select 1 from delivery_assignments da where da.order_id = o.id and not is_terminal_delivery_status(da.status))
      ),
      'activeRiders', (select count(*) from riders where is_active and is_available),
      -- "Delayed" — an in-flight leg running well past the window a
      -- normal delivery takes (no per-assignment ETA is stored, so
      -- this is a deliberately generous heuristic, not a precise SLA
      -- breach — see docs/admin-architecture.md).
      'delayedDeliveries', (select count(*) from delivery_assignments where status in ('accepted', 'at_store', 'picked_up', 'in_transit') and assigned_at < now() - interval '45 minutes')
    ),
    'inventory', jsonb_build_object(
      'lowStock', (select count(*) from inventory where is_available and (quantity - reserved_quantity) > 0 and (quantity - reserved_quantity) <= reorder_level),
      'outOfStock', (select count(*) from inventory where (quantity - reserved_quantity) <= 0),
      'alerts', (select count(*) from inventory where (quantity - reserved_quantity) <= reorder_level)
    ),
    'customers', jsonb_build_object(
      'newThisWeek', (select count(*) from profiles where role = 'customer' and created_at >= now() - interval '7 days'),
      'returning', (
        select count(*) from (
          select user_id from orders where status != 'cancelled' group by user_id having count(*) > 1
        ) x
      )
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function get_admin_dashboard is 'Single-round-trip dashboard aggregate (section 43/54) — every number computed server-side; the client renders, never recomputes.';

revoke all on function get_admin_dashboard from public, anon;
grant execute on function get_admin_dashboard to authenticated;
