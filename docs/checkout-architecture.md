# Checkout Architecture (Phase 05)

## Two functions, one shared core

```
app/checkout.tsx
  │  on focus / address change
  ▼
checkoutRepository.getSummary(addressId) ──► get_checkout_summary(address_id)  (read-only)
  │                                                       │
  │  tap "Place Order"                                    ▼
  ▼                                            resolve_checkout(address_id)
checkoutRepository.placeOrder(addressId, idempotencyKey)
  ──► create_order_from_cart(address_id, idempotency_key)  (mutating)
                                                            │
                                                    calls resolve_checkout() internally
```

`resolve_checkout()` is the only place that validates the cart/address,
selects the fulfilling store (`docs/fulfillment-engine.md`), and
re-prices every line. Both the read-only preview and the real
order-creation call it — the Checkout screen's bill and the amount
actually charged can never drift apart, because they're computed by
the same code, not parallel implementations kept in sync by hand.

## The frontend never computes money

`get_checkout_summary()`'s response is rendered directly —
`app/checkout.tsx` does no arithmetic on prices, delivery fees, or
totals. The one exception, `useCartLines.ts`'s ₹499 free-delivery
estimate, is pre-existing Cart-screen-only UX (a nudge shown before an
address is even picked) untouched by this phase — see its own
docstring. The Checkout screen, which has a real address and is about
to create a real order, always shows the server's numbers instead.

## Error codes (`CheckoutFailure.code`, `services/repositories/checkoutRepository.ts`)

| Code | Meaning | Typical customer action |
|---|---|---|
| `CART_EMPTY` | No cart, or cart has no items | Return to shopping |
| `ADDRESS_NOT_FOUND` | `address_id` doesn't belong to the caller | Pick a valid address |
| `PRODUCT_UNAVAILABLE` | A cart line's product/variant was deactivated | Remove that item |
| `OUTSIDE_SERVICE_AREA` | No store's delivery zone covers this address | Change address |
| `CART_NOT_FULFILLABLE` | Serviceable stores exist, none stock the whole cart | Edit cart (blocking item named in `unavailableItems`) |
| `BELOW_MINIMUM_ORDER` | Subtotal < the fulfilling zone's minimum order value | Add more items (see `amountToMinimumOrder`) |
| `OUT_OF_STOCK` | Lost a concurrency race for the last unit at reservation time | Retry (a different store/quantity may now apply) |
| `CHECKOUT_ALREADY_PROCESSED` | Lost a race on the idempotency-key unique constraint, and the winner's order couldn't be looked up (should not happen in practice — the lookup normally succeeds and returns that order instead) | Check order history |

These are returned as **typed data**, not thrown exceptions — same
convention as `storeRepository.checkServiceability()` from Phase 03.
`checkoutRepository`'s methods only throw for genuine transport/auth
failures (network error, not signed in); every code above is a normal,
renderable state the Checkout screen switches on directly
(`CheckoutIssueBanner` in `app/checkout.tsx`).

`PRICE_CHANGED` is different in kind — it's a **warning**, not a
failure: `resolve_checkout()` always re-prices from the live
`product_variants` row regardless, so the order is never blocked by a
stale `cart_items.price_snapshot`. The summary's `warnings[]` just
tells the customer their bill reflects a new price before they pay it
(verified live: `create_order_from_cart()` charges the live price, not
the snapshot — `phase05-checkout-fulfillment.test.mjs` test 15).

## Idempotency, end to end

**Why it matters**: a "Place Order" tap that times out on the network
and gets retried — or a genuine double-tap — must never create two
orders for one checkout.

**Server side**: `orders.idempotency_key` is unique per `user_id`.
`create_order_from_cart()` checks it first, before any validation —
a replayed key returns the existing order's data (`idempotent: true`)
with zero re-validation or re-reservation. A second safety net (`WHEN
unique_violation` in the function's exception handler) catches the
case where two replays of the *same* key race each other at the
database level: the loser looks up and returns the winner's order
instead of erroring. Verified live with real concurrent requests
(`phase05-checkout-fulfillment.test.mjs` test 12).

**Client side** (`app/checkout.tsx`):

```ts
const idempotencyKey = useMemo(
  () => (selectedAddressId ? checkoutRepository.newIdempotencyKey() : null),
  [selectedAddressId],
);
```

One key per *address selection*, not per screen mount or per tap —
`useMemo` keyed on `selectedAddressId` means every retry of "Place
Order" against the same address reuses the same key (so a
timeout-and-resend correctly dedupes), but choosing a different
address gets a fresh key. This matters because `create_order_from_cart`
checks the idempotency key **before** even looking at the `address_id`
parameter — replaying an old key with a new address would otherwise
silently return the old address's order, ignoring the new one. Keying
the memo on the address sidesteps that entirely: a changed address is
treated as a genuinely new attempt.

`checkoutRepository.newIdempotencyKey()` is a plain timestamp +
random-string composite (`Date.now().toString(36) + ...`), not a UUID
library — sufficient because uniqueness only needs to hold within one
user's checkout attempts, not globally, and it avoids adding a
dependency (`expo-crypto`/`react-native-get-random-values`) for
something this low-stakes.

## Payment method: COD only, honestly represented

`create_order_from_cart()` has no payment-method parameter — every
order is created with `payments.method = 'cod'`. Gateway integration
(UPI/card/netbanking/wallet, via Razorpay or similar) is explicitly
Phase 06. Rather than let the pre-existing `PaymentMethodRow` picker
silently ignore a customer's UPI/card selection and charge COD anyway,
it now takes a `disabledKeys` prop — `app/checkout.tsx` passes all four
gateway methods, rendered greyed-out with a "Coming Soon" tag. This is
an additive prop (same pattern as `CartLineRow`'s `unavailable`/
`priceChange` props from Phase 04), not a redesign — the component
still renders every method, just accurately reflects which ones work.

## Coupons: deliberately not wired into the real total

The pre-existing "Offers & Coupons" bottom sheet
(`components/cart/CouponSheetContent.tsx`) predates this phase and is
untouched. What changed: `app/checkout.tsx` no longer factors
`useCouponStore`'s locally-"applied" discount into the bill or the
amount sent to `create_order_from_cart` — there's no coupon parameter
on that function at all. Coupon **redemption** is explicitly Phase 06
scope (per the brief); letting a decorative local "applied" state
visibly discount a real, server-charged order total would be a
genuine correctness/trust bug, not a cosmetic gap, so the real
Checkout screen's totals come from the server exclusively.

## Frontend data flow

```
services/repositories/checkoutRepository.ts   — get_checkout_summary / create_order_from_cart RPC wrappers
services/repositories/orderRepository.ts       — list/getById/cancel real orders (was 100% mock before this phase)
store/ordersStore.ts                           — loadOrders() on sign-in (mirrors cart/wishlist's Phase 04 pattern),
                                                  addOrder() pushes a just-created order in immediately
                                                  (its Phase 06-scoped local-only updateStatus() mutator, for the
                                                  live-tracking screen's now-removed rider simulation, was deleted
                                                  in Phase 09 once real tracking replaced it — see
                                                  docs/live-tracking-architecture.md)
app/checkout.tsx                               — real addresses, real summary, real idempotent order creation
app/order-success.tsx, app/order/[id].tsx      — read the just-created/any order; fall back to a fetch if not
                                                  yet in the local store (cold start / deep link)
app/order/[id].tsx                             — new: owner cancel button for placed/confirmed/preparing orders
                                                  (update_order_status(), reused from Phase 01/04 unchanged)
```

`types/models.ts`'s `OrderStatus` gained `'placed'` (real orders start
there; the old mock `orderRepository.create()` fabricated `'confirmed'`
immediately, skipping a state that's now real) — `OrderStatusPill` and
`OrderTimeline` (`Record<OrderStatus, ...>`) were updated to handle it,
which TypeScript enforced (both are exhaustive records, so a missing
key is a compile error, not a silent gap).

## What Phase 05 explicitly does not touch

Payment gateway integration, webhooks, coupon redemption, rider
assignment/GPS/live tracking, push notifications — all Phase 06+, per
the brief. `confirm_payment()` (Phase 01, service-role only) and the
live-tracking screen's client-side rider simulation
(`services/tracking/riderSimulation.ts`) are both untouched.
