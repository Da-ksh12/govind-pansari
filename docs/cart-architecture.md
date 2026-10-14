# Cart Architecture

## The hierarchy (section 2)

```
auth.users → carts (one per user) → cart_items → product_variants → products
```

Cart items reference `product_variant_id` — never a duplicated copy of
product name/image/price. Every price shown is read live from
`product_variants` (see "Pricing" below); `cart_items.price_snapshot`
is a display-only reference point, not a second source of truth.

## Two layers, one state, on purpose

```
Everywhere except the Cart screen        The Cart screen itself
(Home, Search, Category, Product,        (app/cart.tsx)
Product Detail rails, the floating              │
cart bar)                                        │
        │                                        │
store/cartStore.ts                    cartRepository.list() — fresh,
  (fast, optimistic, local)           re-checked against the live
        │                             catalogue every time the screen
   AsyncStorage-cached +              gains focus
   synced to Supabase in
   the background
```

This isn't two competing cart implementations — it's one state
(`cartStore`) for the fast, everywhere-badge/quantity experience
(section 17/18), plus one additional read (`cartRepository.list()`,
only on the Cart screen) that answers the specific question the Cart
screen needs answered fresh every time: *is anything in here stale?*
(unavailable products, changed prices — section 12). Quantity/add/
remove actions always go through `cartStore`'s methods either way, so
there's exactly one place that owns cart *mutations*.

`store/cartStore.ts` keeps the exact method names/signatures the UI
already called before this phase (`addItem`, `removeItem`,
`setQuantity`, `incrementVariant`, `decrementVariant`,
`quantityForVariant`, `saveForLater`, `moveToCart`, `removeSaved`,
`clear`) — no screen or component had to change to get real
persistence. Two new methods: `loadCart()` (pulls the real cart on
sign-in) and `clearLocal()` (see "Logout", below).

## Server-validated mutations (sections 6, 9, 41, 43)

Three Postgres functions (`supabase/migrations/20260825000018_...sql`),
not raw table writes — `cart_items` was narrowed to **read-only** for
direct client access (`cart_items_owner_read`), because none of what
section 6 asks add-to-cart to validate (variant exists, variant
active, product active, quantity bounds) can be expressed by a
row-level policy alone:

- **`add_to_cart(variant_id, quantity)`** — validates the variant+its
  product are active, checks quantity bounds (1..20, see
  `max_cart_item_quantity()` — documented, not a magic number),
  auto-creates the user's cart if it doesn't exist yet, and atomically
  upserts: `ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity =
  LEAST(quantity + excluded.quantity, 20)`. That single atomic
  statement is what section 7 (duplicate variants → increment, not a
  second row) and section 9/21 (no read-then-write race) both come
  from — verified live with 5 *concurrent* add-to-cart calls for a
  brand-new variant landing as one row with quantity 5, not five rows
  or a lost update.
- **`set_cart_item_quantity(variant_id, quantity)`** — absolute set on
  an existing line; 0 removes it. Does *not* re-check product/variant
  active status — you can always reduce or remove a line regardless of
  whether the product is still orderable; only *adding* re-validates.
- **`remove_cart_item(variant_id)`** — equivalent to `set_cart_item_quantity(variant_id, 0)`, kept as its own named function since the brief calls it out separately and it reads more clearly from the client.

All three: `SECURITY DEFINER`, `EXECUTE` revoked from `anon`/`PUBLIC`,
granted only to `authenticated`. (One real gotcha hit while building
this, worth remembering for next time: the initial `REVOKE ... FROM
anon` in the same migration that created these functions didn't stick
— checked `pg_proc.proacl` directly and found the actual grant was to
the `PUBLIC` pseudo-role, not `anon` specifically, unlike `checkout()`/
`update_order_status()` in earlier phases. Fixed by revoking from
`PUBLIC` explicitly in a follow-up migration — see
`20260825000020_phase04_revoke_public_execute.sql`.)

## Optimistic UI + rollback (sections 19, 21, 47)

Every `cartStore` mutator updates local state **immediately**, then
fires the matching Supabase call in the background:

```
addItem() → set({ items: [...optimistic update] })
          → cartRepository.addToCart(...).catch(() => {
              set({ items: previous });          // revert
              showToast("Couldn't add...", 'error'); // section 47
            })
```

This is why `AddToCartControl`'s `+`/`-` taps feel instant with no
loading spinner, and why rapid taps are safe: the *local* state updates
synchronously every tap (so the stepper never stutters), while the
*server* calls are naturally serialized/atomic (see above) — a burst
of taps produces a burst of `add_to_cart(variant, 1)` calls that each
land correctly regardless of order or overlap.

## Pricing (sections 10, 11, 44)

**The cart never becomes the payment authority.** Every price the cart
displays comes from `product_variants.price` at read time — the
optimistic local store shows whatever the UI already had cached from
browsing (same as before this phase), and the Cart screen's
`cartRepository.list()` always re-reads the live price on every focus.
`price_snapshot` is set once, on `add_to_cart`'s first INSERT for a
line, and **deliberately never touched again** by quantity changes or
subsequent adds — it's a fixed "price when this was added" reference
purely for the "Price updated: ₹X → ₹Y" banner (`CartLineRow`, new
this phase). The real financial safety net is unchanged from Phase 01:
`checkout()` re-prices every line from `product_variants` directly and
has never trusted `price_snapshot` for anything.

## Availability (sections 12, 45, 46)

`cartRepository.list()` joins each cart line to its live
`product_variants`/`products` row and classifies it `available` /
`unavailable` (inactive variant *or* inactive product — never
distinguished further, since the customer-facing action is the same
either way: remove it). Unavailable items are **never silently
deleted** — `CartLineRow` renders them dimmed with a "Currently
unavailable" chip and only a Remove action, exactly matching the
brief's example for both a deactivated product and a deactivated
variant (never auto-substitutes a different variant).

## Store context (section 5)

`carts.store_id` exists in the schema (Phase 01) and is **not set by
anything in this phase** — deliberately. There's no "current
fulfilling store" resolved anywhere in the app yet (flagged the same
way in Phase 02/03's docs), and section 5 explicitly says not to lock
the cart to a store just because a location was picked. This does mean
Phase 01's `checkout()` function, as originally written, expects
`cart.store_id` to already be set and will reject an empty cart with
`store_id is null` — **this will need reconciling when checkout is
actually built** (Phase 05+), most likely by resolving the fulfillment
store at checkout time rather than requiring it pre-set on the cart.
Noted here so it isn't a surprise later.

## Logout / account switching (sections 22-23)

`authStore.logout()` calls `cartStore.clearLocal()` — a pure local
reset, no server call, because logging out must never delete the
customer's actual cart. `authStore`'s auth-state listener calls
`cartStore.loadCart()` on sign-in, **once per distinct user id**
(tracked via `loadedForUserId`, so a routine `TOKEN_REFRESHED` for the
same session doesn't re-fetch) — this is what guarantees a second
account signed in on the same device never sees the first account's
cart: local state is wiped on sign-out and freshly loaded from the
server for whoever signs in next. Verified live across two separate
login sessions for the same user (cart items persisted correctly) —
see test 15 in `supabase/tests/phase04-cart-wishlist.test.mjs`.

## Cart/checkout/order hardening pass (cancelled or failed gateway payment)

`create_order_from_cart()` deletes `cart_items` the moment an order is
created — necessary so the same cart can't be double-spent while a
gateway payment is in flight or retried. For COD that's correct (order
created = purchase committed = cart consumed). For an online-payment
order, though, the order + reservation is created **before** Razorpay
even opens, so a cancelled/failed payment used to leave the customer's
cart permanently empty for a purchase that never happened — Cart would
show a stale local item while Checkout correctly reported `CART_EMPTY`,
because nothing ever told the local store the server cart was gone.

Fixed with one narrow, backend-authoritative undo:
**`restore_cart_after_failed_payment(order_id)`**
(`20260826000089_restore_cart_after_failed_payment.sql`) — only valid
for a just-created order with a gateway payment method whose
`payments` row is still `status = 'pending'` (never confirmed).
Releases the reservation, cancels the order, marks the payment
`failed`, and re-inserts the order's items back into `cart_items`.
Called from `app/checkout.tsx` in place of the general `cancel()` RPC
whenever `completeGatewayPayment()` returns false (payment failed or
was cancelled at the Razorpay sheet). Deliberately **not** reused by
the general "Cancel Order" action (`update_order_status`) on a later,
already-settled order — reviving a real historical order's cart
automatically would violate the "cancelling an old order doesn't
resurrect its cart, use Buy Again" rule; that path is untouched.

`store/cartStore.ts`'s `applyServerCart()` (used by both `loadCart()`
and the Cart screen's focus effect) is the other half of the fix: it
reconciles the local mirror against whatever `cartRepository.list()`
actually returns, so a cart the server changed out from under the
local store — this recovery path, or any other — can never leave Cart
and Checkout disagreeing about what's in the cart. Checkout also
proactively calls `loadCart()` the moment `get_checkout_summary`
reports `CART_EMPTY` while the local store still thinks it has items,
which lets the existing `totalCount === 0 → redirect to /cart` effect
correctly kick in instead of showing a broken "empty checkout" for a
cart that (from the local store's stale point of view) still had
something in it.

## What Phase 04 explicitly does not do

No inventory reservation happens on add-to-cart (section 13) —
`add_to_cart` never touches the `inventory` table at all, only
`cart_items`. Reservation is checkout's job (already built in Phase 01,
untouched here). No tax/delivery fee/coupon math belongs in the cart's
totals — `useCartLines` computes subtotal/savings/estimated total only;
`CartScreen`'s bill summary is explicitly labeled "Bill Summary" /
"To Pay" rather than implying a final payable amount.
