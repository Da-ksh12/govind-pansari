-- Per-customer data: addresses, cart, wishlist. All strictly
-- owner-scoped — a customer only ever sees their own rows.

create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  label address_label not null default 'home',
  recipient_name text not null,
  phone text not null,
  address_line_1 text not null,
  address_line_2 text,
  landmark text,
  city text not null,
  state text not null,
  postal_code text not null,
  latitude double precision not null,
  longitude double precision not null,
  geog geography(point, 4326) generated always as (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) stored,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index addresses_user_idx on addresses (user_id);
create index addresses_geog_idx on addresses using gist (geog);
-- Only one default address per user.
create unique index addresses_one_default_per_user
  on addresses (user_id) where is_default;

create trigger addresses_set_updated_at
  before update on addresses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------

create table carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles (id) on delete cascade,
  -- Set on first item add, cleared when the cart empties. A cart is
  -- always scoped to a single fulfilling store — see cart_items'
  -- enforcement in the add_to_cart() function.
  store_id uuid references stores (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger carts_set_updated_at
  before update on carts
  for each row execute function set_updated_at();

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts (id) on delete cascade,
  product_variant_id uuid not null references product_variants (id),
  quantity int not null check (quantity > 0),
  -- Informational only (lets the UI show "price changed since you
  -- added this" banners) — checkout() always re-prices from
  -- product_variants, never trusts this column.
  price_snapshot numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_variant_id)
);

create index cart_items_cart_idx on cart_items (cart_id);

create trigger cart_items_set_updated_at
  before update on cart_items
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------

create table wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table wishlist_items (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references wishlists (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (wishlist_id, product_id)
);

create index wishlist_items_wishlist_idx on wishlist_items (wishlist_id);

-- ---------------------------------------------------------------------
-- RLS — owner-only throughout, via a join back to the owning user_id.
-- ---------------------------------------------------------------------

alter table addresses enable row level security;
alter table carts enable row level security;
alter table cart_items enable row level security;
alter table wishlists enable row level security;
alter table wishlist_items enable row level security;

create policy "addresses_owner_all"
  on addresses for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "carts_owner_all"
  on carts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "cart_items_owner_all"
  on cart_items for all
  using (exists (select 1 from carts where carts.id = cart_items.cart_id and carts.user_id = auth.uid()))
  with check (exists (select 1 from carts where carts.id = cart_items.cart_id and carts.user_id = auth.uid()));

create policy "wishlists_owner_all"
  on wishlists for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "wishlist_items_owner_all"
  on wishlist_items for all
  using (exists (select 1 from wishlists where wishlists.id = wishlist_items.wishlist_id and wishlists.user_id = auth.uid()))
  with check (exists (select 1 from wishlists where wishlists.id = wishlist_items.wishlist_id and wishlists.user_id = auth.uid()));
