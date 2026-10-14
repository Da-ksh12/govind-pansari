-- Phase 09: Live GPS + Maps + Routing + Real-time Rider Tracking + ETA.
--
-- rider_locations already exists (Phase 01) with exactly the shape
-- section 2 asks for (rider_id, latitude, longitude, accuracy,
-- heading, speed, recorded_at) plus a trigger keeping
-- riders.current_latitude/longitude/last_location_at in sync — which
-- already satisfies section 3's "fast current-location read" ask
-- without a separate rider_current_locations table (one source of
-- truth for "latest," not two). This migration adds what's genuinely
-- missing: which delivery a ping belongs to, outlier flagging, and a
-- server-received timestamp distinct from the client-reported one.
--
-- No separate `delivery_tracking_sessions` table either (section 38
-- called it out as "if useful") — delivery_assignments' own status
-- (accepted/at_store/picked_up/in_transit) already *is* the tracking-
-- eligibility signal (section 7), and its own timestamps already mark
-- when tracking-relevant states began. A parallel session table would
-- just be a second copy of state delivery_assignments already owns —
-- exactly the "second parallel system" every phase's brief warns
-- against.

alter table rider_locations
  add column delivery_id uuid references delivery_assignments (id),
  add column altitude double precision,
  add column server_received_at timestamptz not null default now(),
  add column is_outlier boolean not null default false;

comment on column rider_locations.delivery_id is 'Which delivery this ping was captured during — always set by submit_rider_location() (section 7/8), never inferred after the fact. Existing rows predating this column are left null (harmless; nothing reads them for anything delivery-scoped).';
comment on column rider_locations.is_outlier is 'Flagged (section 10), never silently dropped — an implausible jump is still recorded for audit, but sync_rider_current_location() skips updating riders.current_lat/lng for a flagged ping, so customers never see a teleport (section 10: "do not immediately display impossible jumps").';

create index rider_locations_delivery_idx on rider_locations (delivery_id, recorded_at desc);

-- =======================================================================
-- The "keep riders.current_* in sync" trigger (Phase 01) needs to skip
-- outlier-flagged pings — it previously ran unconditionally on every
-- insert.
-- =======================================================================

create or replace function sync_rider_current_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.is_outlier then
    update riders
    set current_latitude = new.latitude,
        current_longitude = new.longitude,
        last_location_at = new.recorded_at
    where id = new.rider_id;
  end if;
  return new;
end;
$$;

-- =======================================================================
-- Realtime: nothing was enabled on any table yet (verified via
-- pg_publication_tables before writing this). Enable exactly the three
-- tables the customer tracking screen needs to react to without
-- polling (section 13/40): raw location pings, the delivery's own
-- status progression, and the order's status (in case a screen wants
-- to react to it directly). RLS (already correct on all three, tested
-- extensively in Phases 05/07/08) is what actually authorizes each
-- subscriber's row visibility — enabling replication here does not by
-- itself expose anything an existing SELECT policy wouldn't already
-- allow that role to read.
-- =======================================================================

alter publication supabase_realtime add table rider_locations;
alter publication supabase_realtime add table delivery_assignments;
alter publication supabase_realtime add table orders;
