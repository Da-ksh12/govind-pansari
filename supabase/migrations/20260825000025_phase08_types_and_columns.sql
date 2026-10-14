-- Phase 08: Rider Management + Delivery Assignment + Delivery
-- Operations.
--
-- Phase 01 already built almost the entire foundation for this phase,
-- speculatively, before any of it was wired up: `riders`,
-- `rider_locations` (with a trigger keeping riders.current_lat/lng in
-- sync — section 42's "rider location preparation" was already done),
-- `delivery_assignments`, `delivery_assignment_status`, and
-- `assign_rider()`/`update_delivery_status()`/`mark_order_approaching()`.
-- This migration extends that schema; it does not replace it.
--
-- One deliberate non-duplication decision, stated up front: the brief
-- describes both a "delivery entity" (section 9: order_id, rider_id,
-- store_id, status, assigned_at, accepted_at, arrived_at_store_at,
-- picked_up_at, ..., created_at) and a separate "assignment history"
-- table (section 56: delivery_id, rider_id, assigned_by, status,
-- assigned_at, accepted_at, declined_at, expired_at, unassigned_at).
-- The existing `delivery_assignments` table already IS both: its
-- partial unique index (one *active* row per order) means a decline/
-- expiry naturally leaves a terminal row and lets a fresh one be
-- created for the next rider, so the table already accumulates one
-- row per assignment *attempt* — exactly section 56's history shape —
-- without needing a second table. Building `deliveries` +
-- `delivery_assignments` as two separate tables here would be exactly
-- the "second parallel order system" every phase's brief has warned
-- against.

-- =======================================================================
-- delivery_assignment_status: fill the gaps. Existing: assigned,
-- accepted, picked_up, in_transit, completed, cancelled. 'in_transit'
-- already covers OUT_FOR_DELIVERY and 'completed' already covers
-- DELIVERED — not renamed, same reasoning as Phase 07 keeping
-- order_status's 'packed' as READY_FOR_PICKUP. What's missing:
-- AT_STORE (between accepted and picked_up), and DECLINED/EXPIRED/
-- FAILED (three distinct terminal-for-this-attempt outcomes the old
-- enum had no room for at all).
-- =======================================================================

-- Each ADD VALUE positions relative to an *original* enum member only
-- (never one added earlier in this same migration) — safest form,
-- avoids any risk of a same-transaction ordering dependency.
alter type delivery_assignment_status add value if not exists 'at_store' after 'accepted';
alter type delivery_assignment_status add value if not exists 'declined' after 'assigned';
alter type delivery_assignment_status add value if not exists 'expired' after 'assigned';
alter type delivery_assignment_status add value if not exists 'failed' after 'in_transit';

-- =======================================================================
-- riders: a primary store relationship (section 5) — genuinely
-- missing before this phase, nothing modeled which store a rider
-- normally works out of. Also a capacity ceiling (section 33/34):
-- kept separate from is_available so "am I online" and "how many
-- deliveries can I juggle" aren't conflated into one boolean — a
-- rider can be online (is_available=true) and still ineligible for a
-- *new* assignment because they're already at capacity, without that
-- meaning they've gone offline.
-- =======================================================================

alter table riders
  add column primary_store_id uuid references stores (id),
  add column max_active_deliveries int not null default 1 check (max_active_deliveries > 0);

create index riders_primary_store_idx on riders (primary_store_id) where is_active;

comment on column riders.primary_store_id is 'The store this rider normally dispatches from (section 5) — used to prioritize same-store riders during assignment. Only an admin can change it (section 48) — see the RLS/grants below.';
comment on column riders.max_active_deliveries is 'Capacity ceiling, default 1 (section 34: "one active delivery at a time is acceptable if operational simplicity is preferred... design schema so batching can be supported later"). Eligibility for a *new* assignment requires active delivery_assignments count < this, computed at assignment time — not a second source of truth staff could forget to update.';

-- Only admin can set primary_store_id (rider store reassignment is
-- explicitly admin-only, section 48) — the existing riders_admin_write
-- policy already covers this (is_admin() for all operations), so no
-- new policy is needed; this comment just documents the intent
-- against the existing "for all using (is_admin())" policy.

-- =======================================================================
-- delivery_assignments: the columns needed for every new outcome
-- (at_store, declined, expired, failed), an assignment-expiry
-- deadline (section 18 — centrally configured, not hardcoded per
-- screen; see assignment_expiry_minutes() in the functions
-- migration), who triggered the assignment (section 56's
-- `assigned_by`), how the delivery was verified/settled (sections
-- 20/31/32 — extensible, not fully implemented), and which mechanism
-- produced the assignment (manual vs. auto, section 14).
-- =======================================================================

create type delivery_assignment_source as enum ('manual', 'auto');
create type delivery_failure_reason as enum ('customer_unavailable', 'wrong_address', 'customer_refused', 'other');
create type delivery_verification_method as enum ('none', 'order_number', 'otp', 'signature', 'photo');

alter table delivery_assignments
  add column assigned_by uuid references profiles (id),
  add column assignment_source delivery_assignment_source not null default 'manual',
  add column expires_at timestamptz,
  add column arrived_at_store_at timestamptz,
  add column out_for_delivery_at timestamptz,
  add column declined_at timestamptz,
  add column declined_by uuid references profiles (id),
  add column decline_reason text,
  add column expired_at timestamptz,
  add column failed_at timestamptz,
  add column failure_reason delivery_failure_reason,
  add column failure_notes text,
  add column cancelled_at timestamptz,
  -- Extensible verification/settlement metadata (sections 31/32) — the
  -- *mechanism* is modeled now; OTP/signature/photo capture itself is
  -- explicitly not implemented this phase, 'order_number' (rider
  -- re-enters/confirms the order number at pickup, section 20/21) is
  -- the one actually enforced in Phase 08.
  add column delivery_verification_method delivery_verification_method,
  add column cash_collected numeric(10, 2) check (cash_collected >= 0),
  add column payment_collection_status text check (payment_collection_status in ('not_applicable', 'pending', 'collected'));

comment on column delivery_assignments.expires_at is 'Set at assignment time (now() + assignment_expiry_minutes()) — expire_stale_assignments() (scheduled) flips a still-''assigned'' row past this deadline to ''expired'', freeing the order for reassignment. Centrally configured (see assignment_expiry_minutes()), never hardcoded per screen.';
comment on column delivery_assignments.cash_collected is 'COD settlement placeholder (section 32) — not enforced or reconciled this phase; a future payments phase will decide how this feeds actual settlement.';

-- One *active* assignment per order needs widening to also exclude
-- declined/expired (Phase 01's original index only excluded
-- completed/cancelled, which would block reassignment after a decline
-- or timeout) — deferred to the next migration: a partial index
-- predicate comparing against 'declined'/'expired' counts as *using*
-- those enum values, which Postgres disallows in the same transaction
-- they were added in.

create index delivery_assignments_status_idx on delivery_assignments (status);
create index delivery_assignments_order_idx on delivery_assignments (order_id);

-- =======================================================================
-- delivery_events: rider/delivery-scoped operational log (section 38)
-- — deliberately separate from order_events (Phase 07), which stays
-- the broader cross-functional log (store actions + these delivery
-- events both feed it, per section 39). delivery_events carries a
-- rider_id order_events has no reason to have; order_events is what a
-- customer-visible "your order was picked up" screen would read from
-- without needing to know delivery_assignments exists at all. Two
-- purpose-built logs, not duplicate architecture — the brief presents
-- them as two distinct lists (sections 38 and 39) for exactly this
-- reason.
-- =======================================================================

create type delivery_event_type as enum (
  'delivery_assigned',
  'delivery_accepted',
  'delivery_declined',
  'delivery_expired',
  'rider_at_store',
  'delivery_picked_up',
  'delivery_started',
  'delivery_failed',
  'delivery_completed',
  'delivery_cancelled'
);

create table delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references delivery_assignments (id) on delete cascade,
  order_id uuid not null references orders (id),
  rider_id uuid references riders (id),
  store_id uuid not null references stores (id),
  event_type delivery_event_type not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index delivery_events_delivery_idx on delivery_events (delivery_id, created_at);
create index delivery_events_rider_idx on delivery_events (rider_id, created_at desc);
create index delivery_events_order_idx on delivery_events (order_id, created_at);

comment on table delivery_events is 'Append-only, written exclusively by the Phase 08 SECURITY DEFINER delivery functions. See docs/delivery-events.md.';

alter table delivery_events enable row level security;

create policy "delivery_events_read"
  on delivery_events for select
  using (
    is_admin()
    or is_store_staff(store_id)
    or exists (select 1 from riders where riders.id = delivery_events.rider_id and riders.profile_id = auth.uid())
    or exists (select 1 from orders where orders.id = delivery_events.order_id and orders.user_id = auth.uid())
  );

-- =======================================================================
-- order_events (Phase 07): extend the vocabulary with the delivery-
-- side milestones (section 39) — the *same* table, not a new one.
-- =======================================================================

alter type order_event_type add value if not exists 'rider_assigned';
alter type order_event_type add value if not exists 'rider_accepted';
alter type order_event_type add value if not exists 'rider_declined';
alter type order_event_type add value if not exists 'order_picked_up';
alter type order_event_type add value if not exists 'order_out_for_delivery';
alter type order_event_type add value if not exists 'order_delivered';
alter type order_event_type add value if not exists 'delivery_failed';
