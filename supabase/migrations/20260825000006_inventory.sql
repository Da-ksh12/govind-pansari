-- Per-store inventory and its immutable movement ledger. This is the
-- table concurrent checkouts race on, so its constraints matter as much
-- as its columns — see docs/inventory-lifecycle.md for the full
-- reserve → confirm/release state machine (implemented in the
-- checkout()/confirm_payment()/release_expired_reservations() functions
-- in a later migration).

create table inventory (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  product_variant_id uuid not null references product_variants (id) on delete cascade,
  quantity int not null default 0 check (quantity >= 0),
  reserved_quantity int not null default 0 check (reserved_quantity >= 0),
  reorder_level int not null default 5 check (reorder_level >= 0),
  -- Manual override an outlet can flip (e.g. "we have stock but it's
  -- not sellable right now") independent of the quantity math.
  is_available boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (store_id, product_variant_id),
  constraint reserved_not_over_quantity check (reserved_quantity <= quantity)
);

create index inventory_store_idx on inventory (store_id);
create index inventory_variant_idx on inventory (product_variant_id);
-- Fast "is this in stock anywhere nearby" lookups.
create index inventory_available_idx on inventory (product_variant_id, store_id)
  where is_available and quantity > reserved_quantity;

create trigger inventory_set_updated_at
  before update on inventory
  for each row execute function set_updated_at();

comment on column inventory.quantity is 'Total units physically at this store. Available-to-sell = quantity - reserved_quantity.';
comment on column inventory.reserved_quantity is 'Units held against in-flight (unpaid/unconfirmed) orders. Never edited directly by clients — only via checkout()/confirm_payment()/release_expired_reservations().';

-- ---------------------------------------------------------------------

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id),
  product_variant_id uuid not null references product_variants (id),
  quantity_change int not null,
  movement_type inventory_movement_type not null,
  -- Polymorphic pointer at the thing that caused this movement (an
  -- order, a manual adjustment, a transfer). No FK — the referenced
  -- table varies by reference_type — but always indexed for lookups.
  reference_type text,
  reference_id uuid,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index inventory_movements_variant_store_idx on inventory_movements (store_id, product_variant_id, created_at desc);
create index inventory_movements_reference_idx on inventory_movements (reference_type, reference_id);

comment on table inventory_movements is 'Immutable ledger. Rows are never updated or deleted — corrections are new offsetting rows (movement_type = adjustment).';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table inventory enable row level security;
alter table inventory_movements enable row level security;

-- Customers need to read availability (product detail / stock badges)
-- but never raw quantities/reservations — that's exposed separately via
-- the product_availability view (see the catalogue-views migration),
-- which is owned by a role that can see this table and re-derives only
-- a stock_status enum from it. This table itself stays staff/admin-only.
create policy "inventory_read_own_store_or_admin"
  on inventory for select
  using (is_store_staff(store_id) or is_admin());

create policy "inventory_staff_write"
  on inventory for update
  using (is_store_staff(store_id) or is_admin())
  with check (is_store_staff(store_id) or is_admin());

create policy "inventory_admin_insert" on inventory for insert with check (is_admin() or is_store_staff(store_id));
create policy "inventory_admin_delete" on inventory for delete using (is_admin());

create policy "inventory_movements_read"
  on inventory_movements for select
  using (is_store_staff(store_id) or is_admin());

-- Movements are written exclusively by SECURITY DEFINER functions
-- (checkout, confirm_payment, release_expired_reservations, and a
-- future store-manager restock RPC), never by direct client insert —
-- so there is deliberately no client insert/update/delete policy here.
