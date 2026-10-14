-- profiles: application-level user data, 1:1 extension of auth.users.
-- Never stores credentials — Supabase Auth owns those.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  email text,
  avatar_url text,
  role user_role not null default 'customer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table profiles is 'Application-level profile data. Role-based authorization uses profiles.role plus, for store-scoped access, the store_staff table — never trust a client-supplied role.';

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Creates a profiles row whenever a new Supabase Auth user is created.
-- Runs as the table owner (security definer) because the client that
-- triggers auth.users inserts (the signup flow) has no direct insert
-- grant on public.profiles — profile creation is a side effect of
-- signup, not something the client does itself.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.phone,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Role helpers — used throughout RLS policies in later migrations.
-- security definer + a pinned search_path so they can read `profiles`
-- regardless of the calling role's own RLS visibility, without being
-- hijackable via a mutable search_path.
-- ---------------------------------------------------------------------

create or replace function current_profile_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

alter table profiles enable row level security;

create policy "profiles_select_own_or_admin"
  on profiles for select
  using (id = auth.uid() or is_admin());

create policy "profiles_update_own"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- A user may update their own row (policy above), but role/is_active
-- must not be self-editable — column-level privileges are the
-- enforcement here, not the row-level policy, since `with check` alone
-- can't restrict which *columns* a self-update is allowed to touch.
-- (Table owner / service_role bypasses column grants, so admin tooling
-- and the trigger in the previous migration are unaffected.)
revoke update on profiles from authenticated;
grant update (full_name, phone, email, avatar_url) on profiles to authenticated;

-- No insert/delete policy for regular clients: rows are created by the
-- handle_new_auth_user trigger and removed via auth.users cascade only.
create policy "profiles_admin_all"
  on profiles for all
  using (is_admin())
  with check (is_admin());
