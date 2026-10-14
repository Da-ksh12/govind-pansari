# Admin Roles & Permissions

## The backward-compatibility problem, and how it was solved

Every RLS policy since Phase 01 uses `is_admin()`, which meant "`profiles.role = 'admin'` → unrestricted access." The brief wants six distinct tiers with real, different access levels — but *rewriting* every `is_admin()`-gated policy across 19 migration files to check fine-grained permissions instead would have touched a huge amount of already-tested code for no real gain (the existing "full admin" tier is still a completely legitimate thing to have).

Instead:

```sql
alter table profiles add column admin_role admin_role_type; -- nullable

create or replace function is_admin() returns boolean as $$
  select role = 'admin' and (admin_role is null or admin_role = 'super_admin')
  from profiles where id = auth.uid();
$$;
```

`admin_role` is `NULL` for every admin account that existed before this phase (and stays `NULL` unless someone explicitly narrows it) — so `is_admin()` returns exactly the same answer it always did for every existing admin. A *new* scoped admin — created via `assign_admin_role()` with one of the four operational sub-roles — gets `is_admin() = false`, and their actual access comes entirely from `has_permission()`.

```sql
create or replace function has_permission(p_permission admin_permission) returns boolean as $$
  select role = 'admin' and (
    admin_role is null or admin_role in ('super_admin', 'admin')
    or exists (select 1 from role_permissions where admin_role = profiles.admin_role and permission = p_permission)
  ) from profiles where id = auth.uid();
$$;
```

`has_permission()` is a superset of `is_admin()` — anyone who satisfies `is_admin()` also satisfies every `has_permission()` check. New admin functionality (this phase's own RLS policies and RPCs) is gated by `has_permission()`, never `is_admin()` directly, so both tiers work correctly against it.

## The six tiers

| Tier | `admin_role` | Access |
|---|---|---|
| Super Admin | `super_admin` or `NULL` | Everything — `is_admin()` is true |
| Admin | `admin` | Everything — treated identically to super_admin by `has_permission()`, but *cannot* grant `super_admin`/`admin` to anyone (only a true super_admin can) |
| Operations Manager | `operations_manager` | Orders, deliveries, dashboard, read-only inventory/stores/riders/customers |
| Inventory Manager | `inventory_manager` | Products, categories, inventory (full), read-only stores |
| Delivery Manager | `delivery_manager` | Riders (full), deliveries (full), read-only orders/stores |
| Support Agent | `support_agent` | Orders/customers/riders/deliveries (read-only), can send notifications |

The exact grant lists live in `role_permissions` (seeded in `20260826000041_admin_roles_and_permissions.sql`) — not reproduced here since that table is the single source of truth and this doc would drift from it.

## Self-promotion is blocked at the function, not just the UI

```sql
if p_admin_role in ('super_admin', 'admin') and not v_caller_is_super then
  raise exception 'only a super admin can grant the admin or super_admin tier';
end if;
...
if v_profile.id = auth.uid() then
  raise exception 'cannot change your own admin role';
end if;
```

Both checks are in `assign_admin_role()` itself — verified live: a scoped admin calling this RPC directly (not through the UI at all) to promote themselves to `super_admin` is rejected, and even a super admin cannot change their *own* role through this function (avoiding an accidental self-lockout being indistinguishable from a deliberate one).

## Assigning a role: phone lookup, not invite-by-email

This app is phone+OTP only (Phase 03) — there's no email invite flow, so "create staff"/"assign admin role" means promoting an *existing* signed-up profile, found by phone number. `profiles.phone` is stored without a leading `+` (Supabase Auth's own normalization — confirmed by querying a real row) while a human naturally types `+91...`; `assign_admin_role()`/`assign_store_staff_role()` both `ltrim(p_phone, '+')` before the lookup. This was a real bug found by live testing (see `docs/admin-security.md`), not a hypothetical.

## `current_admin_context()` — what the UI reads

Called once after entering `/admin`, cached in `store/adminStore.ts`. Returns `{ adminRole, isSuperAdmin, permissions[] }` so the sidebar (`AdminShell`) can show/hide nav items without a round trip per button. This is a **display convenience only** — every actual action still re-checks `has_permission()`/RLS server-side regardless of what the client believes, verified live (a scoped admin's client-side context can't be spoofed into unlocking a server-side action it doesn't actually have).
