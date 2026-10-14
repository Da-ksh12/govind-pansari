-- Fixes a real bug surfaced by phase08-rider-delivery.test.mjs: "42P17
-- infinite recursion detected in policy for relation riders".
--
-- Root cause, pre-existing since Phase 01 but never actually triggered
-- until this phase: riders_active_delivery_read (on `riders`) queries
-- `delivery_assignments`, and delivery_assignments_read (on
-- `delivery_assignments`) queries `riders` right back — a mutual
-- cross-reference between the two tables' RLS policies. Nothing before
-- Phase 08 ever executed a query that traversed both sides of that
-- cycle in the same planner pass. This phase's new `delivery_events`
-- policy queries `riders` too, and closes the loop: Postgres's planner
-- doesn't guarantee left-to-right short-circuit evaluation of an OR'd
-- USING clause, so even a store-manager request (which should have
-- matched the unrelated is_store_staff() branch first) can still hit
-- the recursive branch and fail outright.
--
-- Fix: the same pattern already used successfully for is_store_staff()/
-- is_admin() everywhere else — a SECURITY DEFINER helper function.
-- Its internal query runs as the function owner, not the RLS-
-- restricted caller, so it never re-triggers the other table's RLS at
-- all. Replacing the inline `EXISTS (SELECT ... FROM riders ...)` /
-- `EXISTS (SELECT ... FROM delivery_assignments ...)` subqueries
-- embedded directly in these policies with calls to these functions
-- breaks the cycle completely.

create or replace function is_own_rider(target_rider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from riders where id = target_rider_id and profile_id = auth.uid());
$$;

comment on function is_own_rider is 'RLS helper: is the calling user the rider identified by target_rider_id? SECURITY DEFINER so its internal read of `riders` never re-triggers riders'' own RLS policies — this is what breaks the riders <-> delivery_assignments policy recursion (see 20260825000028).';

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
      and da.status not in ('completed', 'cancelled', 'declined', 'expired')
  );
$$;

comment on function is_customer_of_rider_delivery is 'RLS helper: does the calling user have an active order out for delivery with this rider? SECURITY DEFINER for the same recursion-breaking reason as is_own_rider().';

revoke all on function is_own_rider from public, anon, authenticated;
revoke all on function is_customer_of_rider_delivery from public, anon, authenticated;
-- These are RLS-internal only — never called directly by a client,
-- only referenced from inside USING clauses (which evaluate with the
-- function owner's privileges regardless of grants to the calling
-- role, same as is_store_staff()/is_admin()).

-- =======================================================================
-- riders: replace the inline delivery_assignments subquery.
-- =======================================================================

drop policy "riders_active_delivery_read" on riders;
create policy "riders_active_delivery_read"
  on riders for select
  using (is_customer_of_rider_delivery(riders.id));

-- =======================================================================
-- rider_locations: replace both inline subqueries (self-check and
-- customer-check).
-- =======================================================================

drop policy "rider_locations_read" on rider_locations;
create policy "rider_locations_read"
  on rider_locations for select
  using (
    is_own_rider(rider_id)
    or is_admin()
    or is_customer_of_rider_delivery(rider_id)
  );

-- =======================================================================
-- delivery_assignments: replace the inline riders subquery. The
-- orders subquery (customer-owner check) is left inline — it doesn't
-- participate in the riders<->delivery_assignments cycle, since
-- `orders`' own RLS never queries either of those two tables back.
-- =======================================================================

drop policy "delivery_assignments_read" on delivery_assignments;
create policy "delivery_assignments_read"
  on delivery_assignments for select
  using (
    is_admin()
    or is_store_staff(store_id)
    or is_own_rider(rider_id)
    or exists (select 1 from orders where orders.id = order_id and orders.user_id = auth.uid())
  );

-- =======================================================================
-- delivery_events (this phase's new table): same fix, applied from
-- the start rather than left to recurse.
-- =======================================================================

drop policy "delivery_events_read" on delivery_events;
create policy "delivery_events_read"
  on delivery_events for select
  using (
    is_admin()
    or is_store_staff(store_id)
    or is_own_rider(rider_id)
    or exists (select 1 from orders where orders.id = delivery_events.order_id and orders.user_id = auth.uid())
  );
