-- Real bug found by re-running the full regression suite after the
-- Admin Control Center migrations: a rider with exactly one FAILED
-- delivery was permanently stuck "at capacity" and could never be
-- assigned a new order again.
--
-- Phase 08's own memory/lesson was "a status/enum value used in more
-- than ~2 places needs a centralized predicate function"
-- (is_terminal_delivery_status()) — and that fix (migration
-- 20260825000030) was applied to get_rider_status()/
-- get_rider_dashboard()/the partial unique index, but NOT to
-- assign_rider()'s own manual capacity re-check, auto_assign_rider()'s
-- ranking query, or get_eligible_riders_for_order()'s active_count —
-- three more hand-copied `status not in ('completed', 'cancelled',
-- 'declined', 'expired')` lists (missing 'failed') that this session's
-- migration 20260826000048 then copied forward verbatim while
-- extending their authorization checks, without noticing the gap.
-- Exactly the bug class the original lesson was about — found again,
-- this time by a full regression run rather than a dedicated test.
--
-- Fixed by switching all three to is_terminal_delivery_status(),
-- the same centralized predicate everything else already uses.
-- Nothing else in any of these functions changes.

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
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin() or has_permission('deliveries.assign')) then
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
      (select count(*) from delivery_assignments da where da.rider_id = r.id and not is_terminal_delivery_status(da.status)) as active_count
    from riders r
    where r.is_active and r.is_available
  ) rl
  join profiles p on p.id = rl.profile_id
  where rl.active_count < rl.max_active_deliveries;

  return v_riders;
end;
$$;

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
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin() or has_permission('deliveries.assign')) then
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
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to assign a rider for this order';
  end if;

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

  if v_best_rider_id is null then
    raise exception 'no eligible rider available right now';
  end if;

  return assign_rider(p_order_id, v_best_rider_id, 'auto');
end;
$$;
