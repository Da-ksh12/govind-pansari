-- Physical outlets, store-level staff access, and hyperlocal delivery
-- serviceability.

create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  address_line text not null,
  city text not null default 'Agra',
  latitude double precision not null,
  longitude double precision not null,
  -- Generated geography point, kept alongside the plain lat/lng columns
  -- so the mobile app can read simple numeric fields while spatial
  -- queries (distance, "which zone contains this store") use `geog`.
  geog geography(point, 4326) generated always as (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) stored,
  phone text,
  opening_time time not null default '09:00',
  closing_time time not null default '21:00',
  is_active boolean not null default true,
  is_accepting_orders boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stores_geog_idx on stores using gist (geog);

create trigger stores_set_updated_at
  before update on stores
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------

create table store_staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  role store_staff_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, store_id)
);

create index store_staff_user_idx on store_staff (user_id) where is_active;
create index store_staff_store_idx on store_staff (store_id) where is_active;

-- Store-scoped authorization helper — used by RLS policies on
-- inventory, orders, delivery_assignments etc. so store access is
-- enforced by *membership*, not just profiles.role.
create or replace function is_store_staff(target_store_id uuid, required_role store_staff_role default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from store_staff
    where user_id = auth.uid()
      and store_id = target_store_id
      and is_active
      and (required_role is null or role = required_role)
  );
$$;

-- ---------------------------------------------------------------------
-- Delivery zones: geographic serviceability + zone-level delivery
-- terms. A zone can be served by more than one store (store_delivery_
-- zones), and a store can serve more than one zone — final fulfillment
-- store is chosen among those by inventory + distance (see the
-- find_serviceable_stores function in a later migration), not hardcoded
-- here.
-- ---------------------------------------------------------------------

create table delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  boundary geography(multipolygon, 4326) not null,
  is_active boolean not null default true,
  delivery_fee numeric(10, 2) not null default 0 check (delivery_fee >= 0),
  minimum_order_value numeric(10, 2) not null default 0 check (minimum_order_value >= 0),
  estimated_delivery_minutes int not null default 35 check (estimated_delivery_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index delivery_zones_boundary_idx on delivery_zones using gist (boundary);

create trigger delivery_zones_set_updated_at
  before update on delivery_zones
  for each row execute function set_updated_at();

create table store_delivery_zones (
  store_id uuid not null references stores (id) on delete cascade,
  delivery_zone_id uuid not null references delivery_zones (id) on delete cascade,
  -- Lower number = preferred first when multiple stores can serve the
  -- same zone (e.g. tie-broken by distance if priorities are equal).
  priority smallint not null default 0,
  primary key (store_id, delivery_zone_id)
);

create index store_delivery_zones_zone_idx on store_delivery_zones (delivery_zone_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table stores enable row level security;
alter table store_staff enable row level security;
alter table delivery_zones enable row level security;
alter table store_delivery_zones enable row level security;

-- Store directory is public read (store locator screen, checkout
-- "fulfilled by" display) — write access is admin-only.
create policy "stores_public_read" on stores for select using (true);
create policy "stores_admin_write" on stores for all using (is_admin()) with check (is_admin());
-- Store managers can toggle their own store's operational flags.
create policy "stores_manager_update"
  on stores for update
  using (is_store_staff(id, 'store_manager'))
  with check (is_store_staff(id, 'store_manager'));

create policy "store_staff_self_read" on store_staff for select using (user_id = auth.uid() or is_admin());
create policy "store_staff_admin_write" on store_staff for all using (is_admin()) with check (is_admin());

create policy "delivery_zones_public_read" on delivery_zones for select using (true);
create policy "delivery_zones_admin_write" on delivery_zones for all using (is_admin()) with check (is_admin());

create policy "store_delivery_zones_public_read" on store_delivery_zones for select using (true);
create policy "store_delivery_zones_admin_write" on store_delivery_zones for all using (is_admin()) with check (is_admin());
