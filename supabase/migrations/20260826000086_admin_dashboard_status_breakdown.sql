-- Premium admin redesign: the Live Order Pipeline needs a real count
-- per stage (New / Confirmed / Preparing / Ready / Rider Assigned /
-- On The Way / Delivered), not just the coarse buckets `operations`
-- already had (ordersPreparing lumps confirmed+preparing+picking+
-- packing together). Purely additive — every existing key unchanged.
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
      'avgFulfillmentMinutes', (
        select round(avg(extract(epoch from (ready_at - placed_at)) / 60)::numeric, 1)
        from orders where placed_at >= v_today and ready_at is not null
      ),
      'avgDeliveryMinutes', (
        select round(avg(extract(epoch from (delivered_at - ready_at)) / 60)::numeric, 1)
        from orders where placed_at >= v_today and delivered_at is not null and ready_at is not null
      ),
      -- Real per-stage counts for TODAY's orders specifically (not
      -- all-time, unlike pendingOrders/ordersPreparing/ordersReady
      -- above, which are deliberately all-time — "is anything sitting
      -- in this stage right now" regardless of which day it was
      -- placed). This one powers the Live Order Pipeline visualization.
      'todayByStatus', (
        select jsonb_object_agg(status, cnt) from (
          select status::text, count(*) as cnt from orders where placed_at >= v_today group by status
        ) s
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
