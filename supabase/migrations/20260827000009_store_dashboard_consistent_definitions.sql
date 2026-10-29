-- The store manager's own dashboard (get_store_dashboard) had the same two
-- defects the admin dashboard had (TC-14, TC-22), which 20260827000004 fixed
-- for the admin RPCs only:
--
--   1. "Today" was date_trunc('day', now()) — midnight UTC, which is 05:30 IST.
--      An order placed at 23:45 IST the previous evening was still "today" at
--      the store until 05:30 IST and an order placed after midnight IST was
--      missing until then. It now uses business_day_start() (00:00 Asia/Kolkata),
--      the same boundary as the admin dashboard.
--   2. A prepaid order whose payment has not been verified sat in 'placed', so
--      it inflated "New orders" and today's revenue even though accept_order()
--      (20260827000005) refuses it. Those orders are now left out via
--      order_awaits_online_payment(), exactly as the admin RPCs do.
--
-- Every other field is reproduced verbatim from 20260826000054.
--
-- Rollback: re-apply get_store_dashboard() from 20260826000054.

create or replace function get_store_dashboard(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_today_start timestamptz := business_day_start(0);
begin
  if not (is_store_staff(p_store_id) or is_admin()) then
    raise exception 'not authorized to view this store''s dashboard';
  end if;

  return jsonb_build_object(
    'storeId', p_store_id,
    'operationalStatus', get_store_operational_status(p_store_id),
    'isActive', (select is_active from stores where id = p_store_id),
    'isAcceptingOrders', (select is_accepting_orders from stores where id = p_store_id),
    'statusReason', (select status_reason from stores where id = p_store_id),

    'todayRevenue', coalesce((
      select sum(o.total) from orders o
      where o.store_id = p_store_id and o.placed_at >= v_today_start and o.status <> 'cancelled'
        and not order_awaits_online_payment(o.id)
    ), 0),
    'todayOrderCount', (
      select count(*) from orders o
      where o.store_id = p_store_id and o.placed_at >= v_today_start
        and not order_awaits_online_payment(o.id)
    ),

    'newOrders', (
      select count(*) from orders o
      where o.store_id = p_store_id and o.status = 'placed'
        and not order_awaits_online_payment(o.id)
    ),
    'processing', (select count(*) from orders where store_id = p_store_id and status in ('confirmed', 'preparing')),
    'picking', (select count(*) from orders where store_id = p_store_id and status = 'picking'),
    'packing', (select count(*) from orders where store_id = p_store_id and status = 'packing'),
    'readyForPickup', (select count(*) from orders where store_id = p_store_id and status = 'packed'),

    'lowStockCount', (
      select count(*) from inventory
      where store_id = p_store_id and is_available
        and (quantity - reserved_quantity) > 0
        and (quantity - reserved_quantity) <= reorder_level
    ),
    'outOfStockCount', (
      select count(*) from inventory
      where store_id = p_store_id and (quantity - reserved_quantity) <= 0
    ),

    'avgAcceptanceMinutes', (
      select round(avg(extract(epoch from (accepted_at - placed_at)) / 60)::numeric, 1)
      from orders where store_id = p_store_id and accepted_at is not null and placed_at >= v_today_start
    ),
    'avgPickingMinutes', (
      select round(avg(extract(epoch from (packing_started_at - picking_started_at)) / 60)::numeric, 1)
      from orders where store_id = p_store_id and picking_started_at is not null and packing_started_at is not null and placed_at >= v_today_start
    ),
    'avgPackingMinutes', (
      select round(avg(extract(epoch from (ready_at - packing_started_at)) / 60)::numeric, 1)
      from orders where store_id = p_store_id and packing_started_at is not null and ready_at is not null and placed_at >= v_today_start
    ),
    'avgFulfillmentMinutes', (
      select round(avg(extract(epoch from (ready_at - placed_at)) / 60)::numeric, 1)
      from orders where store_id = p_store_id and ready_at is not null and placed_at >= v_today_start
    ),
    'cancelledOrRejectedToday', (
      select count(*) from orders where store_id = p_store_id and status = 'cancelled' and placed_at >= v_today_start
    )
  );
end;
$$;
