# Admin Store Management

## What already existed vs. what's new

Stores (`stores` table, Phase 01) already carried everything section 18/39 asks for: name, address, coordinates (`latitude`/`longitude`, used by Phase 03's serviceability checks and Phase 09's map), `opening_time`/`closing_time`, and `is_accepting_orders` (the store dashboard's existing "pause new orders" toggle, built in Phase 07). This phase adds:

- `stores_permission_read`/`stores_permission_write` — new RLS policies letting anyone with `stores.view`/`stores.manage` read/update stores, not just `is_store_staff()` of that specific store or a full `is_admin()`
- `app/admin/stores.tsx` — a list screen surfacing every store with its open/closed status and an accepting-orders toggle

## Business hours / open-closed-temporarily-closed (section 39)

Already modeled, not duplicated: `is_active` (a store closed permanently/not yet opened) and `is_accepting_orders` (temporarily paused — the manager's own toggle from Phase 07) together express the three states the spec asked for (OPEN / CLOSED / TEMPORARILY_CLOSED) without a new enum column. `opening_time`/`closing_time` already exist for a store's daily hours; nothing computes a derived "is it currently within opening hours" status server-side yet (that would be a genuine addition, not present this phase) — customer-facing ordering already respects `is_accepting_orders` via Phase 03/05's serviceability checks.

## Deliberately not built: service-area configuration (section 19)

Phase 03's `delivery_zones` (+ `store_delivery_zones`) already models delivery radius/serviceable pincodes/service zones properly — a store can serve multiple zones, a zone can be served by multiple stores, and customer serviceability is derived from this at checkout time, never hardcoded. This phase did not add an admin UI to edit zones; the data model to do so already exists and would be a reasonably small follow-up (list zones, edit a zone's polygon/pincode list, assign stores to it) rather than new architecture.

## Store staff visibility

`store_staff_permission_read` lets `users.view`/`stores.view` holders read `store_staff` rows across every store (who's assigned where) — used by `app/admin/staff.tsx`'s store-assignment display. Assigning/removing staff itself goes through `assign_store_staff_role()`/`deactivate_store_staff()` (see `docs/admin-roles-permissions.md`), not a direct table write.
