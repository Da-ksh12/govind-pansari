-- Admin Control Center, part 1: role-based permission model.
--
-- Every existing `is_admin()`-gated policy across Phases 01-10 (19
-- migration files) means "role = 'admin' has unrestricted access" —
-- that behaviour is kept EXACTLY as-is for backward compatibility
-- (nothing regresses), but is_admin() itself is redefined so it only
-- returns true for a genuine super/full admin. A NEW `admin_role`
-- column distinguishes tiers within profiles.role = 'admin'; NULL
-- means "legacy full admin" (every admin account created before this
-- migration), so no existing account's access changes.
--
-- Granular admin sub-roles get scoped access through NEW, ADDITIVE
-- policies gated by has_permission() (this migration's function, used
-- starting in 20260826000047) — never by editing the existing
-- is_admin()-gated policies, which stay untouched.

create type admin_role_type as enum (
  'super_admin',
  'admin',
  'operations_manager',
  'inventory_manager',
  'delivery_manager',
  'support_agent'
);

alter table profiles add column admin_role admin_role_type;

comment on column profiles.admin_role is 'Only meaningful when role = ''admin''. NULL means a legacy/unrestricted admin (is_admin() stays true) — every admin account that existed before this column did. A specific value here means a *scoped* admin: is_admin() becomes false for them, and their access comes entirely from has_permission() via role_permissions.';

-- A super_admin cannot be created by anything other than a direct
-- database action or another super_admin (enforced in
-- assign_admin_role(), migration 048) — never a self-promotion.
alter table profiles add constraint profiles_admin_role_only_for_admins
  check (admin_role is null or role = 'admin');

-- ---------------------------------------------------------------------
-- Permission catalogue (section 3) — a fixed, code-defined set, same
-- pattern as notification_event_type: an enum, not a dynamically
-- editable table, since these are the ~30 fixed capability keys the
-- app's own screens and RLS policies check against, not
-- business-configurable data.
-- ---------------------------------------------------------------------

create type admin_permission as enum (
  'dashboard.view',
  'orders.view', 'orders.manage', 'orders.cancel', 'orders.refund',
  'products.view', 'products.create', 'products.edit', 'products.delete',
  'categories.manage',
  'inventory.view', 'inventory.manage', 'inventory.adjust',
  'stores.view', 'stores.manage',
  'riders.view', 'riders.manage',
  'deliveries.view', 'deliveries.assign', 'deliveries.reassign',
  'customers.view', 'customers.manage',
  'notifications.view', 'notifications.send',
  'analytics.view',
  'settings.view', 'settings.manage',
  'users.view', 'users.manage',
  'audit_logs.view'
);

create table role_permissions (
  admin_role admin_role_type not null,
  permission admin_permission not null,
  primary key (admin_role, permission)
);

comment on table role_permissions is 'What each scoped admin_role can do (section 31). super_admin and admin are not represented here — they are handled entirely by is_admin()/has_permission() short-circuiting to true, never by an exhaustive row-per-permission list (a missing row for a new permission must never silently deny the highest tiers).';

-- Section 2/31: sensible, restrictive-by-default grants. Nobody gets
-- riders.manage or users.manage just for having *a* scoped role — each
-- sub-role sees only what its job needs.
insert into role_permissions (admin_role, permission) values
  -- operations_manager: day-to-day running of the whole operation —
  -- orders, deliveries, dashboard — but not catalogue/pricing or staff.
  ('operations_manager', 'dashboard.view'),
  ('operations_manager', 'orders.view'), ('operations_manager', 'orders.manage'), ('operations_manager', 'orders.cancel'),
  ('operations_manager', 'inventory.view'),
  ('operations_manager', 'stores.view'),
  ('operations_manager', 'riders.view'),
  ('operations_manager', 'deliveries.view'), ('operations_manager', 'deliveries.assign'), ('operations_manager', 'deliveries.reassign'),
  ('operations_manager', 'customers.view'),
  ('operations_manager', 'notifications.view'),
  ('operations_manager', 'analytics.view'),
  -- inventory_manager: stock and the catalogue it's attached to,
  -- nothing about riders/deliveries/staff (section 31's own example).
  ('inventory_manager', 'dashboard.view'),
  ('inventory_manager', 'products.view'), ('inventory_manager', 'products.create'), ('inventory_manager', 'products.edit'),
  ('inventory_manager', 'categories.manage'),
  ('inventory_manager', 'inventory.view'), ('inventory_manager', 'inventory.manage'), ('inventory_manager', 'inventory.adjust'),
  ('inventory_manager', 'stores.view'),
  -- delivery_manager: riders and dispatch, read-only on orders (needs
  -- order context to dispatch sensibly, can't cancel/refund one).
  ('delivery_manager', 'dashboard.view'),
  ('delivery_manager', 'orders.view'),
  ('delivery_manager', 'riders.view'), ('delivery_manager', 'riders.manage'),
  ('delivery_manager', 'deliveries.view'), ('delivery_manager', 'deliveries.assign'), ('delivery_manager', 'deliveries.reassign'),
  ('delivery_manager', 'stores.view'),
  -- support_agent: front-line customer/order visibility, no mutation
  -- rights beyond sending a notification to a customer.
  ('support_agent', 'dashboard.view'),
  ('support_agent', 'orders.view'),
  ('support_agent', 'customers.view'),
  ('support_agent', 'notifications.view'), ('support_agent', 'notifications.send'),
  ('support_agent', 'riders.view'),
  ('support_agent', 'deliveries.view');

alter table role_permissions enable row level security;
create policy "role_permissions_admin_read" on role_permissions for select using (is_admin() or exists (
  select 1 from profiles where id = auth.uid() and role = 'admin' and admin_role is not null
));
-- No client write policy at all — role_permissions is code-seeded
-- configuration (section 31 shows it, doesn't ask for it to be
-- editable from the client this phase), changed only by a future
-- migration if the permission set itself changes.

-- ---------------------------------------------------------------------
-- is_admin() redefinition — backward compatible (see column comment
-- above). Every one of the 19 files that already call is_admin() keeps
-- working exactly as before for every admin account that predates this
-- migration.
-- ---------------------------------------------------------------------

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' and (admin_role is null or admin_role = 'super_admin') from profiles where id = auth.uid()), false);
$$;

create or replace function has_permission(p_permission admin_permission)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      role = 'admin' and (
        admin_role is null
        or admin_role in ('super_admin', 'admin')
        or exists (select 1 from role_permissions rp where rp.admin_role = profiles.admin_role and rp.permission = p_permission)
      )
    from profiles where id = auth.uid()
  ), false);
$$;

comment on function has_permission is 'Section 3/44: the one function every new admin RLS policy and admin RPC checks. super_admin/admin (or a legacy NULL admin_role) short-circuit to true for everything — role_permissions only constrains the four operational sub-roles. Never returns true for a non-admin role, regardless of permission.';

grant execute on function has_permission to authenticated;

-- ---------------------------------------------------------------------
-- current_admin_context(): what the admin frontend reads once after
-- login to build its own nav/permission-gated UI (section 44: backend
-- enforces, but the UI still needs to know what to *show* without a
-- probe-every-button round trip).
-- ---------------------------------------------------------------------

create or replace function current_admin_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when p.role != 'admin' then null else jsonb_build_object(
    'adminRole', coalesce(p.admin_role::text, 'super_admin'),
    'isSuperAdmin', p.admin_role is null or p.admin_role in ('super_admin', 'admin'),
    'permissions', coalesce((
      select jsonb_agg(distinct perm) from (
        select unnest(enum_range(null::admin_permission))::text as perm
        where p.admin_role is null or p.admin_role in ('super_admin', 'admin')
        union
        select rp.permission::text from role_permissions rp where rp.admin_role = p.admin_role
      ) x
    ), '[]'::jsonb)
  ) end
  from profiles p where p.id = auth.uid();
$$;

revoke all on function current_admin_context from public, anon;
grant execute on function current_admin_context to authenticated;
