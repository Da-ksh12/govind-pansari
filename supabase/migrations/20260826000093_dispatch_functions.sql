-- Final Dispatch pass — the actual dispatch/offer/atomic-acceptance
-- functions. See 20260826000091/092 for enums/schema/RLS.

-- =======================================================================
-- Eligibility (sections 3/4/18) — same-store, active+available, no
-- active delivery, no other currently-open offer. Distance is real
-- (ST_Distance against the store's existing generated geography point,
-- the same pattern checkout/find_serviceable_stores already use) but
-- honestly null when a rider has no current_latitude/longitude yet —
-- riders.current_* is only ever populated once they've completed at
-- least one delivery (submit_rider_location's own precondition, Phase
-- 09) — never faked as 0/0 or "nearby by default".
-- =======================================================================
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
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to view riders for this order';
  end if;
  select * into v_store from stores where id = v_order.store_id;

  return query
  select r.id, p.full_name, r.vehicle_type, r.vehicle_number,
    case when r.current_latitude is not null and r.current_longitude is not null
      then ST_Distance(v_store.geog, ST_SetSRID(ST_MakePoint(r.current_longitude, r.current_latitude), 4326)::geography)
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

comment on function get_eligible_riders_for_dispatch is 'Read-only preview (store UI, section 5''s "which riders are nearest and available") — start_dispatch_round() below calls this same function rather than duplicating the eligibility query, so the preview a manager sees before pressing Send Rider is always exactly who actually gets offered it.';

revoke all on function get_eligible_riders_for_dispatch(uuid) from public, anon;
grant execute on function get_eligible_riders_for_dispatch(uuid) to authenticated;

-- =======================================================================
-- start_dispatch_round (sections 2/5/13) — the "Send Rider" action.
-- Fans an offer out to every currently-eligible rider at once; each
-- gets a real DELIVERY_OFFER push/in-app notification with real order
-- number/item count/amount/distance, never a generic "new delivery"
-- with no numbers.
-- =======================================================================
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
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin() or has_permission('deliveries.assign')) then
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

  -- Reuses the SAME 5-minute window assign_rider()'s own pending-accept
  -- expiry already uses (assignment_expiry_minutes()) — one documented
  -- number, not a second hardcoded "5" (section 8).
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

revoke all on function start_dispatch_round(uuid) from public, anon;
grant execute on function start_dispatch_round(uuid) to authenticated;

-- =======================================================================
-- accept_delivery_offer (sections 6/15/16/19/39/40) — THE atomic
-- acceptance. Locks the dispatch round (not just this offer) as the
-- shared serialization point: two different riders' concurrent accepts
-- lock two different delivery_offers rows (no contention there) but
-- both need this same round row locked before either can declare a
-- winner, so Postgres blocks the second caller here until the first
-- transaction commits, and the second caller then sees the round's
-- real post-commit status instead of racing on stale data.
-- =======================================================================
create or replace function accept_delivery_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer delivery_offers%rowtype;
  v_round delivery_dispatch_rounds%rowtype;
  v_rider riders%rowtype;
  v_assignment_id uuid;
begin
  select * into v_offer from delivery_offers where id = p_offer_id for update;
  if v_offer is null then
    raise exception 'offer not found';
  end if;
  if not is_own_rider(v_offer.rider_id) then
    raise exception 'not authorized to respond to this offer';
  end if;

  select * into v_round from delivery_dispatch_rounds where id = v_offer.dispatch_round_id for update;

  if v_round.status <> 'open' then
    return jsonb_build_object('success', false, 'code', 'ALREADY_TAKEN', 'message', 'This delivery was accepted by another rider.');
  end if;
  if v_offer.status = 'open' and v_offer.expires_at <= now() then
    update delivery_offers set status = 'expired', responded_at = now() where id = p_offer_id;
    return jsonb_build_object('success', false, 'code', 'EXPIRED', 'message', 'This offer has expired.');
  end if;
  if v_offer.status <> 'open' then
    return jsonb_build_object('success', false, 'code', 'ALREADY_RESPONDED', 'message', 'You already responded to this offer.');
  end if;

  -- Re-check eligibility fresh, under lock — never trust anything the
  -- client/UI believed at offer time (section 19: a rider can become
  -- busy — accept a different offer, or get manually assigned — in the
  -- window between receiving this offer and tapping Accept).
  select * into v_rider from riders where id = v_offer.rider_id for update;
  if not v_rider.is_active or not v_rider.is_available then
    update delivery_offers set status = 'expired', responded_at = now() where id = p_offer_id;
    return jsonb_build_object('success', false, 'code', 'RIDER_NOT_AVAILABLE', 'message', 'You are no longer available to accept this delivery.');
  end if;
  if exists (select 1 from delivery_assignments where rider_id = v_offer.rider_id and not is_terminal_delivery_status(status)) then
    update delivery_offers set status = 'expired', responded_at = now() where id = p_offer_id;
    return jsonb_build_object('success', false, 'code', 'RIDER_NOT_AVAILABLE', 'message', 'You already have an active delivery.');
  end if;

  -- The actual win: reuses assign_rider() for the capacity check, the
  -- order-status transition, and the customer/store notifications —
  -- the exact same side effects a manager's manual pick produces, so
  -- nothing downstream needs to know which path created this
  -- assignment. assign_rider()'s own authorization is extended (see
  -- that function, redefined below) to allow exactly this one case: a
  -- rider assigning themself, and ONLY while they hold the open,
  -- unexpired offer being accepted right here, under lock.
  v_assignment_id := assign_rider(v_offer.order_id, v_offer.rider_id, 'dispatch_offer');
  update delivery_assignments set status = 'accepted', accepted_at = now() where id = v_assignment_id;

  update delivery_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update delivery_offers set status = 'lost', responded_at = now()
    where dispatch_round_id = v_round.id and id <> p_offer_id and status = 'open';

  update delivery_dispatch_rounds
    set status = 'completed', winner_rider_id = v_offer.rider_id, winning_assignment_id = v_assignment_id, completed_at = now()
    where id = v_round.id;

  return jsonb_build_object('success', true, 'assignmentId', v_assignment_id, 'orderId', v_offer.order_id);
end;
$$;

revoke all on function accept_delivery_offer(uuid) from public, anon;
grant execute on function accept_delivery_offer(uuid) to authenticated;

-- =======================================================================
-- decline_delivery_offer (sections 5 scenario 5, 17/20) — the round
-- stays open, every other rider's offer is untouched, and the
-- declining rider's own availability is not touched either.
-- =======================================================================
create or replace function decline_delivery_offer(p_offer_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer delivery_offers%rowtype;
begin
  select * into v_offer from delivery_offers where id = p_offer_id for update;
  if v_offer is null then
    raise exception 'offer not found';
  end if;
  if not is_own_rider(v_offer.rider_id) then
    raise exception 'not authorized to respond to this offer';
  end if;
  if v_offer.status <> 'open' then
    raise exception 'this offer is no longer open';
  end if;

  update delivery_offers set status = 'declined', responded_at = now(), decline_reason = p_reason where id = p_offer_id;
end;
$$;

revoke all on function decline_delivery_offer(uuid, text) from public, anon;
grant execute on function decline_delivery_offer(uuid, text) to authenticated;

-- =======================================================================
-- expire_stale_dispatch_rounds (sections 9/10) — scheduled every
-- minute, same cadence as the existing expire_stale_assignments(). No
-- acceptance in time reverts nothing about the customer's order except
-- leaving it exactly where it was (still 'packed' — never cancelled,
-- section 9's explicit "a rider failing to accept should not
-- automatically cancel a valid customer order"); it notifies store
-- staff so a human decides to reassign (section 10/12).
-- =======================================================================
create or replace function expire_stale_dispatch_rounds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round record;
  v_staff_id uuid;
  v_order_number text;
begin
  for v_round in
    select * from delivery_dispatch_rounds where status = 'open' and expires_at <= now() for update
  loop
    update delivery_offers set status = 'expired', responded_at = now()
      where dispatch_round_id = v_round.id and status = 'open';

    update delivery_dispatch_rounds set status = 'expired', completed_at = now() where id = v_round.id;

    select order_number into v_order_number from orders where id = v_round.order_id;

    for v_staff_id in select store_staff_recipient_ids(v_round.store_id) loop
      perform create_notification(
        v_staff_id, 'dispatch_round_expired', 'delivery', 'Rider Not Assigned',
        format('No available rider accepted Order #%s within %s minutes. Please reassign the delivery.',
          v_order_number, assignment_expiry_minutes()),
        jsonb_build_object('orderId', v_round.order_id, 'dispatchRoundId', v_round.id),
        'high', 'delivery_dispatch_rounds', v_round.id
      );
    end loop;
  end loop;
end;
$$;

comment on function expire_stale_dispatch_rounds is 'Scheduled every minute via pg_cron (see below). create_notification()''s own dedup (notification_dedupe, keyed on source_table+source_id+recipient+event_type) makes this safe to ever run twice against the same round — never a duplicate "Rider Not Assigned" notification (section 41).';

select cron.schedule(
  'expire-stale-dispatch-rounds',
  '* * * * *',
  $$select expire_stale_dispatch_rounds();$$
);

-- =======================================================================
-- assign_rider — extended, not replaced. Full body reproduced (Postgres
-- requires it for create or replace); the ONLY change is the
-- authorization check gaining one more allowed case: a rider assigning
-- themself, gated strictly on actually holding the specific open,
-- unexpired offer being accepted (section 39 — a malicious rider
-- cannot call assign_rider(other_order_id, own_rider_id,
-- 'dispatch_offer') for an order they were never offered; the exists()
-- check ties the privilege to a real row only accept_delivery_offer's
-- own prior checks could have produced).
-- =======================================================================
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
    is_store_staff(v_order.store_id, 'store_manager') or is_admin() or has_permission('deliveries.assign')
    or (
      p_source = 'dispatch_offer' and is_own_rider(p_rider_id) and exists (
        select 1 from delivery_offers
        where order_id = p_order_id and rider_id = p_rider_id and status = 'open' and expires_at > now()
      )
    )
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

-- =======================================================================
-- notify_on_delivery_event — full body reproduced; the ONLY change is
-- in the 'delivery_assigned' branch, which now skips the rider-facing
-- DELIVERY_ASSIGNED notification when the assignment came from
-- accept_delivery_offer (source = 'dispatch_offer'). That rider just
-- actively tapped Accept on their own DELIVERY_OFFER notification a
-- moment ago — a second "New delivery" alert immediately afterward for
-- the same round would be exactly the duplicate-notification bug
-- section 41 warns against. The customer's RIDER_ASSIGNED and the
-- store staff's RIDER_ASSIGNED notifications are unchanged — those
-- audiences are learning something new either way.
-- =======================================================================
create or replace function notify_on_delivery_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_store_name text;
  v_rider_profile_id uuid;
  v_rider_name text;
  v_staff_id uuid;
  v_admin_id uuid;
  v_item_count int;
begin
  select * into v_order from orders where id = new.order_id;
  if v_order.id is null then
    return new;
  end if;

  if new.rider_id is not null then
    select r.profile_id, p.full_name into v_rider_profile_id, v_rider_name
    from riders r join profiles p on p.id = r.profile_id
    where r.id = new.rider_id;
  end if;

  case new.event_type
    when 'delivery_assigned' then
      select name into v_store_name from stores where id = new.store_id;

      perform create_notification(
        v_order.user_id, 'rider_assigned', 'delivery', 'Rider assigned',
        format('%s has been assigned to deliver order #%s.', coalesce(v_rider_name, 'A rider'), v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );

      if v_rider_profile_id is not null and coalesce(new.metadata->>'source', '') <> 'dispatch_offer' then
        select coalesce(sum(quantity), 0)::int into v_item_count from order_items where order_id = v_order.id;

        perform create_notification(
          v_rider_profile_id, 'delivery_assigned', 'delivery', 'New Delivery',
          format('Order #%s • %s item%s • %s — pickup at %s.',
            v_order.order_number, v_item_count, case when v_item_count = 1 then '' else 's' end,
            fmt_inr(v_order.total), coalesce(v_store_name, 'the store')),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'high', 'delivery_events', new.id
        );
      end if;

      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'rider_assigned', 'delivery', 'Rider assigned',
          format('%s will pick up order #%s.', coalesce(v_rider_name, 'A rider'), v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end loop;

    when 'rider_at_store' then
      perform create_notification(
        v_order.user_id, 'rider_at_store', 'delivery', 'Rider at the store',
        format('Your rider has arrived at the store for order #%s.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );
      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'rider_at_store', 'delivery', 'Rider arrived',
          format('%s has arrived for order #%s.', coalesce(v_rider_name, 'The rider'), v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end loop;

    when 'delivery_picked_up' then
      perform create_notification(
        v_order.user_id, 'order_picked_up', 'delivery', 'Order picked up',
        format('Your order #%s has been picked up.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );
      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'order_picked_up', 'order', 'Order picked up',
          format('Order #%s has been picked up by the rider.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end loop;

    when 'delivery_started' then
      perform create_notification(
        v_order.user_id, 'order_out_for_delivery', 'delivery', 'Out for delivery',
        format('Order #%s is on its way to you. Track it live.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );

    when 'delivery_completed' then
      perform create_notification(
        v_order.user_id, 'order_delivered', 'order', 'Delivered',
        format('Order #%s has been delivered. Enjoy!', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );
      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'order_delivered', 'order', 'Order delivered',
          format('Order #%s was delivered successfully.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'low', 'delivery_events', new.id
        );
      end loop;

    when 'delivery_failed' then
      perform create_notification(
        v_order.user_id, 'delivery_failed', 'delivery', 'Delivery issue',
        format('We couldn''t deliver order #%s. Our team will reach out shortly.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'high', 'delivery_events', new.id
      );
      if v_rider_profile_id is not null then
        perform create_notification(
          v_rider_profile_id, 'delivery_exception', 'delivery', 'Delivery marked failed',
          format('Order #%s was recorded as a failed delivery.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end if;
      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'delivery_failed', 'system', 'Delivery issue',
          format('Delivery failed for order #%s.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'high', 'delivery_events', new.id
        );
      end loop;
      for v_admin_id in select admin_recipient_ids() loop
        perform create_notification(
          v_admin_id, 'admin_failed_delivery', 'system', 'Failed delivery',
          format('Order #%s failed delivery.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'urgent', 'delivery_events', new.id
        );
      end loop;

    when 'delivery_expired', 'delivery_cancelled' then
      if v_rider_profile_id is not null then
        perform create_notification(
          v_rider_profile_id, 'delivery_reassigned', 'delivery', 'Delivery reassigned',
          format('Order #%s has been reassigned to another rider.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end if;

    else
      null;
  end case;

  return new;
end;
$$;
