-- Final Dispatch pass — schema for the new concurrent-offer system.
-- See 20260826000091 for the design note and 20260826000093 for the
-- functions that operate on these tables.

create type dispatch_round_status as enum ('open', 'completed', 'expired', 'cancelled');
create type delivery_offer_status as enum ('open', 'accepted', 'declined', 'expired', 'lost', 'cancelled');

-- One row per "Send Rider" press (and each subsequent reassignment —
-- section 12's "Round #1 EXPIRED / Round #2 OPEN" auditability). Never
-- revived once closed; a reassignment always starts a fresh round.
create table delivery_dispatch_rounds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  store_id uuid not null references stores (id),
  round_number int not null default 1,
  status dispatch_round_status not null default 'open',
  started_at timestamptz not null default now(),
  started_by uuid not null references profiles (id),
  expires_at timestamptz not null,
  winner_rider_id uuid references riders (id),
  winning_assignment_id uuid references delivery_assignments (id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index delivery_dispatch_rounds_order_idx on delivery_dispatch_rounds (order_id, round_number desc);
-- At most one OPEN round per order at a time — the invariant the whole
-- "first accept wins, reassignment always starts a new round" model
-- depends on; a second concurrent "Send Rider" press must fail loudly,
-- not silently create a competing round.
create unique index delivery_dispatch_rounds_one_open_per_order on delivery_dispatch_rounds (order_id) where status = 'open';

-- One row per (round, eligible rider) — the actual offer fanned out to
-- that rider. `distance_meters` is null when the rider has no current
-- location on file yet (see docs/rider-dispatch.md — riders.current_*
-- is only populated once they've completed at least one delivery,
-- section 4's real, documented limitation, not silently faked as 0).
create table delivery_offers (
  id uuid primary key default gen_random_uuid(),
  dispatch_round_id uuid not null references delivery_dispatch_rounds (id),
  order_id uuid not null references orders (id),
  store_id uuid not null references stores (id),
  rider_id uuid not null references riders (id),
  status delivery_offer_status not null default 'open',
  distance_meters numeric(10, 1),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  unique (dispatch_round_id, rider_id)
);

create index delivery_offers_rider_open_idx on delivery_offers (rider_id) where status = 'open';
create index delivery_offers_round_idx on delivery_offers (dispatch_round_id);

comment on table delivery_dispatch_rounds is 'One "Send Rider" attempt for an order — open, then exactly one of completed (a rider won)/expired (nobody accepted in time)/cancelled. See accept_delivery_offer()/start_dispatch_round()/expire_stale_dispatch_rounds() in 20260826000093.';
comment on table delivery_offers is 'One fanned-out offer per eligible rider per round. Exactly one can end ACCEPTED per round; every other still-OPEN offer in that round is atomically flipped to LOST the instant a winner is determined (accept_delivery_offer) — never two winners, enforced by locking the parent round row, not just the offer row.';

-- ---------------------------------------------------------------------
-- RLS — same pattern already established for delivery_assignments
-- (20260825000028): SECURITY DEFINER helper (is_own_rider) rather than
-- an inline subquery, to avoid the exact cross-table RLS recursion
-- that migration fixed. Riders see only their OWN offers; store staff/
-- admin see their store's rounds/offers for the ops UI; customers see
-- neither directly (they only ever see order.status, never dispatch
-- internals) (section 38/39).
-- ---------------------------------------------------------------------

alter table delivery_dispatch_rounds enable row level security;
alter table delivery_offers enable row level security;

create policy "dispatch_rounds_read" on delivery_dispatch_rounds for select
  using (is_admin() or is_store_staff(store_id) or exists (
    select 1 from delivery_offers o where o.dispatch_round_id = delivery_dispatch_rounds.id and is_own_rider(o.rider_id)
  ));

create policy "delivery_offers_read" on delivery_offers for select
  using (is_admin() or is_store_staff(store_id) or is_own_rider(rider_id));

-- No direct INSERT/UPDATE/DELETE policies for any role — every write
-- goes through start_dispatch_round()/accept_delivery_offer()/
-- decline_delivery_offer()/expire_stale_dispatch_rounds(), all
-- SECURITY DEFINER (section 40: "no client-side winner logic" — the
-- client can only ever call accept, never write a status directly).

-- ---------------------------------------------------------------------
-- Realtime — a rider's device subscribes filtered to their own
-- rider_id (RLS above already scopes it; this just makes the table
-- visible to Postgres Changes at all, same as every other realtime
-- table in this app, e.g. 20260825000031).
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table delivery_dispatch_rounds;
alter publication supabase_realtime add table delivery_offers;
