-- QA report TC-05/06/07/14/15: the dashboard, the store cards and the
-- Orders list each defined "today", "active" and "pipeline" on their own,
-- so they disagreed with each other. This makes them share the helpers
-- from 20260827000003 and documents each metric:
--
--   today.*            Indian calendar day (business_day_start()), not the
--                      UTC day. Orders that are only awaiting online
--                      payment are excluded (they are not real orders yet).
--   revenue            Booked sales: sum(orders.total) of orders placed in
--                      the window that are not cancelled and not awaiting
--                      online payment. orders.total is the amount actually
--                      charged (items - discount + delivery fee + tax), so a
--                      COD order counts once placed — it is the same figure
--                      the Orders list shows for that order.
--   operations.activeOrders
--                      every non-terminal order (is_active_order_status),
--                      all-time, excluding those awaiting online payment.
--                      It equals pending + preparing + ready + rider
--                      assigned + on the way, so the card reconciles with
--                      the pipeline stages below.
--   operations.byStatus
--                      the CURRENT number of active orders in each status,
--                      regardless of the day they were placed — the Live
--                      Order Pipeline. (todayByStatus, which counted only
--                      orders placed today, made the pipeline contradict
--                      the all-time "ready" / "needs rider" numbers.)
--   operations.stuckDeliveries
--                      orders in rider_assigned / out_for_delivery /
--                      approaching that no longer have a live delivery
--                      assignment (failed / cancelled / expired). The
--                      delivery lifecycle intentionally leaves such orders
--                      for a manager to resolve (docs/delivery-lifecycle.md,
--                      "Failure"); surfacing them separately keeps them from
--                      masquerading as deliveries in progress.
--   operations.awaitingPayment
--                      active orders waiting on online-payment verification.
--
-- Every previously returned key is preserved. Inventory definitions
-- (TC-08 / TC-09, both passing) are carried over unchanged.
--
-- Rollback: re-apply get_admin_dashboard() from 20260826000086,
-- get_admin_store_performance() from 20260826000084 and
-- get_admin_orders() (8-argument form) from 20260826000047 (drop the
-- 9-argument form first) and get_admin_analytics() from 20260826000066.

create or replace function get_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today timestamptz := business_day_start(0);
  v_yesterday timestamptz := business_day_start(-1);
  v_result jsonb;
begin
  if not has_permission('dashboard.view') then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'today', jsonb_build_object(
      'orders', (select count(*) from orders o where o.placed_at >= v_today and not order_awaits_online_payment(o.id)),
      'revenue', (select coalesce(sum(o.total), 0) from orders o where o.placed_at >= v_today and o.status != 'cancelled' and not order_awaits_online_payment(o.id)),
      'itemsSold', (select coalesce(sum(oi.quantity), 0) from order_items oi join orders o on o.id = oi.order_id where o.placed_at >= v_today and o.status != 'cancelled' and not order_awaits_online_payment(o.id)),
      'averageOrderValue', (select coalesce(round(avg(o.total), 2), 0) from orders o where o.placed_at >= v_today and o.status != 'cancelled' and not order_awaits_online_payment(o.id)),
      'activeDeliveries', (select count(*) from delivery_assignments where not is_terminal_delivery_status(status)),
      'completedDeliveries', (select count(*) from delivery_assignments where status = 'completed' and completed_at >= v_today),
      'failedDeliveries', (select count(*) from delivery_assignments where status = 'failed' and failed_at >= v_today),
      'newCustomers', (select count(*) from profiles where role = 'customer' and created_at >= v_today)
    ),
    'yesterday', jsonb_build_object(
      'orders', (select count(*) from orders o where o.placed_at >= v_yesterday and o.placed_at < v_today and not order_awaits_online_payment(o.id)),
      'revenue', (select coalesce(sum(o.total), 0) from orders o where o.placed_at >= v_yesterday and o.placed_at < v_today and o.status != 'cancelled' and not order_awaits_online_payment(o.id)),
      'itemsSold', (select coalesce(sum(oi.quantity), 0) from order_items oi join orders o on o.id = oi.order_id where o.placed_at >= v_yesterday and o.placed_at < v_today and o.status != 'cancelled' and not order_awaits_online_payment(o.id)),
      'averageOrderValue', (select coalesce(round(avg(o.total), 2), 0) from orders o where o.placed_at >= v_yesterday and o.placed_at < v_today and o.status != 'cancelled' and not order_awaits_online_payment(o.id)),
      'newCustomers', (select count(*) from profiles where role = 'customer' and created_at >= v_yesterday and created_at < v_today)
    ),
    'operations', jsonb_build_object(
      'pendingOrders', (select count(*) from orders o where o.status = 'placed' and not order_awaits_online_payment(o.id)),
      'ordersPreparing', (select count(*) from orders o where o.status in ('confirmed', 'preparing', 'picking', 'packing')),
      'ordersReady', (select count(*) from orders o where o.status = 'packed'),
      'unassignedDeliveries', (
        select count(*) from orders o where o.status = 'packed'
          and not exists (select 1 from delivery_assignments da where da.order_id = o.id and not is_terminal_delivery_status(da.status))
      ),
      'activeOrders', (select count(*) from orders o where is_active_order_status(o.status) and not order_awaits_online_payment(o.id)),
      'awaitingPayment', (select count(*) from orders o where is_active_order_status(o.status) and order_awaits_online_payment(o.id)),
      'stuckDeliveries', (
        select count(*) from orders o where o.status in ('rider_assigned', 'out_for_delivery', 'approaching')
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
      'byStatus', (
        select coalesce(jsonb_object_agg(s.status, s.cnt), '{}'::jsonb) from (
          select o.status::text as status, count(*) as cnt
          from orders o
          where is_active_order_status(o.status) and not order_awaits_online_payment(o.id)
          group by o.status
        ) s
      ),
      'deliveredToday', (select count(*) from orders where status = 'delivered' and delivered_at >= v_today),
      'todayByStatus', (
        select coalesce(jsonb_object_agg(s.status, s.cnt), '{}'::jsonb) from (
          select o.status::text as status, count(*) as cnt
          from orders o
          where o.placed_at >= v_today and not order_awaits_online_payment(o.id)
          group by o.status
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

comment on function get_admin_dashboard is 'Single-round-trip dashboard aggregate. "Today" is the Asia/Kolkata business day; "active" is every non-terminal status; revenue is booked sales (non-cancelled, not awaiting online payment). See the header of 20260827000004 for each metric''s definition.';

create or replace function get_admin_store_performance()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today timestamptz := business_day_start(0);
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
      (select count(*) from orders o where o.store_id = s.id and o.placed_at >= v_today and not order_awaits_online_payment(o.id)) as today_orders,
      (select coalesce(sum(o.total), 0) from orders o where o.store_id = s.id and o.placed_at >= v_today and o.status != 'cancelled' and not order_awaits_online_payment(o.id)) as today_revenue,
      (select count(*) from orders o where o.store_id = s.id and is_active_order_status(o.status) and not order_awaits_online_payment(o.id)) as active_orders,
      (select count(*) from delivery_assignments da where da.store_id = s.id and not is_terminal_delivery_status(da.status)) as active_deliveries,
      (select count(*) from inventory i where i.store_id = s.id and i.is_available and (i.quantity - i.reserved_quantity) > 0 and (i.quantity - i.reserved_quantity) <= i.reorder_level) as low_stock,
      (select count(*) from inventory i where i.store_id = s.id and (i.quantity - i.reserved_quantity) <= 0) as out_of_stock,
      (select round(avg(extract(epoch from (o.ready_at - o.placed_at)) / 60)::numeric, 1) from orders o where o.store_id = s.id and o.placed_at >= v_today and o.ready_at is not null) as avg_fulfillment_minutes,
      (select round(avg(extract(epoch from (o.delivered_at - o.ready_at)) / 60)::numeric, 1) from orders o where o.store_id = s.id and o.placed_at >= v_today and o.delivered_at is not null and o.ready_at is not null) as avg_delivery_minutes
    from stores s
    where s.is_active
  ) x;

  return v_result;
end;
$$;

comment on function get_admin_store_performance is 'Per-store snapshot for the dashboard: today (Asia/Kolkata business day) orders and booked revenue, plus the same all-time active-order definition as get_admin_dashboard().';

-- ---------------------------------------------------------------------
-- get_admin_orders: add p_view so the dashboard's cards can link to a
-- list that holds exactly the orders they counted:
--   'active'          every non-terminal order
--   'needs_rider'     packed orders with no live delivery assignment
--   'stuck_delivery'  rider_assigned / out_for_delivery / approaching
--                     orders with no live delivery assignment
-- p_statuses selects several statuses at once (a pipeline stage such as
-- Preparing = preparing + picking + packing).
-- A status filter or a view hides orders that are only awaiting online
-- payment (they are not actionable and are not counted); the unfiltered
-- "All" list still shows them, flagged awaiting_payment = true.
-- Adding a parameter changes the signature, so the old 8-argument
-- function is dropped first — leaving both would make PostgREST RPC
-- calls ambiguous (the same hazard 20260826000099 fixed).
-- ---------------------------------------------------------------------
drop function if exists get_admin_orders(order_status, uuid, uuid, text, timestamptz, timestamptz, timestamptz, int);

create or replace function get_admin_orders(
  p_status order_status default null,
  p_store_id uuid default null,
  p_rider_id uuid default null,
  p_search text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_cursor timestamptz default null,
  p_limit int default 20,
  p_view text default null,
  p_statuses order_status[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('orders.view') then
    raise exception 'not authorized';
  end if;
  if p_view is not null and p_view not in ('active', 'needs_rider', 'stuck_delivery') then
    raise exception 'unknown orders view %', p_view;
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select
        o.id, o.order_number, o.status, o.total, o.placed_at,
        order_awaits_online_payment(o.id) as awaiting_payment,
        (select count(*) from order_items oi where oi.order_id = o.id) as item_count,
        p.full_name as customer_name, p.phone as customer_phone,
        s.name as store_name,
        (select da.id from delivery_assignments da where da.order_id = o.id and not is_terminal_delivery_status(da.status) order by da.assigned_at desc limit 1) as active_delivery_id,
        (select r.id from delivery_assignments da join riders r on r.id = da.rider_id where da.order_id = o.id and not is_terminal_delivery_status(da.status) order by da.assigned_at desc limit 1) as rider_id,
        (select rp.full_name from delivery_assignments da join riders r on r.id = da.rider_id join profiles rp on rp.id = r.profile_id where da.order_id = o.id and not is_terminal_delivery_status(da.status) order by da.assigned_at desc limit 1) as rider_name
      from orders o
      join profiles p on p.id = o.user_id
      join stores s on s.id = o.store_id
      where (p_status is null or o.status = p_status)
        and (p_statuses is null or o.status = any(p_statuses))
        and (
          p_view is null
          or (p_view = 'active' and is_active_order_status(o.status))
          or (p_view = 'needs_rider' and o.status = 'packed'
              and not exists (select 1 from delivery_assignments da where da.order_id = o.id and not is_terminal_delivery_status(da.status)))
          or (p_view = 'stuck_delivery' and o.status in ('rider_assigned', 'out_for_delivery', 'approaching')
              and not exists (select 1 from delivery_assignments da where da.order_id = o.id and not is_terminal_delivery_status(da.status)))
        )
        and ((p_status is null and p_statuses is null and p_view is null) or not order_awaits_online_payment(o.id))
        and (p_store_id is null or o.store_id = p_store_id)
        and (p_rider_id is null or exists (select 1 from delivery_assignments da where da.order_id = o.id and da.rider_id = p_rider_id))
        and (p_date_from is null or o.placed_at >= p_date_from)
        and (p_date_to is null or o.placed_at <= p_date_to)
        and (p_search is null or p_search = '' or
             o.order_number ilike '%' || p_search || '%' or
             p.full_name ilike '%' || p_search || '%' or
             p.phone ilike '%' || p_search || '%')
        and (p_cursor is null or o.placed_at < p_cursor)
      order by o.placed_at desc
      limit least(coalesce(p_limit, 20), 50)
    ) t
  );
end;
$$;

comment on function get_admin_orders is 'Admin order list. p_view = active | needs_rider | stuck_delivery selects the same order sets the dashboard cards count. Orders awaiting online payment appear only in the unfiltered list (awaiting_payment = true).';

revoke all on function get_admin_orders from public, anon;
grant execute on function get_admin_orders to authenticated;

-- ---------------------------------------------------------------------
-- get_admin_analytics: the page the "Today's Revenue" card opens. Same
-- revenue definition and the same Asia/Kolkata day boundaries as the
-- dashboard, so a day's bar here equals the card's number for that day.
-- (It used the UTC day and counted orders still awaiting online payment.)
-- ---------------------------------------------------------------------
create or replace function get_admin_analytics(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days int := greatest(coalesce(p_days, 30), 1);
  v_since timestamptz := business_day_start(-(greatest(coalesce(p_days, 30), 1) - 1));
  v_result jsonb;
begin
  if not has_permission('analytics.view') then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'periodDays', v_days,
    'totals', jsonb_build_object(
      'revenue', (select coalesce(sum(o.total), 0) from orders o where o.placed_at >= v_since and o.status != 'cancelled' and not order_awaits_online_payment(o.id)),
      'orders', (select count(*) from orders o where o.placed_at >= v_since and not order_awaits_online_payment(o.id)),
      'cancelledOrders', (select count(*) from orders o where o.placed_at >= v_since and o.status = 'cancelled'),
      'averageOrderValue', (select coalesce(round(avg(o.total), 2), 0) from orders o where o.placed_at >= v_since and o.status != 'cancelled' and not order_awaits_online_payment(o.id)),
      'newCustomers', (select count(*) from profiles where role = 'customer' and created_at >= v_since)
    ),
    'revenueByDay', (
      select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb) from (
        select
          gs.day::date as day,
          coalesce(sum(o.total) filter (where o.status != 'cancelled' and not order_awaits_online_payment(o.id)), 0) as revenue,
          count(o.id) filter (where not order_awaits_online_payment(o.id)) as orders
        from generate_series((v_since at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') gs(day)
        left join orders o on o.placed_at >= v_since and (o.placed_at at time zone 'Asia/Kolkata')::date = gs.day::date
        group by gs.day
      ) d
    ),
    'topProducts', (
      select coalesce(jsonb_agg(row_to_json(tp)), '[]'::jsonb) from (
        select
          oi.product_id, max(oi.product_name_snapshot) as name,
          sum(oi.quantity) as quantity_sold, sum(oi.total) as revenue
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.placed_at >= v_since and o.status != 'cancelled' and not order_awaits_online_payment(o.id)
        group by oi.product_id
        order by revenue desc
        limit 10
      ) tp
    ),
    'categoryBreakdown', (
      select coalesce(jsonb_agg(row_to_json(cb)), '[]'::jsonb) from (
        select
          coalesce(c.name, 'Uncategorised') as category_name,
          sum(oi.total) as revenue, sum(oi.quantity) as quantity_sold
        from order_items oi
        join orders o on o.id = oi.order_id
        left join products pr on pr.id = oi.product_id
        left join categories c on c.id = pr.category_id
        where o.placed_at >= v_since and o.status != 'cancelled' and not order_awaits_online_payment(o.id)
        group by c.name
        order by revenue desc
      ) cb
    ),
    'statusBreakdown', (
      select coalesce(jsonb_object_agg(sb.status, sb.cnt), '{}'::jsonb) from (
        select o.status::text as status, count(*) as cnt from orders o
        where o.placed_at >= v_since and not order_awaits_online_payment(o.id)
        group by o.status
      ) sb
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function get_admin_analytics is 'Revenue / top-product / category / status aggregates over a trailing window of Asia/Kolkata business days. Same revenue definition as get_admin_dashboard() (booked sales: not cancelled, not awaiting online payment).';
