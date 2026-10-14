-- Small extension: get_store_dashboard() now also returns the store's
-- status_reason (added this phase) so the dashboard's own pause row
-- can show *why* a paused store is paused, not just that it is.
-- Every other field/line is reproduced verbatim from Phase 07's
-- original function.

create or replace function get_store_dashboard(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_today_start timestamptz := date_trunc('day', now());
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

    'todayRevenue', coalesce((select sum(total) from orders where store_id = p_store_id and placed_at >= v_today_start and status <> 'cancelled'), 0),
    'todayOrderCount', (select count(*) from orders where store_id = p_store_id and placed_at >= v_today_start),

    'newOrders', (select count(*) from orders where store_id = p_store_id and status = 'placed'),
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
