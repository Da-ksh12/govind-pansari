# Rider Architecture (Phase 08)

## Almost everything already existed — Phase 01 built this speculatively

`riders` (profile_id, vehicle_type, vehicle_number, is_active,
is_available, current_latitude/longitude, last_location_at),
`rider_locations` (a full location ledger with a trigger keeping
`riders.current_lat/lng` in sync), `delivery_assignments`, and the
`delivery_assignment_status` enum were all built in Phase 01, before
Phase 05 (checkout) or Phase 07 (store ops) even existed — meaning
section 42's "rider location preparation" and most of section 9's
"delivery entity" were already done. This phase extends that schema;
it does not replace it.

## Role: `rider` already existed too

`user_role` already had `rider` as a value (Phase 01), same enum
`store_manager`/`staff` use (see `docs/store-roles-and-permissions.md`).
No second auth mechanism, no separate rider password table — a rider
is a `profiles` row with `role = 'rider'` and a matching `riders` row
(`riders.profile_id references profiles(id)`), exactly the "Supabase
Auth → Profile → Role → Rider Profile" shape section 2 asks for.

## What Phase 08 actually added to `riders`

- **`primary_store_id`** (nullable, references `stores`) — genuinely
  missing before this phase; nothing modeled which store a rider
  normally dispatches from (section 5). Only admin can change it
  (`riders_admin_write`, unchanged) — a rider cannot pick their own
  store (section 48).
- **`max_active_deliveries`** (default 1) — a capacity ceiling, kept
  deliberately separate from `is_available`. `is_available` is the
  rider's own online/offline switch; capacity is "how many deliveries
  can I juggle right now," computed by counting non-terminal
  `delivery_assignments` rows against this ceiling at assignment time.
  Decoupling them means a rider can be online and still correctly
  ineligible for a *new* assignment without that meaning they've gone
  offline — see `docs/rider-assignment.md`.

## Derived rider status, not a stored column

Section 4's rich status list (`OFFLINE`/`AVAILABLE`/`ASSIGNED`/
`AT_STORE`/`PICKING_UP`/`DELIVERING`/`SUSPENDED`) is fully computable
from `is_active` + `is_available` + the rider's current non-terminal
`delivery_assignments` row (`get_rider_status()`) — the same "derived,
not stored" pattern as Phase 07's `get_store_operational_status()`.
Nothing can hold a stale status value, because there's no status
column to go stale. `PAUSED` from section 4's "potentially" list isn't
separately modeled — it's operationally indistinguishable from
`OFFLINE` (online in the app, not receiving new work) and a fourth
boolean for that distinction wasn't worth the added surface.

## Availability is a function now, not a raw column grant

Phase 01 granted `authenticated` direct `UPDATE (is_available)` on
`riders` with zero business-rule enforcement. Phase 08 needed a real
rule — "a rider mid-delivery cannot go offline" (section 8) — so
`set_rider_availability(p_available)` replaces the raw grant: it
checks `is_active`, then (if going offline) checks for any non-terminal
`delivery_assignments` row and rejects if one exists. The direct
column grant is revoked; only this function can flip `is_available`
now. Same pattern as Phase 07 locking down direct `inventory.quantity`
writes after finding staff could bypass the audit trail.

## Privacy (sections 3, 26, 27)

A rider's `license_number` was never added — section 3 lists it as
"if legally required," and nothing in this build needs it yet; adding
an unused sensitive field would just be exposure surface with no
corresponding use. `get_rider_dashboard()`/`getDeliveryDetail()` return
exactly what a rider needs to complete a delivery (customer name,
phone, address, store info) and nothing else — no order history beyond
the current assignment, no other customers' data, no payment
credentials. The customer's own view of a rider (`riders_active_delivery_read`
RLS policy, Phase 01, unchanged) is similarly scoped to just the
rider's public info for their own in-flight order.

## Everything else

See `docs/delivery-lifecycle.md` (the state machine),
`docs/rider-assignment.md` (manual + auto assignment, capacity,
reassignment), `docs/delivery-security.md` (RLS, including a real
recursion bug this phase found and fixed), and `docs/delivery-events.md`.
