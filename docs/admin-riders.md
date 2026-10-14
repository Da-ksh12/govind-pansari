# Admin Rider Management

## Dispatch functions extended, not rebuilt

`assign_rider()`, `auto_assign_rider()`, `cancel_assignment()`, and `get_eligible_riders_for_order()` (all Phase 08) are the entire rider-assignment system this project has, and still are — this phase added exactly one authorization clause to each (`or has_permission('deliveries.assign')` / `'deliveries.reassign'`), reproducing every other line — the ranking logic, the capacity check, the event logging — verbatim. See `docs/admin-security.md` for the real capacity-counting bug found and fixed while doing this.

## `app/admin/riders.tsx` — monitoring, not a duplicate dispatch UI

Lists every rider with online/offline/inactive status (derived directly from `is_active`/`is_available` — no attempt to reconstruct Phase 08's `get_rider_status()` fine-grained state client-side, since that function's full logic isn't exposed as a batch query and re-deriving it approximately would just be a second, drifting copy of real logic) and an activate/deactivate toggle for anyone with `riders.manage`.

Assigning or reassigning a rider to a specific order is **not** duplicated here — `app/store/orders/[id].tsx` already has a complete, tested rider-picker sheet. The admin dispatch board (`app/admin/deliveries.tsx`) links to `/track/[orderId]` (Phase 09's real live map) for any active delivery instead of building a second map.

## Location privacy (section 23)

Rider current location is never read directly from `riders.current_latitude/longitude`/`rider_locations` by any admin screen this phase — the only path to a rider's live position is `app/track/[orderId].tsx`, whose own authorization (`get_delivery_tracking()`, Phase 09) already covers `is_admin()`/`has_permission()`-relevant staff correctly. No new "see every rider on one map" screen was built, which would have needed its own privacy review (should a `support_agent` see every rider's live position at all times, unrelated to any active delivery they're handling? Almost certainly not) that this phase didn't have scope to work through carefully.

## No sensitive documents stored

Section 21's "do not store sensitive documents unnecessarily" is satisfied by omission — `riders` has no license/ID-document columns at all, and this phase didn't add any. Vehicle type and plate number (already-existing, non-sensitive operational fields) are all the admin rider screen shows.
