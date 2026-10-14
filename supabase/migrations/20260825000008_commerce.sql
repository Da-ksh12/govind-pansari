-- Coupons and the order/payment records themselves. Orders and
-- order_items are business/financial records: immutable once created,
-- except for the status transitions handled by update_order_status()
-- in the business-logic migration.

create table coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  discount_type coupon_discount_type not null,
  discount_value numeric(10, 2) not null check (discount_value > 0),
  max_discount numeric(10, 2) check (max_discount >= 0),
  min_order_value numeric(10, 2) not null default 0 check (min_order_value >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  usage_limit int check (usage_limit > 0),
  per_user_limit int not null default 1 check (per_user_limit > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint coupon_dates_valid check (expires_at > starts_at)
);

create index coupons_code_idx on coupons (code) where is_active;

create table coupon_usage (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons (id),
  user_id uuid not null references profiles (id),
  order_id uuid, -- FK added after `orders` exists, below.
  used_at timestamptz not null default now()
);

create index coupon_usage_coupon_user_idx on coupon_usage (coupon_id, user_id);

-- ---------------------------------------------------------------------

create sequence order_number_seq;

create or replace function generate_order_number()
returns text
language sql
as $$
  select 'GP' || to_char(now(), 'YYMMDD') || lpad(nextval('order_number_seq')::text, 5, '0');
$$;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default generate_order_number(),
  user_id uuid not null references profiles (id),
  store_id uuid not null references stores (id),
  -- Reference the live address for convenience, but always keep an
  -- immutable snapshot too — the order must read the same way even if
  -- the customer later edits or deletes this address.
  address_id uuid references addresses (id) on delete set null,
  delivery_address jsonb not null,
  status order_status not null default 'placed',
  payment_status payment_status not null default 'pending',
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  delivery_fee numeric(10, 2) not null default 0 check (delivery_fee >= 0),
  tax numeric(10, 2) not null default 0 check (tax >= 0),
  total numeric(10, 2) not null check (total >= 0),
  coupon_id uuid references coupons (id),
  estimated_delivery_minutes int,
  placed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_user_idx on orders (user_id, created_at desc);
create index orders_store_idx on orders (store_id, created_at desc);
create index orders_status_idx on orders (status) where status not in ('delivered', 'cancelled');
create index orders_order_number_idx on orders (order_number);

alter table coupon_usage add constraint coupon_usage_order_fk foreign key (order_id) references orders (id);

create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

comment on column orders.delivery_address is 'Snapshot of the address fields at order time (recipient, lines, city, pincode, lat/lng) — never re-read from addresses so historical orders are unaffected by later address edits.';

-- ---------------------------------------------------------------------

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid not null references products (id),
  product_variant_id uuid not null references product_variants (id),
  product_name_snapshot text not null,
  variant_snapshot text not null, -- e.g. "250 g"
  sku_snapshot text not null,
  image_snapshot text,
  quantity int not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  mrp numeric(10, 2) not null check (mrp >= 0),
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  total numeric(10, 2) not null check (total >= 0)
);

create index order_items_order_idx on order_items (order_id);
create index order_items_variant_idx on order_items (product_variant_id);

-- ---------------------------------------------------------------------

create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  old_status order_status,
  new_status order_status not null,
  changed_by uuid references profiles (id),
  changed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index order_status_history_order_idx on order_status_history (order_id, changed_at);

-- Every status change is recorded automatically — application code
-- cannot forget to log a transition, because it isn't application code
-- that logs it.
create or replace function log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into order_status_history (order_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger orders_log_status_change
  after update on orders
  for each row execute function log_order_status_change();

-- ---------------------------------------------------------------------

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  provider text not null,
  payment_reference text,
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null default 'INR',
  status payment_status not null default 'pending',
  method payment_method not null,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_idx on payments (order_id);
-- At most one authoritative "paid" record per order.
create unique index payments_one_paid_per_order on payments (order_id) where status = 'paid';

create trigger payments_set_updated_at
  before update on payments
  for each row execute function set_updated_at();

comment on table payments is 'Written by the checkout()/confirm_payment() functions and the payment-gateway webhook handler only — never by a client-supplied "payment successful" flag.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table coupons enable row level security;
alter table coupon_usage enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_status_history enable row level security;
alter table payments enable row level security;

create policy "coupons_public_read_active" on coupons for select using (is_active or is_admin());
create policy "coupons_admin_write" on coupons for all using (is_admin()) with check (is_admin());

create policy "coupon_usage_owner_read" on coupon_usage for select using (user_id = auth.uid() or is_admin());
-- Insert happens only inside checkout() (security definer) — no direct
-- client insert/update/delete policy.

create policy "orders_owner_read"
  on orders for select
  using (user_id = auth.uid() or is_store_staff(store_id) or is_admin());

create policy "orders_admin_write" on orders for all using (is_admin()) with check (is_admin());
-- Deliberately no insert/update policy for customers or store staff:
-- status transitions have a legal-move state machine (a customer may
-- cancel from 'placed', a store manager may advance to the next stage,
-- a rider may only touch the delivery-stage statuses of their own
-- assignment) that a row-level policy can't express precisely enough.
-- All of that lives in update_order_status()/cancel_order() (business-
-- logic migration), which runs as SECURITY DEFINER and does its own
-- fine-grained authorization check before writing.

create policy "order_items_owner_read"
  on order_items for select
  using (
    exists (
      select 1 from orders
      where orders.id = order_items.order_id
        and (orders.user_id = auth.uid() or is_store_staff(orders.store_id) or is_admin())
    )
  );
-- No client insert/update/delete: written once by checkout().

create policy "order_status_history_owner_read"
  on order_status_history for select
  using (
    exists (
      select 1 from orders
      where orders.id = order_status_history.order_id
        and (orders.user_id = auth.uid() or is_store_staff(orders.store_id) or is_admin())
    )
  );
-- No client insert/update/delete: written exclusively by the
-- log_order_status_change trigger.

create policy "payments_owner_read"
  on payments for select
  using (
    exists (
      select 1 from orders
      where orders.id = payments.order_id
        and (orders.user_id = auth.uid() or is_admin())
    )
  );
-- No client insert/update/delete: written by checkout() and the
-- payment-gateway webhook handler (via confirm_payment(), service-role
-- only) — a client can never mark its own payment as paid.
