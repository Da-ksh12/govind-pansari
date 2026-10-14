-- Sellable catalogue: categories, products, and priced/weighted variants.
-- Inventory (quantity) deliberately lives in its own table, keyed by
-- store + variant — never on products/product_variants directly.

create table categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references categories (id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  image_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_parent_idx on categories (parent_id);

create trigger categories_set_updated_at
  before update on categories
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------

create table products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories (id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  short_description text,
  brand text not null default 'Govind Pansari',
  image text,
  gallery text[] not null default '{}',
  is_active boolean not null default true,
  is_featured boolean not null default false,
  is_bestseller boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_idx on products (category_id) where is_active;
create index products_featured_idx on products (is_featured) where is_active and is_featured;
create index products_bestseller_idx on products (is_bestseller) where is_active and is_bestseller;

create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  sku text not null unique,
  weight_value numeric(10, 2) not null check (weight_value > 0),
  weight_unit weight_unit not null,
  price numeric(10, 2) not null check (price >= 0),
  mrp numeric(10, 2) not null check (mrp >= price),
  barcode text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_variants_product_idx on product_variants (product_id) where is_active;

create trigger product_variants_set_updated_at
  before update on product_variants
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- RLS — catalogue is public read; all writes are admin-only (a future
-- store-manager "suggest a restock" flow would go through inventory,
-- not the catalogue itself).
-- ---------------------------------------------------------------------

alter table categories enable row level security;
alter table products enable row level security;
alter table product_variants enable row level security;

create policy "categories_public_read" on categories for select using (is_active or is_admin());
create policy "categories_admin_write" on categories for all using (is_admin()) with check (is_admin());

create policy "products_public_read" on products for select using (is_active or is_admin());
create policy "products_admin_write" on products for all using (is_admin()) with check (is_admin());

create policy "product_variants_public_read" on product_variants for select using (is_active or is_admin());
create policy "product_variants_admin_write" on product_variants for all using (is_admin()) with check (is_admin());
