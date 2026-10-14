# Store Roles and Permissions (Phase 07)

## The role architecture already existed — Phase 07 extends it, doesn't replace it

Phase 01 already built exactly what section 2/3/4 of the brief asked
for:

- `user_role` enum: `customer`, `admin`, `store_manager`, `rider`, `staff`
- `store_staff_role` enum: `store_manager`, `staff` (a *narrower* role,
  specific to store membership)
- `store_staff` table: `user_id, store_id, role, is_active` — exactly
  the `USER → PROFILE → STORE STAFF MEMBERSHIP → STORE` shape the
  brief describes
- `is_store_staff(target_store_id, required_role default null)` and
  `is_admin()` — `SECURITY DEFINER` helper functions, already used
  throughout Phase 01's RLS policies on `orders`, `inventory`,
  `payments`, etc.

Phase 07 added no new tables or enums for roles — only a new RLS
policy (`store_staff_manager_reads_colleagues`, see below) and the
functions that *use* `is_store_staff()`/`is_admin()` for the new
operational actions.

## Why store membership, not just `profiles.role`

`profiles.role = 'store_manager'` on its own says nothing about
*which* store. Two different managers both have `role = 'store_manager'`
on their profile row — what actually scopes Manager A to Store A and
excludes Store B is the `store_staff` row: `is_store_staff(store_id)`
checks `user_id = auth.uid() AND store_id = target_store_id AND
is_active`, not just the profile's role. A user with no `store_staff`
row for a given store — even an otherwise-legitimate `store_manager`
managing a *different* store — is not staff of that store, full stop.
This is what makes "Store Manager A cannot access Store B" (section 4)
true at the database level, not just the frontend's.

## Manager vs. staff: the one privilege split that matters this phase

| Action | Staff | Manager | Admin |
|---|---|---|---|
| Accept/reject a new order | ✅ | ✅ | ✅ |
| Advance confirmed → preparing → picking → packing → packed | ✅ | ✅ | ✅ |
| Mark an item picked/unavailable | ✅ | ✅ | ✅ |
| **Resolve an order exception** (`resolve_order_exception`) | ❌ | ✅ | ✅ |
| **Change store operational status** (`set_store_accepting_orders`) | ❌ | ✅ | ✅ |
| Record an inventory adjustment | ✅ | ✅ | ✅ |
| View colleagues at the same store | ❌ (self only) | ✅ | ✅ |
| Add/remove staff | ❌ | ❌ | ✅ (not built this phase) |

Everything else store-related is symmetric between staff and manager —
the brief only calls out two specific manager-only checkpoints
(exception resolution, section 16; operational status, section 6), so
that's the only place `is_store_staff(store_id, 'store_manager')` (the
role-scoped form) is used instead of the plain `is_store_staff(store_id)`.
Adding/removing staff stays admin-only — no admin UI is built this
phase (section 44), but the architecture (role/permission checks, not
a hardcoded email) is already what any future admin UI would use.

## `store_staff` RLS

- `store_staff_self_read` (Phase 01, unchanged): a user can always see
  their own membership row.
- `store_staff_manager_reads_colleagues` (**new**, Phase 07): a store
  manager can see every staff row *at a store they manage* — section
  35's "store manager should see staff assigned to their store".
  Plain staff still can't see their colleagues (self-read only)
  unless they're a manager somewhere.
- `store_staff_admin_write` (Phase 01, unchanged): only admin can
  insert/update/delete — a manager cannot add or remove staff
  themselves, per section 35's explicit caution.

Verified live (`phase07-store-operations.test.mjs`, test 30): a
manager querying `store_staff` for their store sees every row; a plain
staff member querying the same store sees only their own.

## Demo accounts (development only)

Extended in this phase (`supabase/seed/02_seed_demo_accounts.mjs`) so
cross-store/cross-role boundaries are actually testable — a single
demo manager account can't exercise "wrong store" or "staff vs.
manager" on its own:

| Phone | Role | Store |
|---|---|---|
| `+919000000201` | customer | — |
| `+919000000202` | rider | — |
| `+919000000203` | store_manager | Sanjay Place (101) |
| `+919000000204` | staff | Sanjay Place (101) |
| `+919000000205` | store_manager | Vijay Nagar (102) |

All use OTP `123456` via the project's `sms_test_otp` config — the two
new numbers had to be added to that allowlist via the Management API
(`PATCH /v1/projects/{ref}/config/auth`), the same mechanism Phase 03
used for the original three.
