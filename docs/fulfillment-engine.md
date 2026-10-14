# Fulfillment Engine (Phase 05)

## The problem this solves

`carts.store_id` has existed in the schema since Phase 01 but was
never set by anything — Phase 02/03/04 all flagged this as a gap to
resolve when checkout was actually built (see `docs/cart-architecture.md`
§"Store context"). Phase 05 resolves it by having **checkout itself**
determine the fulfilling store, rather than expecting the cart to
already know it.

## The rule: one store, whole cart, no splitting

A store is a candidate for an order only if it can supply **every**
line in the cart from its own stock. There is no partial fulfillment —
the app never creates two shipments from two stores for one order.
Among stores that qualify, the nearest one wins.

## The algorithm (`resolve_checkout()`, in
`supabase/migrations/20260825000021_phase05_checkout_fulfillment.sql`)

```sql
select fs.store_id, fs.store_name, fs.delivery_zone_id, fs.delivery_fee,
       fs.minimum_order_value, fs.estimated_delivery_minutes
from find_serviceable_stores(address.latitude, address.longitude) fs
where not exists (
  select 1 from cart_items ci
  join product_variants pv on pv.id = ci.product_variant_id
  where ci.cart_id = cart.id
    and not exists (
      select 1 from inventory inv
      where inv.store_id = fs.store_id
        and inv.product_variant_id = ci.product_variant_id
        and inv.is_available
        and (inv.quantity - inv.reserved_quantity) >= ci.quantity
    )
)
order by fs.distance_meters
limit 1;
```

Read as English: *"the nearest geographically-serviceable store for
which no cart line is unsatisfiable."* The double `not exists` is a
standard SQL pattern for "for all" — there is no cart item that this
store *can't* cover.

1. **`find_serviceable_stores()`** (Phase 01, unchanged) already does
   the geography: customer lat/lng → which delivery zones cover this
   point → which stores serve those zones, ranked by zone priority
   then distance.
2. The `not exists` filter then narrows that list to stores whose
   `inventory` can satisfy every line at the quantity ordered.
3. `order by distance_meters limit 1` picks the nearest one that
   survived the filter — **not** simply the nearest store overall.
   This is the specific property Phase 05's test suite isolates (test
   17: a cart split across two products each stocked at only 2 of the
   3 stores, with exactly one store — not necessarily the nearest —
   stocking both).

## No store qualifies: two different reasons, two different codes

If the query above returns nothing, `resolve_checkout()` distinguishes
*why*, because the customer's next action is different for each:

- **`OUTSIDE_SERVICE_AREA`** — `find_serviceable_stores()` itself
  returned zero rows. No store's delivery zone covers this address at
  all; the customer needs to change their address.
- **`CART_NOT_FULFILLABLE`** — at least one store is geographically
  serviceable, but none of them stock everything in the cart. A
  follow-up query identifies exactly which product(s) are the blocker
  (checked against *every* serviceable store, not just the nearest),
  returned as `unavailableItems`, so the UI can say *"Kashmiri
  Saffron isn't available for delivery to this address"* rather than a
  generic failure. The customer's next action is to edit the cart, not
  the address.

## Why this doesn't need its own concurrency lock

The store-selection query above is a plain `SELECT` — under
concurrent checkouts, two customers could both see a store as
"fulfillable" a moment before one of them actually reserves the last
unit. This is intentional and still safe: store selection is a
heuristic that decides *which store to try*, but the actual
correctness guarantee (no oversell) comes entirely from the atomic
conditional `UPDATE` in the reservation step
(`docs/inventory-lifecycle.md`), which runs after store selection and
re-checks availability for real. If the heuristic was stale, the
reservation step simply fails for the loser and
`create_order_from_cart()` reports `OUT_OF_STOCK` — a correct, if
slightly indirect, path from "state selection was optimistic" to "the
system still didn't oversell." Verified live in
`supabase/tests/phase05-checkout-fulfillment.test.mjs` (test 19).

## What Phase 05 explicitly doesn't do

- **No store priority weighting beyond distance** — `store_delivery_zones.priority`
  exists and is used by `find_serviceable_stores()`'s own internal
  ordering, but isn't exposed as a queryable column, so the
  fulfillability-filtered candidate list here is ordered by distance
  alone. A reasonable simplification, not a gap that blocks anything
  in this phase's scope.
- **No cross-store basket splitting, ever** — not a "Phase 06" gap,
  a deliberate permanent design choice per the brief (one delivery,
  one store, one rider).
- **No store capacity/load balancing** (e.g. "this store already has
  40 pending orders, route elsewhere") — out of scope; `is_accepting_orders`
  is the only store-level circuit breaker that exists, and it's a
  manual flag, not automatic.
