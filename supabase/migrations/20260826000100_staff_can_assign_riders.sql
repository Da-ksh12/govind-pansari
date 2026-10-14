-- Client request: rider assignment should not be manager-exclusive —
-- any active store_staff member (role 'staff' as well as
-- 'store_manager') at the order's own store should be able to assign,
-- auto-assign, broadcast-dispatch, cancel, and view eligible riders.
-- Every function below is reproduced full-body (Postgres requires that
-- for CREATE OR REPLACE) from its current live definition, with the
-- ONLY change being is_store_staff(store_id, 'store_manager') ->
-- is_store_staff(store_id) (the required_role arg defaults to null,
-- meaning "any active role at that store" per its own definition in
-- 20260825000004_stores_and_zones.sql).
--
-- Deliberately NOT touched — these stay manager-only, since this
-- request was specifically about rider assignment, not a blanket
-- staff/manager merge: resolve_order_exception, accept_order,
-- reject_order, advance_order_fulfillment, set_store_accepting_orders,
-- staff invite management (apply_staff_invite etc.), and everything
-- admin-permission-gated.

-- ---------------------------------------------------------------------
-- get_eligible_riders_for_order — "Assign Manually" sheet's rider list.
-- ---------------------------------------------------------------------
create or replace function get_eligible_riders_for_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_order orders%rowtype;
  v_riders jsonb;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to view riders for this order';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'riderId', rl.id,
    'name', p.full_name,
    'vehicleType', rl.vehicle_type,
    'vehicleNumber', rl.vehicle_number,
    'sameStore', rl.primary_store_id = v_order.store_id,
    'activeDeliveries', rl.active_count,
    'capacity', rl.max_active_deliveries
  ) order by (rl.primary_store_id = v_order.store_id) desc, rl.active_count asc, rl.id asc), '[]'::jsonb)
  into v_riders
  from (
    select r.id, r.vehicle_type, r.vehicle_number, r.primary_store_id, r.max_active_deliveries, r.profile_id,
      (select count(*) from delivery_assignments da where da.rider_id = r.id and da.status not in ('completed', 'cancelled', 'declined', 'expired')) as active_count
    from riders r
    where r.is_active and r.is_available
  ) rl
  join profiles p on p.id = rl.profile_id
  where rl.active_count < rl.max_active_deliveries;

  return v_riders;
end;
$$;

-- ---------------------------------------------------------------------
-- assign_rider — the actual manual/auto/dispatch-offer assignment.
-- ---------------------------------------------------------------------
create or replace function assign_rider(p_order_id uuid, p_rider_id uuid, p_source delivery_assignment_source default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_rider riders%rowtype;
  v_active_count int;
  v_assignment_id uuid;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (
    is_store_staff(v_order.store_id) or is_admin() or has_permission('deliveries.assign')
    or (
      p_source = 'dispatch_offer' and is_own_rider(p_rider_id) and exists (
        select 1 from delivery_offers
        where order_id = p_order_id and rider_id = p_rider_id and status = 'open' and expires_at > now()
      )
    )
    or (p_source = 'auto' and auth.uid() is null)
  ) then
    raise exception 'not authorized to assign a rider for this order';
  end if;
  if v_order.status <> 'packed' then
    raise exception 'order is not ready for rider assignment (must be READY_FOR_PICKUP, current: %)', v_order.status;
  end if;

  select * into v_rider from riders where id = p_rider_id for update;
  if v_rider is null or not v_rider.is_active then
    raise exception 'rider not found or inactive';
  end if;
  if not v_rider.is_available then
    raise exception 'rider is not available';
  end if;
  select count(*) into v_active_count from delivery_assignments
    where rider_id = p_rider_id and not is_terminal_delivery_status(status);
  if v_active_count >= v_rider.max_active_deliveries then
    raise exception 'rider is at capacity (% active of % max)', v_active_count, v_rider.max_active_deliveries;
  end if;

  insert into delivery_assignments (order_id, rider_id, store_id, status, assigned_by, assignment_source, expires_at)
  values (p_order_id, p_rider_id, v_order.store_id, 'assigned', auth.uid(), p_source, now() + make_interval(mins => assignment_expiry_minutes()))
  returning id into v_assignment_id;

  update orders set status = 'rider_assigned' where id = p_order_id;

  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (v_assignment_id, p_order_id, p_rider_id, v_order.store_id, 'delivery_assigned', jsonb_build_object('source', p_source));
  insert into order_events (order_id, store_id, actor_id, event_type, metadata)
    values (p_order_id, v_order.store_id, auth.uid(), 'rider_assigned', jsonb_build_object('riderId', p_rider_id, 'source', p_source));

  return v_assignment_id;
end;
$$;

-- ---------------------------------------------------------------------
-- auto_assign_rider — the original one-shot auto-assign. Superseded by
-- start_auto_assignment in the app, but updated too so no stale,
-- manager-only RPC is left behind for the same feature class.
-- ---------------------------------------------------------------------
create or replace function auto_assign_rider(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_best_rider_id uuid;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to assign a rider for this order';
  end if;

  select rl.id into v_best_rider_id
  from (
    select r.id, r.primary_store_id, r.max_active_deliveries,
      (select count(*) from delivery_assignments da where da.rider_id = r.id and da.status not in ('completed', 'cancelled', 'declined', 'expired')) as active_count
    from riders r
    where r.is_active and r.is_available
  ) rl
  where rl.active_count < rl.max_active_deliveries
  order by (rl.primary_store_id = v_order.store_id) desc, rl.active_count asc, rl.id asc
  limit 1;

  if v_best_rider_id is null then
    raise exception 'no eligible rider available right now';
  end if;

  return assign_rider(p_order_id, v_best_rider_id, 'auto');
end;
$$;

-- ---------------------------------------------------------------------
-- cancel_assignment — "Cancel Assignment" button.
-- ---------------------------------------------------------------------
create or replace function cancel_assignment(p_assignment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment delivery_assignments%rowtype;
begin
  select * into v_assignment from delivery_assignments where id = p_assignment_id for update;
  if v_assignment is null then
    raise exception 'delivery assignment not found';
  end if;
  if not (is_store_staff(v_assignment.store_id) or is_admin() or has_permission('deliveries.reassign')) then
    raise exception 'not authorized to cancel this assignment';
  end if;
  if is_terminal_delivery_status(v_assignment.status) then
    raise exception 'assignment is already in a terminal state (%)', v_assignment.status;
  end if;

  update delivery_assignments set status = 'cancelled', cancelled_at = now() where id = p_assignment_id;
  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_cancelled', jsonb_build_object('reason', p_reason));

  if v_assignment.status in ('assigned', 'accepted', 'at_store') then
    update orders set status = 'packed' where id = v_assignment.order_id;
  end if;

  perform log_audit_event('rider_reassigned', 'delivery_assignments', p_assignment_id, jsonb_build_object('reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------------
-- get_eligible_riders_for_dispatch — "Send to All Nearby Riders" preview.
-- ---------------------------------------------------------------------
create or replace function get_eligible_riders_for_dispatch(p_order_id uuid)
returns table (rider_id uuid, full_name text, vehicle_type text, vehicle_number text, distance_meters numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_store stores%rowtype;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to view riders for this order';
  end if;
  select * into v_store from stores where id = v_order.store_id;

  return query
  select r.id, p.full_name, r.vehicle_type, r.vehicle_number,
    case when r.current_latitude is not null and r.current_longitude is not null
      then ST_Distance(v_store.geog, ST_SetSRID(ST_MakePoint(r.current_longitude, r.current_latitude), 4326)::geography)::numeric
      else null end as distance_meters
  from riders r
  join profiles p on p.id = r.profile_id
  where r.is_active and r.is_available
    and r.primary_store_id = v_order.store_id
    and not exists (select 1 from delivery_assignments da where da.rider_id = r.id and not is_terminal_delivery_status(da.status))
    and not exists (select 1 from delivery_offers o where o.rider_id = r.id and o.status = 'open' and o.expires_at > now())
  order by distance_meters asc nulls last;
end;
$$;

-- ---------------------------------------------------------------------
-- start_dispatch_round — "Send to All Nearby Riders" broadcast.
-- ---------------------------------------------------------------------
create or replace function start_dispatch_round(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_round_id uuid;
  v_offer_id uuid;
  v_next_round_number int;
  v_expires_at timestamptz;
  v_rider record;
  v_offer_count int := 0;
  v_item_count int;
  v_distance_label text;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to dispatch a rider for this order';
  end if;
  if v_order.status <> 'packed' then
    raise exception 'order is not ready for rider dispatch (must be READY_FOR_PICKUP, current: %)', v_order.status;
  end if;
  if exists (select 1 from delivery_dispatch_rounds where order_id = p_order_id and status = 'open') then
    raise exception 'a dispatch round is already open for this order';
  end if;
  if exists (select 1 from delivery_assignments where order_id = p_order_id and not is_terminal_delivery_status(status)) then
    raise exception 'this order already has an active delivery assignment';
  end if;

  select coalesce(max(round_number), 0) + 1 into v_next_round_number
    from delivery_dispatch_rounds where order_id = p_order_id;

  v_expires_at := now() + make_interval(mins => assignment_expiry_minutes());

  insert into delivery_dispatch_rounds (order_id, store_id, round_number, status, started_by, expires_at)
  values (p_order_id, v_order.store_id, v_next_round_number, 'open', auth.uid(), v_expires_at)
  returning id into v_round_id;

  select coalesce(sum(quantity), 0)::int into v_item_count from order_items where order_id = p_order_id;

  for v_rider in select * from get_eligible_riders_for_dispatch(p_order_id) loop
    insert into delivery_offers (dispatch_round_id, order_id, store_id, rider_id, status, distance_meters, expires_at)
    values (v_round_id, p_order_id, v_order.store_id, v_rider.rider_id, 'open', v_rider.distance_meters, v_expires_at)
    returning id into v_offer_id;

    v_distance_label := case
      when v_rider.distance_meters is null then null
      when v_rider.distance_meters < 1000 then round(v_rider.distance_meters) || ' m away'
      else round((v_rider.distance_meters / 1000)::numeric, 1) || ' km away'
    end;

    perform create_notification(
      (select profile_id from riders where id = v_rider.rider_id),
      'delivery_offer', 'delivery', 'New Delivery',
      format('Order #%s • %s item%s • %s%s',
        v_order.order_number, v_item_count, case when v_item_count = 1 then '' else 's' end, fmt_inr(v_order.total),
        case when v_distance_label is not null then ' • ' || v_distance_label else '' end),
      jsonb_build_object('orderId', p_order_id, 'dispatchRoundId', v_round_id, 'offerId', v_offer_id),
      'high', 'delivery_offers', v_offer_id
    );

    v_offer_count := v_offer_count + 1;
  end loop;

  if v_offer_count = 0 then
    update delivery_dispatch_rounds set status = 'cancelled', completed_at = now() where id = v_round_id;
    return jsonb_build_object('success', false, 'code', 'NO_ELIGIBLE_RIDERS', 'message', 'No eligible riders are currently available.');
  end if;

  return jsonb_build_object('success', true, 'dispatchRoundId', v_round_id, 'roundNumber', v_next_round_number, 'offerCount', v_offer_count, 'expiresAt', v_expires_at);
end;
$$;

-- ---------------------------------------------------------------------
-- start_auto_assignment — "Auto-Assign Rider" button.
-- ---------------------------------------------------------------------
create or replace function start_auto_assignment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_round_id uuid;
  v_next_round_number int;
  v_best_rider_id uuid;
  v_assignment_id uuid;
  v_expires_at timestamptz;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to assign a rider for this order';
  end if;
  if v_order.status <> 'packed' then
    raise exception 'order is not ready for rider assignment (must be READY_FOR_PICKUP, current: %)', v_order.status;
  end if;
  if exists (select 1 from delivery_dispatch_rounds where order_id = p_order_id and status = 'open') then
    raise exception 'a dispatch round is already open for this order';
  end if;
  if exists (select 1 from delivery_assignments where order_id = p_order_id and not is_terminal_delivery_status(status)) then
    raise exception 'this order already has an active delivery assignment';
  end if;

  select coalesce(max(round_number), 0) + 1 into v_next_round_number
    from delivery_dispatch_rounds where order_id = p_order_id;
  v_expires_at := now() + make_interval(mins => assignment_expiry_minutes());

  select rl.id into v_best_rider_id
  from (
    select r.id, r.primary_store_id, r.max_active_deliveries,
      (select count(*) from delivery_assignments da where da.rider_id = r.id and not is_terminal_delivery_status(da.status)) as active_count
    from riders r
    where r.is_active and r.is_available
  ) rl
  where rl.active_count < rl.max_active_deliveries
  order by (rl.primary_store_id = v_order.store_id) desc, rl.active_count asc, rl.id asc
  limit 1;

  insert into delivery_dispatch_rounds (order_id, store_id, round_number, status, started_by, expires_at, mode)
  values (p_order_id, v_order.store_id, v_next_round_number, 'open', auth.uid(), v_expires_at, 'auto')
  returning id into v_round_id;

  if v_best_rider_id is not null then
    v_assignment_id := assign_rider(p_order_id, v_best_rider_id, 'auto');
    update delivery_dispatch_rounds
      set status = 'completed', winner_rider_id = v_best_rider_id, winning_assignment_id = v_assignment_id, completed_at = now()
      where id = v_round_id;
    return jsonb_build_object('success', true, 'code', 'ASSIGNED', 'dispatchRoundId', v_round_id, 'riderId', v_best_rider_id, 'assignmentId', v_assignment_id);
  end if;

  return jsonb_build_object('success', true, 'code', 'AUTO_ASSIGNING', 'dispatchRoundId', v_round_id, 'expiresAt', v_expires_at);
end;
$$;

-- ---------------------------------------------------------------------
-- stop_auto_assignment — "Stop Auto-Assignment" button.
-- ---------------------------------------------------------------------
create or replace function stop_auto_assignment(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round delivery_dispatch_rounds%rowtype;
begin
  select * into v_round from delivery_dispatch_rounds where id = p_round_id for update;
  if v_round is null then
    raise exception 'dispatch round not found';
  end if;
  if v_round.mode <> 'auto' then
    raise exception 'this is not an auto-assignment round';
  end if;
  if not (is_store_staff(v_round.store_id) or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to stop this assignment';
  end if;
  if v_round.status <> 'open' then
    return;
  end if;

  update delivery_dispatch_rounds set status = 'cancelled', completed_at = now() where id = p_round_id;
end;
$$;
