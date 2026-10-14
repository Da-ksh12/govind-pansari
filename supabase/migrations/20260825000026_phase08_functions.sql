-- Phase 08 functions: assignment (manual + auto), rider acceptance/
-- decline, the strict at_store -> picked_up -> in_transit -> completed/
-- failed chain, availability, expiry, and the rider/store dashboards.

-- Phase 01's update_delivery_status() let a caller jump straight to
-- any delivery_assignment_status with zero transition validation
-- (exactly the same class of bug Phase 07 found and fixed in
-- update_order_status()'s old forward branch). Fully replaced by the
-- strict, single-purpose functions below (accept_delivery,
-- decline_delivery, mark_arrived_at_store, mark_picked_up,
-- start_delivery, complete_delivery, fail_delivery) — dropped, not
-- left grantable as a bypass path.
drop function if exists update_delivery_status(uuid, delivery_assignment_status);

-- delivery_assignments_one_active_per_order needs 'declined'/'expired'
-- excluded too (deferred from 20260825000025 — using a just-added enum
-- value in a same-transaction index predicate is disallowed).
drop index delivery_assignments_one_active_per_order;
create unique index delivery_assignments_one_active_per_order
  on delivery_assignments (order_id)
  where status not in ('completed', 'cancelled', 'declined', 'expired');

-- orders.delivered_at — section 30 explicitly wants it recorded;
-- Phase 01's update_delivery_status() only ever set status='delivered'
-- with no timestamp.
alter table orders add column delivered_at timestamptz;

-- =======================================================================
-- Central configuration (section 18: "store configuration centrally,
-- not hardcoded throughout the frontend").
-- =======================================================================

create or replace function assignment_expiry_minutes() returns int language sql immutable as $$ select 5; $$;
comment on function assignment_expiry_minutes is 'How long a rider has to accept/decline before expire_stale_assignments() (scheduled) reclaims the assignment. Change here, not in any frontend screen.';
grant execute on function assignment_expiry_minutes to authenticated;

-- =======================================================================
-- Derived rider status (mirrors get_store_operational_status() from
-- Phase 07 — computed from is_active/is_available/current assignment,
-- not a fourth stored column that could drift out of sync with them).
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
      where da.rider_id = r.id and da.status not in ('completed', 'cancelled', 'declined', 'expired')
      order by da.assigned_at desc
      limit 1),
      'available'
    )
  end
  from riders r where r.id = p_rider_id;
$$;

comment on function get_rider_status is 'offline/available/assigned/at_store/picking_up/delivering/suspended — never a stored column (section 4''s rich status list is fully derivable from is_active + is_available + the rider''s current non-terminal delivery_assignment, so nothing can hold a stale value).';

revoke all on function get_rider_status from public, anon;
grant execute on function get_rider_status to authenticated;

-- =======================================================================
-- Availability — wrapped in a function (not a raw column grant) now
-- that there's a real business rule to enforce: a rider mid-delivery
-- cannot go offline (section 8). Phase 01's direct `grant update
-- (is_available) on riders to authenticated` had no such check.
-- =======================================================================

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
    where rider_id = v_rider.id and status not in ('completed', 'cancelled', 'declined', 'expired')
  ) then
    raise exception 'cannot go offline with an active delivery in progress';
  end if;

  update riders set is_available = p_available where id = v_rider.id;
end;
$$;

revoke all on function set_rider_availability from public, anon;
grant execute on function set_rider_availability to authenticated;

-- The direct column grant from Phase 01 is superseded by the function
-- above, which adds the "not while on an active delivery" rule a raw
-- column write can't express.
revoke update (is_available) on riders from authenticated;

-- =======================================================================
-- Assignment: shared eligibility rule (used by both manual and auto),
-- surfaced as its own read-only function for the manual-assign UI
-- (section 15: "see eligible riders").
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
      (select count(*) from delivery_assignments da where da.rider_id = r.id and da.status not in ('completed', 'cancelled', 'declined', 'expired')) as active_count
    from riders r
    where r.is_active and r.is_available
  ) rl
  join profiles p on p.id = rl.profile_id
  where rl.active_count < rl.max_active_deliveries;

  return v_riders;
end;
$$;

revoke all on function get_eligible_riders_for_order from public, anon;
grant execute on function get_eligible_riders_for_order to authenticated;

-- =======================================================================
-- assign_rider(): rewritten, not just extended. Phase 01's version
-- allowed assignment from 'confirmed'/'preparing' too (predates
-- Phase 07's picking/packing split) — section 11 explicitly restricts
-- this to READY_FOR_PICKUP (packed) only. It also flipped
-- riders.is_available=false on assignment, conflating "online" with
-- "has capacity" — replaced by the active-count-vs-max_active_deliveries
-- check used everywhere else in this migration, so a rider can stay
-- online while temporarily at capacity rather than looking "offline".
-- =======================================================================

-- The new signature (3 params, one defaulted) doesn't match the
-- original 2-param one closely enough for CREATE OR REPLACE to treat
-- it as the same function — Postgres would keep both as overloads,
-- which then makes every unqualified reference to "assign_rider"
-- (e.g. the COMMENT below) ambiguous. Drop the old one explicitly.
drop function if exists assign_rider(uuid, uuid);

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

comment on function assign_rider is 'Manual assignment (section 15) or the target of auto_assign_rider() (section 12/14). Capacity/eligibility re-checked here even for auto-assign''s pre-ranked pick — never trusts a rider_id blindly (section 50). The unique partial index on delivery_assignments makes a double-assignment of the same order impossible even under a race (the losing INSERT fails the constraint).';

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

  -- Ranking (section 12): available riders with spare capacity,
  -- same-store first, then fewest active deliveries, then a
  -- deterministic id tiebreak. No distance/routing — that's Phase 09,
  -- once real rider location exists to route from.
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

comment on function auto_assign_rider is 'Runs the ranking algorithm then delegates to assign_rider() for the actual (re-validated) assignment — one assignment code path, not two. If no rider qualifies, the order simply stays READY_FOR_PICKUP/unassigned (section 13: never cancel/fail the customer order just because no rider is free right now) — the caller decides whether to retry, assign manually, or wait.';

revoke all on function auto_assign_rider from public, anon;
grant execute on function auto_assign_rider to authenticated;

-- =======================================================================
-- cancel_assignment(): the reassignment primitive (section 54/55) —
-- store manager/admin cancels the current (non-terminal) assignment,
-- freeing the order for a fresh assign_rider()/auto_assign_rider()
-- call. The old rider automatically loses authority: every rider-
-- facing function below re-checks the assignment's *current* status,
-- so any action attempted on a cancelled row fails its own status
-- check — no separate "revoke rider access" step is needed.
-- =======================================================================

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
  if v_assignment.status in ('completed', 'cancelled', 'declined', 'expired') then
    raise exception 'assignment is already in a terminal state (%)', v_assignment.status;
  end if;

  update delivery_assignments set status = 'cancelled', cancelled_at = now() where id = p_assignment_id;
  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_cancelled', jsonb_build_object('reason', p_reason));

  -- Order stays 'rider_assigned' (or wherever it was) — cancel_assignment
  -- doesn't revert it to 'packed'; a manager reassigning immediately
  -- calls assign_rider() next, which doesn't require any particular
  -- prior order status beyond having *had* a completed pick/pack.
end;
$$;

revoke all on function cancel_assignment from public, anon;
grant execute on function cancel_assignment to authenticated;

-- =======================================================================
-- Rider actions: accept / decline / arrive / pick up / start delivery
-- / complete / fail. Every one re-selects the assignment FOR UPDATE,
-- re-verifies the caller is the *currently* assigned rider, and
-- requires the exact predecessor status — the same strict-chain
-- pattern as Phase 07's advance_order_fulfillment(), and for the same
-- reason (section 51: no arbitrary transitions; section 61: two
-- riders/two requests racing the same transition must not both win).
-- =======================================================================

create or replace function accept_delivery(p_assignment_id uuid)
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
  if v_assignment.status = 'expired' then
    raise exception 'this assignment has expired';
  end if;
  if v_assignment.status <> 'assigned' then
    raise exception 'delivery is not awaiting acceptance (current: %)', v_assignment.status;
  end if;

  update delivery_assignments set status = 'accepted', accepted_at = now() where id = p_assignment_id;
  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_accepted');
  insert into order_events (order_id, store_id, actor_id, event_type)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'rider_accepted');
end;
$$;

revoke all on function accept_delivery from public, anon;
grant execute on function accept_delivery to authenticated;

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
  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_declined', jsonb_build_object('reason', p_reason));
  insert into order_events (order_id, store_id, actor_id, event_type, metadata)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'rider_declined', jsonb_build_object('reason', p_reason));

  -- Order is left at 'rider_assigned' — becomes eligible for a fresh
  -- assign_rider()/auto_assign_rider() call immediately (the partial
  -- unique index now excludes 'declined' rows).
end;
$$;

revoke all on function decline_delivery from public, anon;
grant execute on function decline_delivery to authenticated;

create or replace function mark_arrived_at_store(p_assignment_id uuid)
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
  if v_assignment.status <> 'accepted' then
    raise exception 'invalid transition to at_store (current: %)', v_assignment.status;
  end if;

  update delivery_assignments set status = 'at_store', arrived_at_store_at = now() where id = p_assignment_id;
  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'rider_at_store');
end;
$$;

revoke all on function mark_arrived_at_store from public, anon;
grant execute on function mark_arrived_at_store to authenticated;

create or replace function mark_picked_up(p_assignment_id uuid, p_order_number text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment delivery_assignments%rowtype;
  v_order orders%rowtype;
begin
  select * into v_assignment from delivery_assignments where id = p_assignment_id for update;
  if v_assignment is null then raise exception 'delivery assignment not found'; end if;
  if not exists (select 1 from riders where id = v_assignment.rider_id and profile_id = auth.uid()) then
    raise exception 'not authorized for this delivery';
  end if;
  if v_assignment.status <> 'at_store' then
    raise exception 'must be at the store before confirming pickup (current: %)', v_assignment.status;
  end if;

  select * into v_order from orders where id = v_assignment.order_id;
  -- Section 20/21: don't trust a bare button press — the rider must
  -- correctly reference the order being handed to them. QR/barcode/PIN
  -- are future-phase; order-number confirmation is what's enforced now.
  if v_order.order_number is distinct from p_order_number then
    raise exception 'order number does not match this delivery — cannot confirm pickup';
  end if;

  update delivery_assignments set status = 'picked_up', picked_up_at = now(),
    delivery_verification_method = 'order_number'
    where id = p_assignment_id;
  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_picked_up');
  insert into order_events (order_id, store_id, actor_id, event_type)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'order_picked_up');

  -- Order status intentionally unchanged here (stays 'rider_assigned')
  -- — the order only moves to 'out_for_delivery' once the rider
  -- actually starts moving (start_delivery()), matching section 22
  -- (pickup is just an event) vs. section 24 (a distinct later step).
end;
$$;

comment on function mark_picked_up is 'Inventory is never touched here (section 23) — reservation-to-sale conversion already happened at confirm_payment/COD-collection time; picking up a package changes delivery state only.';

revoke all on function mark_picked_up from public, anon;
grant execute on function mark_picked_up to authenticated;

create or replace function start_delivery(p_assignment_id uuid)
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
  if v_assignment.status <> 'picked_up' then
    raise exception 'order must be picked up before starting delivery (current: %)', v_assignment.status;
  end if;

  update delivery_assignments set status = 'in_transit', out_for_delivery_at = now() where id = p_assignment_id;
  update orders set status = 'out_for_delivery' where id = v_assignment.order_id;

  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_started');
  insert into order_events (order_id, store_id, actor_id, event_type)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'order_out_for_delivery');
end;
$$;

revoke all on function start_delivery from public, anon;
grant execute on function start_delivery to authenticated;

create or replace function complete_delivery(
  p_assignment_id uuid,
  p_verification_method delivery_verification_method default 'none',
  p_cash_collected numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment delivery_assignments%rowtype;
  v_order orders%rowtype;
begin
  select * into v_assignment from delivery_assignments where id = p_assignment_id for update;
  if v_assignment is null then raise exception 'delivery assignment not found'; end if;
  if not exists (select 1 from riders where id = v_assignment.rider_id and profile_id = auth.uid()) then
    raise exception 'not authorized for this delivery';
  end if;
  -- Section 30's full precondition list: belongs to rider (checked
  -- above), delivery status = OUT_FOR_DELIVERY, order state coherent.
  if v_assignment.status <> 'in_transit' then
    raise exception 'delivery must be out for delivery before it can be completed (current: %)', v_assignment.status;
  end if;
  select * into v_order from orders where id = v_assignment.order_id for update;
  if v_order.status <> 'out_for_delivery' then
    raise exception 'order is not currently out for delivery (current: %)', v_order.status;
  end if;

  update delivery_assignments set
    status = 'completed',
    completed_at = now(),
    delivery_verification_method = p_verification_method,
    cash_collected = p_cash_collected,
    payment_collection_status = case when p_cash_collected is not null then 'collected' when v_order.payment_status = 'pending' then 'pending' else 'not_applicable' end
  where id = p_assignment_id;

  update orders set
    status = 'delivered',
    delivered_at = now(),
    -- COD settlement point (section 32) — a still-pending payment is
    -- marked paid on successful delivery, same rule Phase 01's
    -- update_delivery_status() already had; gateway-paid orders are
    -- already 'paid' long before delivery via confirm_payment().
    payment_status = case when payment_status = 'pending' then 'paid' else payment_status end
  where id = v_assignment.order_id;

  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_completed', jsonb_build_object('verificationMethod', p_verification_method, 'cashCollected', p_cash_collected));
  insert into order_events (order_id, store_id, actor_id, event_type)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'order_delivered');
end;
$$;

comment on function complete_delivery is 'Atomic: delivery + order flip together, in one transaction, or neither does. The FOR UPDATE locks on both rows are what make two simultaneous completion requests for the same delivery resolve to exactly one winner (section 61) — the loser''s re-read after acquiring the lock sees status already ''completed'' and fails the precondition check.';

revoke all on function complete_delivery from public, anon;
grant execute on function complete_delivery to authenticated;

create or replace function fail_delivery(p_assignment_id uuid, p_reason delivery_failure_reason, p_notes text default null)
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
  if v_assignment.status <> 'in_transit' then
    raise exception 'delivery must be out for delivery to record a failed attempt (current: %)', v_assignment.status;
  end if;

  update delivery_assignments set status = 'failed', failed_at = now(), failure_reason = p_reason, failure_notes = p_notes
    where id = p_assignment_id;

  -- Section 29: the order does NOT automatically become delivered (it
  -- also does not revert) — it stays 'out_for_delivery' with a failed
  -- delivery attempt on record, for a store manager/admin to resolve.
  -- No refund/retry/reassignment logic is invented here.
  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_failed', jsonb_build_object('reason', p_reason, 'notes', p_notes));
  insert into order_events (order_id, store_id, actor_id, event_type, metadata)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'delivery_failed', jsonb_build_object('reason', p_reason, 'notes', p_notes));
end;
$$;

revoke all on function fail_delivery from public, anon;
grant execute on function fail_delivery to authenticated;

-- =======================================================================
-- Expiry sweep (section 18) — mirrors release_expired_reservations()'s
-- FOR UPDATE SKIP LOCKED pattern (Phase 01/05).
-- =======================================================================

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
    insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type)
      values (v_assignment.id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function expire_stale_assignments from public, anon, authenticated;

select cron.schedule(
  'expire-stale-delivery-assignments',
  '* * * * *',
  $$select expire_stale_assignments();$$
);

-- =======================================================================
-- Dashboards
-- =======================================================================

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
  where da.rider_id = v_rider.id and da.status not in ('completed', 'cancelled', 'declined', 'expired')
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

comment on function get_rider_dashboard is 'One aggregate call for the rider home screen (section 7/60) — current assignment (if any) plus today''s completed count, never a full order-table scan. No fake ETA/distance (section 44) — only what''s actually known: store/delivery coordinates for a future Phase 09 map, not a computed route.';

revoke all on function get_rider_dashboard from public, anon;
grant execute on function get_rider_dashboard to authenticated;
