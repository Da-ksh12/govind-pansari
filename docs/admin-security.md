# Admin Security

## RLS is the actual boundary, not the UI

`AdminShell` hides nav items and buttons a signed-in admin doesn't have permission for — this is a display convenience, verified explicitly to be *only* that: a scoped `inventory_manager` calling `get_admin_staff_list()` directly (bypassing the UI entirely, via a raw RPC call) is rejected with the same "not authorized" every other unauthorized path returns. Section 44's instruction ("do not rely on frontend route protection alone") is satisfied because every admin RPC and every new RLS policy independently re-checks `has_permission()`/`is_admin()` — the frontend guard in `app/admin/_layout.tsx` (redirect a non-admin `profile.role` away from `/admin`) exists purely for UX, not security.

## API identity: never trust the client (section 46)

No admin function accepts a caller-supplied user id, store id, or role. Every one derives identity from `auth.uid()` and re-derives authorization from the database:

- `assign_admin_role`/`assign_store_staff_role` take a **phone number**, look up the profile server-side, and check the *caller's* actual stored role/admin_role — never a role the client claims to have
- `adjust_inventory`/`update_order_status`/`assign_rider` etc. all re-validate `has_permission()` or `is_store_staff()` fresh on every call, never cache or trust a prior check

## Real bugs found by live testing this phase (not by review)

Three, each with the same shape as this project's prior phases' bugs — correct-looking code, silently wrong, caught only by exercising the real deployed function:

1. **Phone lookup never matched a real account.** `profiles.phone` is stored without a leading `+` (Supabase Auth's own normalization); `assign_admin_role`/`assign_store_staff_role` compared against the caller's raw `+91...` input. Fixed with `ltrim(p_phone, '+')` at the one place the lookup happens.

2. **`assign_admin_role()`'s `RETURNING ... INTO` targeted the wrong variable.** `v_profile` was typed `profiles%rowtype`; the function tried `RETURNING jsonb_build_object(...) INTO v_profile`, which Postgres attempted to coerce into the row type's first column (`uuid`) — "invalid input syntax for type uuid: {...}". Fixed by using a separate `jsonb`-typed variable for the returned value.

3. **A rider with exactly one *failed* delivery was permanently stuck "at capacity."** `assign_rider()`'s own capacity re-check, `auto_assign_rider()`'s ranking query, and `get_eligible_riders_for_order()`'s `active_count` all used a hand-copied `status not in ('completed', 'cancelled', 'declined', 'expired')` list that never included `'failed'` — the exact bug class [[project-phase08-rider-delivery]]'s own memory already names as a lesson ("a status/enum value used in more than ~2 places needs a centralized predicate function," `is_terminal_delivery_status()`). That fix evidently never reached these three call sites, and this session's migration extending their authorization copied the gap forward without noticing. Found by re-running the *full regression suite* (not a dedicated new test) after the Admin Control Center migrations — Phase 08/09/10's own suites started failing with "rider is at capacity" on assignments that should have been long since terminal. Fixed by switching all three to `is_terminal_delivery_status()`, the same predicate everything else already uses. **Lesson reinforced a second time**: when touching a function that has its own hand-written status-exclusion list, replace it with the centralized predicate while you're there, don't copy it forward.

## Data minimization for customer/staff records (section 27/28/29)

`get_admin_customers()`/`get_admin_customer_detail` (client-composed from a direct `profiles` read) never touch `auth.users` — no password hashes, no auth tokens, nothing Supabase Auth itself owns. `profiles_permission_read` grants `customers.view`/`users.view` holders read access to `profiles` rows generally, but the admin repository only ever selects the specific columns each screen needs (name, phone, email, join date, active status) — never a raw `select *` against auth-adjacent tables.

## Concurrency (section 50/51)

Verified live, not assumed:
- Two concurrent `adjust_inventory()` calls on the same store/variant both land correctly for a combined delta (`FOR UPDATE` row lock) — no lost update.
- Two managers concurrently `assign_rider()`-ing the same order to two different riders: exactly one wins (Phase 08's existing partial unique index on `delivery_assignments`, unchanged).
- Two concurrent `accept_delivery()` calls on the same assignment: only the first succeeds (Phase 08, unchanged, re-verified after this phase's changes).

## What's actually verified

`supabase/tests/admin-control-center.test.mjs` — 21 live tests: permission-tier correctness (a legacy admin has everything, a scoped `inventory_manager` has exactly its seeded set and nothing more, a non-admin has none), the self-promotion guard, phone-normalized role assignment, dashboard/orders/customers/inventory read paths including pagination, inventory adjustment correctness/validation/concurrency, order cancellation authorization, audit log write-once/read-gated behavior, and settings mutation authorization. Re-run alongside all five prior backend phases after every fix — **142 live tests total, zero regressions**, across six backend phases.
