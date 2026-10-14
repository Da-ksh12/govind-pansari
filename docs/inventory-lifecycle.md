# Inventory Lifecycle

## The core invariant

```
available_to_sell = inventory.quantity - inventory.reserved_quantity
```

`quantity` is what's physically at the store. `reserved_quantity` is
what's held against orders that exist but haven't been paid/confirmed
yet. Nothing reads `quantity` alone to decide sellability — always the
difference. A DB constraint (`reserved_not_over_quantity`) backs this:
`reserved_quantity` can never exceed `quantity`.

Inventory is per `(store_id, product_variant_id)` — never global. The
same variant can be `in_stock` at one store and `out_of_stock` at
another; each row is independent.

## State machine for one reservation

```
              create_order_from_cart()      confirm_payment('paid')  OR
                 reserves qty units      complete_delivery() on a still-
   (no row) ─────────────────────► reserved   pending (COD) order
                                       │  ─────────────────────────► sold
                                       │                (quantity -= qty,
                                       │             reserved_quantity -= qty)
                                       │
                    confirm_payment('failed'), or
                    release_expired_reservations(), or
                    update_order_status('cancelled') (unpaid order)
                    (reservation never converted)
                                       │
                                       ▼
                                  released
                          (reserved_quantity -= qty,
                              quantity unchanged)
```

Two distinct roads to "sold", because payment confirmation and physical
handover happen at different moments depending on the payment method:

- **Gateway payment** (card/UPI/etc via Razorpay): `confirm_payment('paid')`
  converts the reservation the moment payment clears — normally well
  before delivery.
- **COD** (this app's default — `payment_method` defaults to `'cod'` in
  `create_order_from_cart()`): nothing marks the order paid until cash
  is actually collected, which only happens at handover. So
  `complete_delivery()` (20260826000080) does the exact same
  `quantity -= qty, reserved_quantity -= qty` conversion itself,
  *guarded on `payment_status = 'pending'` at that moment* so a
  gateway-paid order (already converted earlier) is never double-
  deducted. This was a real, live bug for a while: nothing converted
  a delivered COD order's reservation into a sale at all, so
  `quantity` never dropped and `reserved_quantity` climbed forever —
  caught via a database consistency audit, not a test (the existing
  test suite asserted delivery_assignments/orders flipped correctly
  but never asserted anything about inventory afterward).

A cancellation after payment already succeeded (`update_order_status`,
`status = 'cancelled'`) is the mirror image of a sale: `quantity +=
qty` and a `return` movement, since the units physically need to go
back on the shelf, not just have a reservation released.

## Why the reservation UPDATE is race-safe

The reserving statement, in `create_order_from_cart()` (Phase 05;
Phase 01's `checkout()` used the identical shape before it was
superseded — see `docs/order-lifecycle.md`), is:

```sql
update inventory
  set reserved_quantity = reserved_quantity + qty
  where store_id = ... and product_variant_id = ...
    and is_available
    and quantity - reserved_quantity >= qty;
```

The condition lives in the same statement as the write — not a
separate `SELECT` beforehand. Two customers racing for the last unit
both issue this `UPDATE` concurrently; Postgres locks the target row for
the first transaction to reach it, and the second transaction's
`UPDATE` *waits* on that row lock rather than reading a stale value.
Once the first transaction commits (or rolls back), the second
transaction's `WHERE` clause is re-evaluated against the now-current
row — if the first sale used up the remaining stock, the second
`UPDATE` matches zero rows (`GET DIAGNOSTICS ... row_count` is `0`),
and `create_order_from_cart()` reports `OUT_OF_STOCK` for that customer
instead of overselling (caught by a nested `EXCEPTION WHEN OTHERS`
block rather than surfaced as a raw error — see
`docs/order-lifecycle.md`). No explicit `SELECT ... FOR UPDATE` or
application-level lock is needed — the combined read+write in one
atomic statement is what provides the guarantee. Verified live with a
genuine two-customer, one-unit-of-stock race
(`supabase/tests/phase05-checkout-fulfillment.test.mjs`, test 19):
exactly one order is created, the other is correctly rejected, and
final `reserved_quantity` exactly matches the starting stock.

## The movement ledger

`inventory_movements` is append-only — insert-only from
`SECURITY DEFINER` functions, never updated or deleted, no client
insert policy at all. Every change to `inventory.quantity` or
`reserved_quantity` should have a corresponding movement row explaining
it:

| `movement_type` | Written by | Effect on `inventory` |
|---|---|---|
| `reservation` | `create_order_from_cart()` | `reserved_quantity += qty` |
| `reservation_release` | `confirm_payment('failed')`, `release_expired_reservations()`, `update_order_status('cancelled')` (unpaid orders) | `reserved_quantity -= qty` |
| `sale` | `confirm_payment('paid')` (gateway), `complete_delivery()` (COD — see above) | `quantity -= qty`, `reserved_quantity -= qty` |
| `return` | `update_order_status('cancelled')` (already-paid orders) | `quantity += qty` |
| `purchase`, `restock`, `adjustment`, `damage`, `transfer` | store-manager tooling (not yet built — the enum values and ledger shape are ready for it) | manual, via future admin RPCs |

If a number in `inventory` ever looks wrong, `inventory_movements`
filtered to that `(store_id, product_variant_id)` is the audit trail —
correcting a mistake is a new offsetting row (`movement_type =
'adjustment'`), never an edit to a historical one.

## What customers actually see

Customers never get raw `SELECT` access to `inventory` (RLS restricts
it to that store's staff and admins). The product-detail/stock-badge
UI reads the `product_availability` view instead, which re-derives just
a `stock_status` enum (`in_stock` / `low_stock` / `out_of_stock`,
`low_stock` triggered by `reorder_level`) — quantities and reservation
counts never leave the server.
