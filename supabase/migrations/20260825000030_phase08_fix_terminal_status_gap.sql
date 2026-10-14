-- Fixes a real bug surfaced by phase08-rider-delivery.test.mjs: a
-- rider with one FAILED delivery (fail_delivery()) was permanently
-- stuck "at capacity" forever afterward. 'failed' was added to
-- delivery_assignment_status in 20260825000025 but never added to the
-- "which statuses count as terminal / no-longer-active" exclusion
-- list used by the partial unique index, assign_rider(),
-- auto_assign_rider(), get_eligible_riders_for_order(), and
-- cancel_assignment() — each of which repeated its own
-- `not in ('completed', 'cancelled', 'declined', 'expired')` list by
-- hand, so adding 'failed' to the enum didn't propagate anywhere.
-- Centralizing this as one function is what should have been done
-- from the start — exactly the kind of duplication this project's own
-- conventions (is_store_staff(), is_admin()) already avoid elsewhere.

create or replace function is_terminal_delivery_status(p_status delivery_assignment_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('completed', 'cancelled', 'declined', 'expired', 'failed');
$$;

comment on function is_terminal_delivery_status is 'The single source of truth for "this delivery_assignment is no longer active" — used by the one-active-assignment-per-order index and every capacity/eligibility check. Add a new terminal status here once, not at every call site.';

grant execute on function is_terminal_delivery_status to public;

-- is_customer_of_rider_delivery() (20260825000028) had the same
-- hand-written exclusion list, missing 'failed' for the same reason.
create or replace function is_customer_of_rider_delivery(target_rider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from delivery_assignments da
    join orders o on o.id = da.order_id
    where da.rider_id = target_rider_id
      and o.user_id = auth.uid()
      and not is_terminal_delivery_status(da.status)
  );
$$;

-- The partial unique index needs 'failed' excluded too — a failed
-- delivery shouldn't permanently block the order from ever getting a
-- fresh assignment (section 29: admin/support resolves it, which may
-- include trying again).
drop index delivery_assignments_one_active_per_order;
create unique index delivery_assignments_one_active_per_order
  on delivery_assignments (order_id)
  where not is_terminal_delivery_status(status);

-- =======================================================================
-- Rewrite the four functions that had their own copy of the exclusion
-- list to use is_terminal_delivery_status() instead.
-- =======================================================================

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
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin()) then
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
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin()) then
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

revoke all on function assign_rider from public, anon;
grant execute on function assign_rider to authenticated;

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
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin()) then
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

revoke all on function auto_assign_rider from public, anon;
grant execute on function auto_assign_rider to authenticated;

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
  if not (is_store_staff(v_assignment.store_id, 'store_manager') or is_admin()) then
    raise exception 'not authorized to cancel this assignment';
  end if;
  if is_terminal_delivery_status(v_assignment.status) then
    raise exception 'assignment is already in a terminal state (%)', v_assignment.status;
  end if;

  update delivery_assignments set status = 'cancelled', cancelled_at = now() where id = p_assignment_id;
  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_cancelled', jsonb_build_object('reason', p_reason));

  -- Section 54/55 reassignment: an assignment cancelled before pickup
  -- returns the order to 'packed' so it re-enters the dispatch queue
  -- immediately, same as a decline/expiry. A cancellation *after*
  -- pickup is left alone (the order stays wherever it was —
  -- 'rider_assigned' or 'out_for_delivery') since the goods are
  -- physically no longer at the store; reverting to "ready for
  -- pickup" would be wrong. That later-stage case is exceptional
  -- enough to not need solving fully in this phase.
  if v_assignment.status in ('assigned', 'accepted', 'at_store') then
    update orders set status = 'packed' where id = v_assignment.order_id;
  end if;
end;
$$;

revoke all on function cancel_assignment from public, anon;
grant execute on function cancel_assignment to authenticated;

-- =======================================================================
-- get_rider_status(), set_rider_availability(), get_rider_dashboard():
-- same missing-'failed' gap. In get_rider_status() specifically, this
-- was subtler than a capacity miscount — `order by assigned_at desc
-- limit 1` could pick a stale 'failed' row over a genuinely active
-- older one, or (harmlessly, since 'failed' matches no CASE branch)
-- just fall through to 'available' by accident rather than by design.
-- =======================================================================

create or replace function get_rider_status(p_rider_id uuid)
returns text
language sql
stable
as $$
  select case
    when not r.is_active then 'suspended'
    when not r.is_available then 'offline'
    else coalesce(
      (select case da.status
        when 'assigned' then 'assigned'
        when 'accepted' then 'assigned'
        when 'at_store' then 'at_store'
        when 'picked_up' then 'picking_up'
        when 'in_transit' then 'delivering'
        else null
      end
      from delivery_assignments da
      where da.rider_id = r.id and not is_terminal_delivery_status(da.status)
      order by da.assigned_at desc
      limit 1),
      'available'
    )
  end
  from riders r where r.id = p_rider_id;
$$;

create or replace function set_rider_availability(p_available boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider riders%rowtype;
begin
  select * into v_rider from riders where profile_id = auth.uid() for update;
  if v_rider is null then
    raise exception 'rider profile not found';
  end if;
  if not v_rider.is_active then
    raise exception 'suspended riders cannot change availability';
  end if;

  if not p_available and exists (
    select 1 from delivery_assignments
    where rider_id = v_rider.id and not is_terminal_delivery_status(status)
  ) then
    raise exception 'cannot go offline with an active delivery in progress';
  end if;

  update riders set is_available = p_available where id = v_rider.id;
end;
$$;

revoke all on function set_rider_availability from public, anon;
grant execute on function set_rider_availability to authenticated;

create or replace function get_rider_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_rider riders%rowtype;
  v_today_start timestamptz := date_trunc('day', now());
  v_current jsonb;
begin
  select * into v_rider from riders where profile_id = auth.uid();
  if v_rider is null then
    raise exception 'rider profile not found';
  end if;

  select jsonb_build_object(
    'assignmentId', da.id,
    'orderId', o.id,
    'orderNumber', o.order_number,
    'status', da.status,
    'itemCount', (select count(*) from order_items where order_id = o.id),
    'total', o.total,
    'storeName', s.name,
    'storeAddress', s.address_line,
    'storeLatitude', s.latitude,
    'storeLongitude', s.longitude,
    'deliveryCity', o.delivery_address->>'city',
    'deliveryAddressLine1', o.delivery_address->>'address_line_1',
    'deliveryLatitude', (o.delivery_address->>'latitude')::double precision,
    'deliveryLongitude', (o.delivery_address->>'longitude')::double precision,
    'recipientName', o.delivery_address->>'recipient_name',
    'recipientPhone', o.delivery_address->>'phone',
    'assignedAt', da.assigned_at,
    'expiresAt', da.expires_at
  )
  into v_current
  from delivery_assignments da
  join orders o on o.id = da.order_id
  join stores s on s.id = da.store_id
  where da.rider_id = v_rider.id and not is_terminal_delivery_status(da.status)
  order by da.assigned_at desc
  limit 1;

  return jsonb_build_object(
    'riderId', v_rider.id,
    'status', get_rider_status(v_rider.id),
    'isAvailable', v_rider.is_available,
    'isActive', v_rider.is_active,
    'todayDeliveredCount', (
      select count(*) from delivery_assignments
      where rider_id = v_rider.id and status = 'completed' and completed_at >= v_today_start
    ),
    'currentAssignment', v_current
  );
end;
$$;

revoke all on function get_rider_dashboard from public, anon;
grant execute on function get_rider_dashboard to authenticated;

-- =======================================================================
-- decline_delivery() and expire_stale_assignments(): same "return the
-- order to packed" fix — these were the actual gap the test suite
-- caught (a declined/expired assignment left the order permanently
-- stuck at 'rider_assigned' with nothing able to re-dispatch it).
-- =======================================================================

create or replace function decline_delivery(p_assignment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment delivery_assignments%rowtype;
begin
  select * into v_assignment from delivery_assignments where id = p_assignment_id for update;
  if v_assignment is null then raise exception 'delivery assignment not found'; end if;
  if not exists (select 1 from riders where id = v_assignment.rider_id and profile_id = auth.uid()) then
    raise exception 'not authorized for this delivery';
  end if;
  if v_assignment.status <> 'assigned' then
    raise exception 'delivery can only be declined while awaiting acceptance (current: %)', v_assignment.status;
  end if;

  update delivery_assignments set status = 'declined', declined_at = now(), declined_by = auth.uid(), decline_reason = p_reason
    where id = p_assignment_id;
  update orders set status = 'packed' where id = v_assignment.order_id;

  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_declined', jsonb_build_object('reason', p_reason));
  insert into order_events (order_id, store_id, actor_id, event_type, metadata)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'rider_declined', jsonb_build_object('reason', p_reason));
end;
$$;

revoke all on function decline_delivery from public, anon;
grant execute on function decline_delivery to authenticated;

create or replace function expire_stale_assignments()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment record;
  v_count int := 0;
begin
  for v_assignment in
    select * from delivery_assignments
    where status = 'assigned' and expires_at is not null and expires_at < now()
    for update skip locked
  loop
    update delivery_assignments set status = 'expired', expired_at = now() where id = v_assignment.id;
    update orders set status = 'packed' where id = v_assignment.order_id;
    insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type)
      values (v_assignment.id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function expire_stale_assignments from public, anon, authenticated;
