-- Notifications, reviews, and home-page marketing content (banners,
-- offers).

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  body text not null,
  type notification_type not null,
  data jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where not is_read;

-- ---------------------------------------------------------------------

create table reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  -- The specific purchase this review is backed by — required so a
  -- review can only be created for a product the user actually bought
  -- and received (see add_review() in the business-logic migration,
  -- which checks order_items.order_id -> orders.status = 'delivered').
  order_item_id uuid references order_items (id),
  rating smallint not null check (rating between 1 and 5),
  comment text,
  images text[] not null default '{}',
  status review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index reviews_product_idx on reviews (product_id) where status = 'published';

create trigger reviews_set_updated_at
  before update on reviews
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------

create table banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  image_url text not null,
  cta_label text,
  target_type banner_target_type not null default 'none',
  target_id uuid,
  start_at timestamptz not null default now(),
  end_at timestamptz,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index banners_active_idx on banners (sort_order) where is_active;

create table offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  image_url text not null,
  cta_label text,
  category text not null,
  target_type banner_target_type not null default 'none',
  target_id uuid,
  start_at timestamptz not null default now(),
  end_at timestamptz,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index offers_active_idx on offers (sort_order) where is_active;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table notifications enable row level security;
alter table reviews enable row level security;
alter table banners enable row level security;
alter table offers enable row level security;

create policy "notifications_owner_read" on notifications for select using (user_id = auth.uid());
create policy "notifications_owner_mark_read"
  on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
revoke update on notifications from authenticated;
grant update (is_read) on notifications to authenticated;
create policy "notifications_admin_write" on notifications for all using (is_admin()) with check (is_admin());
-- Inserts come from server-side triggers/functions tied to order
-- events, or an admin broadcast tool — not directly from clients.

create policy "reviews_public_read_published" on reviews for select using (status = 'published' or user_id = auth.uid() or is_admin());
create policy "reviews_owner_update" on reviews for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reviews_owner_delete" on reviews for delete using (user_id = auth.uid());
create policy "reviews_admin_write" on reviews for all using (is_admin()) with check (is_admin());
-- Insert goes through add_review() (business-logic migration), which
-- verifies the verified-purchase condition before the row is created —
-- no direct client insert policy.

create policy "banners_public_read" on banners for select using (is_active or is_admin());
create policy "banners_admin_write" on banners for all using (is_admin()) with check (is_admin());

create policy "offers_public_read" on offers for select using (is_active or is_admin());
create policy "offers_admin_write" on offers for all using (is_admin()) with check (is_admin());
