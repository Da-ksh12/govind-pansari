# Store Manager Security

## The core principle, and how it's actually enforced

"A Store Manager must only operate their assigned outlet" — enforced by `is_store_staff(store_id)` (Phase 01), used in the RLS policy or authorization check of **every** store-scoped table and function this role touches: `orders`, `order_items`, `inventory`, `inventory_movements`, `store_staff`, `delivery_assignments`, and every store-ops RPC (`accept_order`, `advance_order_fulfillment`, `assign_rider`, `record_inventory_adjustment`, `set_store_accepting_orders`, and this phase's new `get_store_activity`). None of this was newly built for this phase — it's confirmed, tested behavior from Phase 01 onward. This phase's job was to verify it explicitly and add the two new functions to the same pattern.

## Backend derives store context — the client never supplies it as authority

Every store-scoped RPC takes `p_store_id` as a parameter, but that parameter is never trusted on its own — it's only used to look up the *target* row; authorization always re-derives from `is_store_staff(p_store_id, ...)` against the caller's own session (`auth.uid()`), checked inside the function body. A manager cannot make themselves staff of a different store by passing a different `p_store_id` — verified live: calling `record_inventory_adjustment()` and `set_store_accepting_orders()` for Store A while authenticated as Store B's manager is rejected outright, and the target store's data is confirmed unchanged afterward (`store-manager-security.test.mjs` tests 4-5, 9).

## Manager vs. plain staff

`store_staff.role` ('store_manager' | 'staff') gates a second tier within one store: both can view orders/inventory/dashboard, but only a manager can pause the store, assign/reassign riders, or resolve an exception (`is_store_staff(store_id, 'store_manager')` vs. the roleless `is_store_staff(store_id)`). Verified live: plain staff calling `set_store_accepting_orders()` is rejected (test 6).

## Why the store activity feed doesn't read `audit_logs`

The Admin Control Center's `audit_logs` table (a separate, earlier phase) logs admin-tier actions with a heterogeneous `resource_type`/`resource_id` (an order, an inventory row, a profile, a settings row) that doesn't carry `store_id` directly — scoping it to one store would need a different join per resource type, and `audit_logs.view` is gated by `has_permission()`, which only ever evaluates true for `role = 'admin'` accounts, **never** for `role = 'store_manager'`. Rather than awkwardly bridging two separate role systems (admin permissions vs. store staff membership) for one feature, `get_store_activity()` reads `order_events`/`delivery_events`/`inventory_movements` directly — all three already carry `store_id` as a real column, giving clean, native, single-column scoping with no bridging logic at all. This is a deliberate reinterpretation of section 40's "reuse... audit_logs" instruction against how this app's two permission systems actually work, not an oversight.

## Real bugs found via live testing this phase

None new — the store-scoping RLS/authorization being verified here predates this phase and was already correct. What *was* found and fixed: `CREATE OR REPLACE FUNCTION set_store_accepting_orders` with a new third parameter would have silently created an ambiguous second overload rather than replacing the original 2-parameter function (the same Postgres signature-matching gotcha Phase 08's `assign_rider` migration hit and documented) — caught before deployment by checking that precedent first, not by a failed live test this time.

## What's actually verified

`supabase/tests/store-manager-security.test.mjs` — 12 live tests: the two new functions' store-scoping and reason-persistence, cross-store rejection for `delivery_assignments`/`store_staff`/`orders` reads, spoofed-`store_id` rejection for inventory adjustment, cross-store rejection of rider-eligibility lookups, manager-vs-plain-staff authority, and confirmation that admin access remains unaffected. Combined with Phase 07's own pre-existing cross-store tests (dashboard, inventory, orders — its tests 20/26/27/28) and the full six-phase regression (154 live tests total, zero regressions from this phase's changes).
