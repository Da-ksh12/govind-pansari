-- Final production pass, section 21-35: "automatic assignment" must
-- mean the server picks ONE eligible rider and assigns them directly —
-- no acceptance popup to multiple riders (that's what "Send Rider" /
-- start_dispatch_round already does, and stays unchanged as a
-- separate, deliberate feature). The gap in the existing one-shot
-- auto_assign_rider(): it either finds a rider in that exact instant
-- or fails immediately, with no window for a rider to free up (finish
-- their current delivery, come online) the way a real dispatcher would
-- keep trying. This reuses delivery_dispatch_rounds (already has
-- status/started_at/expires_at/round_number — no new table) rather
-- than inventing a parallel state machine, distinguished by a new
-- `mode` column since a 'broadcast' round creates delivery_offers rows
-- and an 'auto' round never does.

alter table delivery_dispatch_rounds add column mode text not null default 'broadcast' check (mode in ('broadcast', 'auto'));

comment on column delivery_dispatch_rounds.mode is '''broadcast'' = Send Rider (offers fanned out to every eligible rider, first to accept wins, via delivery_offers). ''auto'' = Auto-Assign (server silently tries the single best eligible rider immediately and on a 1-minute retry cadence for up to assignment_expiry_minutes(), no delivery_offers rows, no rider acceptance — the rider is just notified of the finished assignment, same as a manual pick).';

-- ===========================================================================
-- assign_rider — extended once more (full body reproduced, as
-- Postgres requires for CREATE OR REPLACE): a third authorization
-- carve-out for p_source='auto' called with no end-user session at
-- all. This is only ever reachable from retry_auto_assignment_rounds()
-- below (a SECURITY DEFINER function invoked solely by pg_cron) — a
-- real client call always carries a real auth.uid(), and anon has no
-- execute grant on this function at all, so this path cannot be
-- reached from any client-callable route.
-- ===========================================================================
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

-- ===========================================================================
-- start_auto_assignment — the new "Auto-Assign" entry point. Tries the
-- same best-eligible-rider selection auto_assign_rider() already used
-- immediately; if nobody currently qualifies, opens an 'auto'-mode
-- round instead of failing outright, so retry_auto_assignment_rounds()
-- can keep trying for up to assignment_expiry_minutes(). Either way
-- returns a single typed result the store UI renders directly — never
-- a raised exception for the ordinary "nobody free right now" case.
-- ===========================================================================
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
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin() or has_permission('deliveries.assign')) then
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

comment on function start_auto_assignment is 'The real "Auto-Assign Rider" action (section 22/25) — server picks a single eligible rider, atomically assigns, no acceptance popup. Tries immediately; if nobody currently qualifies, opens an ''auto'' round for retry_auto_assignment_rounds() to keep trying on, up to assignment_expiry_minutes().';

revoke all on function start_auto_assignment(uuid) from public, anon;
grant execute on function start_auto_assignment(uuid) to authenticated;

-- ===========================================================================
-- retry_auto_assignment_rounds — pg_cron, every minute (same cadence
-- as expire_stale_dispatch_rounds). For every still-open 'auto' round:
-- try the same selection once more; assign+close on success, or close
-- as 'expired' (and notify store staff) once past expires_at. An order
-- that stopped being packed out from under the round (customer
-- cancelled, store reverted it) closes the round as 'cancelled'
-- instead of ever assigning a rider to it.
-- ===========================================================================
create or replace function retry_auto_assignment_rounds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round record;
  v_order orders%rowtype;
  v_best_rider_id uuid;
  v_assignment_id uuid;
  v_staff_id uuid;
  v_order_number text;
begin
  for v_round in
    select * from delivery_dispatch_rounds where status = 'open' and mode = 'auto' for update
  loop
    select * into v_order from orders where id = v_round.order_id for update;

    if v_order.status <> 'packed' then
      update delivery_dispatch_rounds set status = 'cancelled', completed_at = now() where id = v_round.id;
      continue;
    end if;

    select rl.id into v_best_rider_id
    from (
      select r.id, r.primary_store_id, r.max_active_deliveries,
        (select count(*) from delivery_assignments da where da.rider_id = r.id and not is_terminal_delivery_status(da.status)) as active_count
      from riders r
      where r.is_active and r.is_available
    ) rl
    where rl.active_count < rl.max_active_deliveries
    order by (rl.primary_store_id = v_round.store_id) desc, rl.active_count asc, rl.id asc
    limit 1;

    if v_best_rider_id is not null then
      v_assignment_id := assign_rider(v_round.order_id, v_best_rider_id, 'auto');
      update delivery_dispatch_rounds
        set status = 'completed', winner_rider_id = v_best_rider_id, winning_assignment_id = v_assignment_id, completed_at = now()
        where id = v_round.id;
      continue;
    end if;

    if v_round.expires_at <= now() then
      update delivery_dispatch_rounds set status = 'expired', completed_at = now() where id = v_round.id;
      select order_number into v_order_number from orders where id = v_round.order_id;
      for v_staff_id in select store_staff_recipient_ids(v_round.store_id) loop
        perform create_notification(
          v_staff_id, 'dispatch_round_expired', 'delivery', 'No Rider Available',
          format('No eligible rider was available for Order #%s within %s minutes. Try again or assign manually.',
            v_order_number, assignment_expiry_minutes()),
          jsonb_build_object('orderId', v_round.order_id, 'dispatchRoundId', v_round.id),
          'high', 'delivery_dispatch_rounds', v_round.id
        );
      end loop;
    end if;
  end loop;
end;
$$;

comment on function retry_auto_assignment_rounds is 'Keeps trying start_auto_assignment''s selection every minute for any still-open ''auto'' round, up to its own expires_at — this is what makes "automatic assignment" actually retry over the real 5-minute window instead of failing the instant nobody happens to be free.';

select cron.schedule(
  'retry-auto-assignment-rounds',
  '* * * * *',
  $$select retry_auto_assignment_rounds();$$
);

-- ===========================================================================
-- stop_auto_assignment — the store manager's explicit "Stop Auto
-- Assignment" control (section 28/29). Server-authoritative: flips the
-- round straight to 'cancelled', so the very next cron tick's `for
-- v_round in ... where status = 'open'` simply never selects it again
-- — not a client-side flag the retry job has no way to see. Never
-- touches the order itself.
-- ===========================================================================
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
  if not (is_store_staff(v_round.store_id, 'store_manager') or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to stop this assignment';
  end if;
  if v_round.status <> 'open' then
    return; -- already finished one way or another — nothing to stop
  end if;

  update delivery_dispatch_rounds set status = 'cancelled', completed_at = now() where id = p_round_id;
end;
$$;

revoke all on function stop_auto_assignment(uuid) from public, anon;
grant execute on function stop_auto_assignment(uuid) to authenticated;
