-- Admin Control Center: the delivery dispatch screen (section 24/25)
-- needs operations_manager/delivery_manager to assign/reassign riders
-- across any store, same shape of gap as update_order_status() —
-- these four Phase 08 functions only recognised is_store_staff()/
-- is_admin(). Every other line of logic is reproduced verbatim.

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
      (select count(*) from delivery_assignments da where da.rider_id = r.id and da.status not in ('completed', 'cancelled', 'declined', 'expired')) as active_count
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
    where rider_id = p_rider_id and status not in ('completed', 'cancelled', 'declined', 'expired');
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
  if not (is_store_staff(v_assignment.store_id, 'store_manager') or is_admin() or has_permission('deliveries.reassign')) then
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
