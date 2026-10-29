-- Rider assignment is manual only.
--
--   1. Automatic assignment is switched off: the retry job is unscheduled, any open automatic round is
--      cancelled, and the two functions that picked a rider on the caller's behalf can no longer be called
--      by a signed-in user (assign_rider(order, rider), the manual pick, is unchanged).
--   2. get_riders_for_assignment(): every active rider with a status the person choosing can read at a glance
--      (free / request pending / heading to store / at store / delivering / offline), their load, distance
--      from the store and whether they can be assigned right now. The older get_eligible_riders_for_order()
--      listed only riders who could be assigned, so a busy rider simply was not there.
--   3. get_order_rider_attempts(): who was asked for this order, and how each attempt ended.
--   4. A rider who declines — or lets the 5-minute request lapse — now notifies the store's staff (and the
--      admin who made the assignment), so someone is asked to choose again. Until now only the rider heard
--      about it (and only for an expiry).

-- ---------------------------------------------------------------------
-- 1. No automatic assignment
-- ---------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'retry-auto-assignment-rounds';

update delivery_dispatch_rounds
set status = 'cancelled', completed_at = now()
where status = 'open' and mode = 'auto';

revoke execute on function start_auto_assignment(uuid) from public, anon, authenticated;
revoke execute on function auto_assign_rider(uuid) from public, anon, authenticated;

comment on function start_auto_assignment is 'DISABLED (20260827000017): riders are assigned by a person choosing one (assign_rider). Not callable by app users; kept only so old diagnostics keep compiling.';
comment on function auto_assign_rider is 'DISABLED (20260827000017): riders are assigned by a person choosing one (assign_rider). Not callable by app users.';

-- ---------------------------------------------------------------------
-- 2. Riders with their status, for the manual picker
-- ---------------------------------------------------------------------
create or replace function get_riders_for_assignment(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_store stores%rowtype;
  v_riders jsonb;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to view riders for this order';
  end if;
  select * into v_store from stores where id = v_order.store_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'riderId', x.id,
    'name', x.full_name,
    'avatarUrl', x.avatar_url,
    'vehicleType', x.vehicle_type,
    'vehicleNumber', x.vehicle_number,
    'sameStore', x.same_store,
    'status', x.status,
    'activeDeliveries', x.active_count,
    'capacity', x.max_active_deliveries,
    'canAssign', x.can_assign,
    'distanceMeters', x.distance_meters,
    'locationAgeSeconds', x.location_age_seconds
  ) order by x.can_assign desc, (x.status = 'free') desc, x.same_store desc, x.distance_meters asc nulls last, x.active_count asc, x.full_name asc), '[]'::jsonb)
  into v_riders
  from (
    select
      r.id, p.full_name, p.avatar_url, r.vehicle_type, r.vehicle_number, r.max_active_deliveries,
      coalesce(r.primary_store_id = v_order.store_id, false) as same_store,
      a.active_count,
      case
        when not r.is_available then 'offline'
        when a.top_stage in ('in_transit', 'picked_up') then 'delivering'
        when a.top_stage = 'at_store' then 'at_store'
        when a.top_stage = 'accepted' then 'heading_to_store'
        when a.top_stage = 'assigned' then 'request_pending'
        else 'free'
      end as status,
      (r.is_available and a.active_count < r.max_active_deliveries) as can_assign,
      case when r.current_latitude is not null and r.current_longitude is not null and v_store.geog is not null
        then round(ST_Distance(v_store.geog, ST_SetSRID(ST_MakePoint(r.current_longitude, r.current_latitude), 4326)::geography)::numeric)
        else null end as distance_meters,
      case when r.last_location_at is not null then extract(epoch from (now() - r.last_location_at))::int else null end as location_age_seconds
    from riders r
    join profiles p on p.id = r.profile_id
    cross join lateral (
      select
        count(*)::int as active_count,
        (array_agg(da.status::text order by case da.status::text
          when 'in_transit' then 5 when 'picked_up' then 4 when 'at_store' then 3 when 'accepted' then 2 else 1 end desc))[1] as top_stage
      from delivery_assignments da
      where da.rider_id = r.id and not is_terminal_delivery_status(da.status)
    ) a
    where r.is_active
  ) x;

  return v_riders;
end;
$$;

comment on function get_riders_for_assignment is 'Every active rider for the manual "choose a rider" list, with status (free / request_pending / heading_to_store / at_store / delivering / offline), load, distance from the order''s store and canAssign. canAssign mirrors the checks assign_rider() makes under a row lock (available and under max_active_deliveries), which remains the authority.';

revoke all on function get_riders_for_assignment(uuid) from public, anon;
grant execute on function get_riders_for_assignment(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Who was asked for this order, and what happened
-- ---------------------------------------------------------------------
create or replace function get_order_rider_attempts(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_attempts jsonb;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to view rider attempts for this order';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignmentId', t.id,
    'riderId', t.rider_id,
    'riderName', t.full_name,
    'status', t.status,
    'reason', t.reason,
    'assignedAt', t.assigned_at,
    'endedAt', t.ended_at
  ) order by t.assigned_at desc), '[]'::jsonb)
  into v_attempts
  from (
    select da.id, da.rider_id, p.full_name, da.status::text as status, da.decline_reason as reason, da.assigned_at,
      coalesce(da.declined_at, da.expired_at, da.cancelled_at, da.completed_at, da.failed_at) as ended_at
    from delivery_assignments da
    join riders r on r.id = da.rider_id
    join profiles p on p.id = r.profile_id
    where da.order_id = p_order_id
    order by da.assigned_at desc
    limit 10
  ) t;

  return v_attempts;
end;
$$;

comment on function get_order_rider_attempts is 'The last 10 rider assignments for an order, newest first, with how each ended (declined / expired / cancelled / completed ...). Drives the "this rider did not accept — choose another" prompt.';

revoke all on function get_order_rider_attempts(uuid) from public, anon;
grant execute on function get_order_rider_attempts(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. A rider who does not accept is reported to the people who must choose again
-- ---------------------------------------------------------------------
create or replace function notify_rider_did_not_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_number text;
  v_rider_name text;
  v_assigned_by uuid;
  v_recipient uuid;
  v_body text;
begin
  select o.order_number into v_order_number from orders o where o.id = new.order_id;
  select p.full_name into v_rider_name from riders r join profiles p on p.id = r.profile_id where r.id = new.rider_id;
  select da.assigned_by into v_assigned_by from delivery_assignments da where da.id = new.delivery_id;

  v_body := format('%s %s Order #%s. Please choose another rider.',
    coalesce(v_rider_name, 'The rider'),
    case new.event_type::text when 'delivery_declined' then 'declined' else 'did not respond to' end,
    v_order_number);

  for v_recipient in select store_staff_recipient_ids(new.store_id) loop
    perform create_notification(
      v_recipient, 'dispatch_round_expired', 'delivery', 'Rider didn''t accept', v_body,
      jsonb_build_object('orderId', new.order_id, 'deliveryId', new.delivery_id, 'audience', 'store'),
      'high', 'delivery_events', new.id
    );
  end loop;

  -- An admin who assigned from the admin app is usually not on the store's staff list: tell them too.
  if v_assigned_by is not null
     and exists (select 1 from profiles where id = v_assigned_by and role = 'admin' and is_active)
     and not exists (select 1 from store_staff where store_id = new.store_id and user_id = v_assigned_by and is_active) then
    perform create_notification(
      v_assigned_by, 'dispatch_round_expired', 'delivery', 'Rider didn''t accept', v_body,
      jsonb_build_object('orderId', new.order_id, 'deliveryId', new.delivery_id, 'audience', 'admin'),
      'high', 'delivery_events', new.id
    );
  end if;

  return new;
end;
$$;

comment on function notify_rider_did_not_accept is 'AFTER INSERT on delivery_events for delivery_declined / delivery_expired: notifies the store''s staff (and the admin who made the assignment) that a rider did not accept, so a new one is chosen. create_notification() de-duplicates per event, so it can never notify twice for the same decline.';

revoke all on function notify_rider_did_not_accept() from public, anon, authenticated;

drop trigger if exists notify_rider_did_not_accept on delivery_events;
create trigger notify_rider_did_not_accept
  after insert on delivery_events
  for each row
  when (new.event_type in ('delivery_declined', 'delivery_expired'))
  execute function notify_rider_did_not_accept();
