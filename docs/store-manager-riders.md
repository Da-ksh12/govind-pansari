# Store Manager: Riders & Delivery

## Riders are a shared pool, deliberately

Section 25 says "do not expose riders from unrelated stores." Phase 08's actual assignment design (`get_eligible_riders_for_order()`, `auto_assign_rider()`) ranks *same-store first*, but doesn't exclude other stores' riders — an available rider from a nearby outlet can be assigned if no same-store rider has capacity. This is a deliberate business decision already made and tested in Phase 08 (a small multi-outlet chain sharing a rider pool during a rush is realistic and desirable), not a leftover gap. What section 25 actually protects against — a store manager casually seeing every rider's identity and status — is already true: there is no "browse all riders" screen anywhere in the store manager surface. The only way a manager ever sees a rider's name is through `get_eligible_riders_for_order(order_id)`, which is itself scoped to *their own order* and requires `is_store_staff(order.store_id, 'store_manager')` — a manager cannot call it for another store's order (verified live, `store-manager-security.test.mjs` test 10).

## Delivery dispatch: reused, not duplicated

`assign_rider()`, `auto_assign_rider()`, `cancel_assignment()` (Phase 08) are the entire dispatch engine — nothing new was built for the store manager surface. The existing order-detail "Delivery" card already shows rider name, vehicle, and live stage (`assigned → accepted → at_store → picked_up → in_transit`) with an assign/cancel-assignment sheet for managers only (plain staff see the same information read-only).

## Live map: reused, not duplicated

"Track Live Location" (already present on the order detail's Delivery card, Phase 09) opens `app/track/[orderId].tsx` directly — the exact same screen a customer sees, whose own authorization (`get_delivery_tracking()`) already covers store staff of that order's store. No second map, no second `RoutingService`/`MapService` implementation was built for this phase, per its own explicit instruction.

## Delivery exceptions (section 31)

Rider decline/expiry/failure are already real, tracked states (`delivery_declined`/`delivery_expired`/`delivery_failed` in `delivery_events`, Phase 08) that surface in the store activity feed (`docs/store-manager-fulfillment.md`) and trigger Phase 10 notifications to store staff (`rider_assigned`/`delivery_failed` event types, already wired). A dedicated "delivery delayed" banner comparing expected-vs-current ETA (section 31's own example) was not built — there is no stored expected-arrival timestamp per delivery to compare against (Phase 09's ETA is computed client-side per ride, not persisted), the same honest limitation already documented for the Admin Control Center's dashboard (`docs/admin-orders.md`'s "delayedDeliveries" caveat).

## Cross-store rider/delivery access — verified

`store-manager-security.test.mjs` tests 7 and 10 confirm live: a manager of Store B cannot read Store A's `delivery_assignments` rows via REST, and cannot call `get_eligible_riders_for_order()` for a Store A order at all.
