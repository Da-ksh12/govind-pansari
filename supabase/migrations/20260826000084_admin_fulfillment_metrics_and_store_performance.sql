-- Premium admin redesign: two real metrics the dashboard/store-
-- performance UI needs that nothing in the schema computed yet —
-- average fulfillment time (order placed -> ready for pickup) and
-- average delivery time (ready for pickup -> delivered), plus a
-- per-store breakdown so the owner can actually compare stores
-- instead of only seeing combined totals. Both are real aggregates
-- over real timestamp columns (orders.placed_at/ready_at/delivered_at,
-- added in 20260825000022/20260825000026) — never fabricated, and
-- both return null/empty rather than 0 when there's no data yet to
-- average, so the client can render an honest "not available yet"
-- state instead of a misleading zero.

create or replace function get_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today timestamptz := date_trunc('day', now());
  v_yesterday timestamptz := date_trunc('day', now()) - interval '1 day';
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
    'yesterday', jsonb_build_object(
      'orders', (select count(*) from orders where placed_at >= v_yesterday and placed_at < v_today),
      'revenue', (select coalesce(sum(total), 0) from orders where placed_at >= v_yesterday and placed_at < v_today and status != 'cancelled'),
      'itemsSold', (select coalesce(sum(oi.quantity), 0) from order_items oi join orders o on o.id = oi.order_id where o.placed_at >= v_yesterday and o.placed_at < v_today and o.status != 'cancelled'),
      'averageOrderValue', (select coalesce(round(avg(total), 2), 0) from orders where placed_at >= v_yesterday and placed_at < v_today and status != 'cancelled'),
      'newCustomers', (select count(*) from profiles where role = 'customer' and created_at >= v_yesterday and created_at < v_today)
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
      'delayedDeliveries', (select count(*) from delivery_assignments where status in ('accepted', 'at_store', 'picked_up', 'in_transit') and assigned_at < now() - interval '45 minutes'),
      -- Today's orders that have actually reached each milestone —
      -- an order still mid-flight has no ready_at/delivered_at yet
      -- and is correctly excluded, not counted as zero.
      'avgFulfillmentMinutes', (
        select round(avg(extract(epoch from (ready_at - placed_at)) / 60)::numeric, 1)
        from orders where placed_at >= v_today and ready_at is not null
      ),
      'avgDeliveryMinutes', (
        select round(avg(extract(epoch from (delivered_at - ready_at)) / 60)::numeric, 1)
        from orders where placed_at >= v_today and delivered_at is not null and ready_at is not null
      )
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

-- ---------------------------------------------------------------------
-- get_admin_store_performance(): today's real per-store numbers, so
-- the owner can compare "which store is busy" at a glance rather than
-- only seeing the combined total. Same has_permission gate as the
-- rest of the dashboard family.
-- ---------------------------------------------------------------------
create or replace function get_admin_store_performance()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not has_permission('dashboard.view') then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(row_to_json(x) order by x.today_orders desc), '[]'::jsonb) into v_result
  from (
    select
      s.id as store_id,
      s.name as store_name,
      s.is_active,
      s.is_accepting_orders,
      (select count(*) from orders o where o.store_id = s.id and o.placed_at >= date_trunc('day', now())) as today_orders,
      (select coalesce(sum(o.total), 0) from orders o where o.store_id = s.id and o.placed_at >= date_trunc('day', now()) and o.status != 'cancelled') as today_revenue,
      (select count(*) from orders o where o.store_id = s.id and o.status not in ('delivered', 'cancelled')) as active_orders,
      (select count(*) from delivery_assignments da where da.store_id = s.id and not is_terminal_delivery_status(da.status)) as active_deliveries,
      (select count(*) from inventory i where i.store_id = s.id and i.is_available and (i.quantity - i.reserved_quantity) > 0 and (i.quantity - i.reserved_quantity) <= i.reorder_level) as low_stock,
      (select count(*) from inventory i where i.store_id = s.id and (i.quantity - i.reserved_quantity) <= 0) as out_of_stock,
      (select round(avg(extract(epoch from (o.ready_at - o.placed_at)) / 60)::numeric, 1) from orders o where o.store_id = s.id and o.placed_at >= date_trunc('day', now()) and o.ready_at is not null) as avg_fulfillment_minutes,
      (select round(avg(extract(epoch from (o.delivered_at - o.ready_at)) / 60)::numeric, 1) from orders o where o.store_id = s.id and o.placed_at >= date_trunc('day', now()) and o.delivered_at is not null and o.ready_at is not null) as avg_delivery_minutes
    from stores s
    where s.is_active
  ) x;

  return v_result;
end;
$$;

comment on function get_admin_store_performance is 'Per-store today snapshot for the dashboard Store Performance section — every field is a real aggregate, no fabricated values.';

revoke all on function get_admin_store_performance from public, anon;
grant execute on function get_admin_store_performance to authenticated;
