-- Riders, their location history, and the assignment linking a rider to
-- an order for a single delivery run.

create table riders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles (id) on delete cascade,
  vehicle_type text not null default 'scooter',
  vehicle_number text,
  is_active boolean not null default true,
  is_available boolean not null default false,
  -- Current-position snapshot for fast reads (store locator "riders
  -- near me", dispatch UIs). Full history lives in rider_locations.
  current_latitude double precision,
  current_longitude double precision,
  last_location_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index riders_available_idx on riders (is_available) where is_active and is_available;

create trigger riders_set_updated_at
  before update on riders
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Location history. This table grows fast (a moving rider can ping
-- every few seconds) — indexed for the one query pattern that matters
-- (latest N points for one rider) and pruned by a scheduled job rather
-- than kept forever (see the cron migration).
-- ---------------------------------------------------------------------

create table rider_locations (
  id bigint generated always as identity primary key,
  rider_id uuid not null references riders (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  heading double precision,
  speed double precision,
  recorded_at timestamptz not null default now()
);

create index rider_locations_rider_recorded_idx on rider_locations (rider_id, recorded_at desc);

comment on table rider_locations is 'High-volume location ledger. Retention is enforced by prune_old_rider_locations() on a schedule (cron migration) — do not remove that job without replacing it, this table is unbounded otherwise.';

-- Keep riders.current_latitude/longitude/last_location_at in sync
-- whenever a new ping lands, so readers don't have to pull the latest
-- row out of rider_locations themselves.
create or replace function sync_rider_current_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update riders
  set current_latitude = new.latitude,
      current_longitude = new.longitude,
      last_location_at = new.recorded_at
  where id = new.rider_id;
  return new;
end;
$$;

create trigger rider_locations_sync_current
  after insert on rider_locations
  for each row execute function sync_rider_current_location();

-- ---------------------------------------------------------------------

create table delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  rider_id uuid not null references riders (id),
  store_id uuid not null references stores (id),
  status delivery_assignment_status not null default 'assigned',
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  completed_at timestamptz
);

-- One *active* assignment per order at a time (reassignment after a
-- cancellation creates a new row rather than mutating history away).
create unique index delivery_assignments_one_active_per_order
  on delivery_assignments (order_id)
  where status not in ('completed', 'cancelled');

create index delivery_assignments_rider_idx on delivery_assignments (rider_id, status);
create index delivery_assignments_store_idx on delivery_assignments (store_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table riders enable row level security;
alter table rider_locations enable row level security;
alter table delivery_assignments enable row level security;

create policy "riders_self_read" on riders for select using (profile_id = auth.uid() or is_admin());
-- Customers with an active delivery from this rider need to see rider
-- display info (name/rating comes from a join in the app query layer);
-- exposing the riders row itself to an in-flight order's customer:
create policy "riders_active_delivery_read"
  on riders for select
  using (
    exists (
      select 1 from delivery_assignments da
      join orders o on o.id = da.order_id
      where da.rider_id = riders.id
        and o.user_id = auth.uid()
        and da.status not in ('completed', 'cancelled')
    )
  );
create policy "riders_self_update"
  on riders for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
revoke update on riders from authenticated;
-- current_latitude/current_longitude/last_location_at are deliberately
-- NOT grantable here — they're only ever set by the
-- sync_rider_current_location trigger off a rider_locations insert, so
-- the location ledger stays the single source of truth and can't be
-- bypassed by a direct "teleport" update.
grant update (is_available) on riders to authenticated;
create policy "riders_admin_write" on riders for all using (is_admin()) with check (is_admin());

create policy "rider_locations_self_insert"
  on rider_locations for insert
  with check (exists (select 1 from riders where riders.id = rider_id and riders.profile_id = auth.uid()));
create policy "rider_locations_read"
  on rider_locations for select
  using (
    exists (select 1 from riders where riders.id = rider_id and riders.profile_id = auth.uid())
    or is_admin()
    or exists (
      select 1 from delivery_assignments da
      join orders o on o.id = da.order_id
      where da.rider_id = rider_locations.rider_id
        and o.user_id = auth.uid()
        and da.status not in ('completed', 'cancelled')
    )
  );
-- No update/delete policy: the ledger is append-only for everyone,
-- including the rider who wrote a row.

create policy "delivery_assignments_read"
  on delivery_assignments for select
  using (
    is_admin()
    or is_store_staff(store_id)
    or exists (select 1 from riders where riders.id = rider_id and riders.profile_id = auth.uid())
    or exists (select 1 from orders where orders.id = order_id and orders.user_id = auth.uid())
  );
-- Written by assign_rider()/update_delivery_status() (business-logic
-- migration) only — a rider accepting/advancing their own delivery
-- goes through that function so illegal state jumps are rejected, not
-- through a direct row update.
