# Order Lifecycle

## Status state machine

```
placed ──► confirmed ──► preparing ──► packed ──► rider_assigned ──► out_for_delivery ──► approaching ──► delivered
  │             │             │                                                                              (terminal)
  └─────────────┴─────────────┴────────────────────────────────────► cancelled  (terminal)
```

`payment_status` (`pending → authorized/paid → refunded/partially_refunded`,
or `→ failed`) moves independently of `status` — a `placed` order with
`payment_status = 'pending'` is normal for the few seconds/minutes
between checkout and gateway confirmation (or, for COD, all the way
until delivery).

## Who can do what

| Transition | Who | Function |
|---|---|---|
| *(none)* → `placed` | customer | `create_order_from_cart()` (Phase 05; supersedes Phase 01's `checkout()`) |
| `placed` → `confirmed` | automatic, on payment success | `confirm_payment()` |
| `confirmed`/`preparing`/`packed` | store staff of that store | `update_order_status()` |
| any pre-`packed` status → `cancelled` | order's own customer | `update_order_status()` |
| any non-terminal status → `cancelled` | store staff/admin | `update_order_status()` |
| `confirmed`/`preparing`/`packed` → `rider_assigned` | store manager/admin | `assign_rider()` |
| *(delivery_assignment)* `picked_up` → order `out_for_delivery` | assigned rider | `update_delivery_status()` |
| `out_for_delivery` → `approaching` | assigned rider | `mark_order_approaching()` |
| *(delivery_assignment)* `completed` → order `delivered` | assigned rider | `update_delivery_status()` |

Every `status` change is recorded automatically in
`order_status_history` by the `orders_log_status_change` trigger — no
function above needs to (or is allowed to) write that table directly.

## Checkout, step by step (Phase 05: `resolve_checkout()` / `create_order_from_cart()`)

Phase 01's `checkout()` required `cart.store_id` to already be set,
which nothing ever set (see `docs/cart-architecture.md`) — it was never
actually reachable from the app. Phase 05 replaces it with two
functions that share one read-only validation/pricing/store-selection
core, so the checkout preview the customer sees and the order actually
created can never disagree:

- **`resolve_checkout(address_id)`** — read-only, no writes. Validates
  the cart and address, picks the fulfilling store, re-prices every
  line live, computes totals. Returns a tagged result: either
  `{success:true, storeId, items[], subtotal, deliveryFee, ...}` or
  `{success:false, code, message, ...}` for an expected business
  outcome (see "Error codes" below) — never a thrown exception for
  these, so the UI can render them as normal states.
- **`get_checkout_summary(address_id)`** — thin public alias of
  `resolve_checkout`, called by the Checkout screen to render the bill
  before the customer commits.
- **`create_order_from_cart(address_id, idempotency_key)`** — the
  mutating entry point:
  1. **Idempotency check first**: if an order already exists for
     `(user_id, idempotency_key)`, return it immediately — no
     re-validation, no re-reservation. This is what makes a double-tap
     or a network-timeout-triggered retry of "Place Order" safe (see
     "Idempotency" below).
  2. Call `resolve_checkout()`. Any `success:false` result (including
     `meetsMinimumOrder:false`, checked separately and reported as
     `BELOW_MINIMUM_ORDER`) is returned as-is — **nothing has been
     written yet**, so this is always safe to return directly.
  3. Only once everything validates: insert the `orders` row, then
     **reserve inventory** one line at a time via `UPDATE inventory SET
     reserved_quantity = reserved_quantity + qty WHERE ... AND quantity
     - reserved_quantity >= qty` (same race-safe shape as Phase 01 —
     see `docs/inventory-lifecycle.md`), then `order_items`,
     `inventory_movements`, and a `pending` `cod` `payments` row.
  4. Clear the cart.
  5. This whole block (steps 3-4) runs inside a nested
     `BEGIN...EXCEPTION` — if the reservation loses a race (a
     concurrent checkout took the last unit between `resolve_checkout`'s
     read and this `UPDATE`), Postgres rolls back everything from that
     block via an implicit savepoint, and the function returns
     `{success:false, code:'OUT_OF_STOCK'}` instead of a raw exception.
     A second, more specific `WHEN unique_violation` branch catches the
     case where a *concurrent identical retry* (same idempotency key)
     lost the race to insert the `orders` row itself — it looks up and
     returns the winner's order rather than misreporting `OUT_OF_STOCK`.

No coupon handling in Phase 05 — `checkout()`'s coupon validation/
discount logic was dropped along with it. Redemption is explicitly
Phase 06 scope; the coupon browse sheet still exists in the app but the
Checkout screen doesn't factor it into the real, server-computed total
(see `docs/checkout-architecture.md`).

## Fulfillment store selection

See `docs/fulfillment-engine.md` for the full algorithm — in short:
among stores that geographically serve the address
(`find_serviceable_stores`), pick the nearest one whose own inventory
covers **every** cart line. No partial fulfillment, no order-splitting
— a store either covers the whole cart or it isn't a candidate.

## Idempotency

`orders.idempotency_key` (unique per `user_id`) is a client-generated
string, stable across retries of the *same* checkout attempt (double
tap, timeout-and-resend) but regenerated whenever the customer starts a
genuinely new attempt (e.g. picks a different address — see
`docs/checkout-architecture.md` for exactly when the app regenerates
it). Verified live under real concurrency: two simultaneous requests
carrying the same key produce exactly one `orders` row, both responses
referencing it.

## After checkout: payment confirmation

`checkout()` never marks anything paid — it only creates a `pending`
payment row. The actual "did the money arrive" answer comes from
`confirm_payment(order_id, status, ...)`, called by a payment-gateway
webhook Edge Function running with the service-role key after it
verifies the provider's signature. `EXECUTE` on `confirm_payment` is
revoked from `anon`/`authenticated` — there is no way for the mobile
app, however it's called, to mark its own order paid.

- `status = 'paid'` → converts each line's reservation into an actual
  sale (`quantity -= qty`, `reserved_quantity -= qty`, a `sale` movement
  row), and advances `orders.status` from `placed` to `confirmed` (a
  later status is left alone, in case confirmation is slow and staff
  already started preparing).
- `status = 'failed'` → releases the reservation (`reserved_quantity
  -= qty`, a `reservation_release` movement row) and cancels the order.

For Cash on Delivery, `create_order_from_cart()` still creates a
`pending` payment row (with `provider = 'cod'`) and reserves inventory
the same way — the
reservation is only converted to a sale (and `payment_status` flipped
to `paid`) when the rider marks the delivery `completed`
(`update_delivery_status()`), which is the actual point cash changes
hands.

## Abandoned checkouts

An order stuck at `status = 'placed'` / `payment_status = 'pending'`
for more than 15 minutes (gateway timed out, user closed the app mid-
payment) is swept by `release_expired_reservations()`, scheduled via
pg_cron every 5 minutes: releases the reservation and cancels the
order, same as an explicit payment failure. This is what keeps
`reserved_quantity` from silently drifting upward over time from
abandoned carts.
